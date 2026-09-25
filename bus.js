/**
 * TRAVEL MATE - Real-Time Tracking & Telemetry (bus.js)
 * Architecture:
 * - Reads static metadata from Firestore (v10 compat).
 * - WebSocket-based live GPS subscription via Firebase Realtime Database.
 * - Leaflet.js dynamic marker updates without DOM redraws.
 * - Haversine Great-Circle Distance & ETA computation:
 *   ETA (mins) = (Haversine Distance (km) / Average Bus Speed (30 km/h)) * 60
 * - Crowdsourced live GPS broadcasting via navigator.geolocation.watchPosition().
 * - Resource cleanup on 'beforeunload' to prevent memory and socket leaks.
 */

const params = new URLSearchParams(window.location.search);
const busId = params.get("busId");

// State variables
let busLocation = null;
let passengerLocation = null;
let busMarker = null;
let passengerMarker = null;
let liveLocationRef = null;
let broadcastWatchId = null;
let passengerWatchId = null;
let updateTicker = null;

// Fallback metadata for demo buses when testing offline/without Firestore seeding
const FALLBACK_BUS_DOCS = {
  "bus_klm_01": { registrationNumber: "KL-02-BB-4567", operator: "Private Bus", busType: "Private Bus", defaultCoords: [8.8932, 76.6141] },
  "bus_klm_02": { registrationNumber: "KL-02-CZ-8821", operator: "Private Bus (Parvathy)", busType: "Private Bus", defaultCoords: [8.9800, 76.7000] },
  "bus_klm_03": { registrationNumber: "KL-02-AK-1029", operator: "Private Bus", busType: "Private Bus", defaultCoords: [8.9900, 76.7900] },
  "demo-bus-101": { registrationNumber: "KL-05-AW-4021", operator: "Private Bus", busType: "Private Bus", defaultCoords: [9.5916, 76.5222] },
  "demo-bus-102": { registrationNumber: "KL-04-B-9912", operator: "Private Bus (St. Antony)", busType: "Private Bus", defaultCoords: [9.5800, 76.5300] },
  "demo-bus-103": { registrationNumber: "KL-02-CD-5511", operator: "Private Bus", busType: "Private Bus", defaultCoords: [9.0000, 76.7500] },
  "demo-bus-104": { registrationNumber: "KL-15-X-7722", operator: "Private Bus", busType: "Private Bus", defaultCoords: [8.5241, 76.9366] },
  "demo-bus-105": { registrationNumber: "KL-15-A-1100", operator: "Private Bus", busType: "Private Bus", defaultCoords: [8.8932, 76.6141] },
  "demo-bus-106": { registrationNumber: "KL-08-BK-3399", operator: "Private Bus", busType: "Private Bus", defaultCoords: [9.9816, 76.2999] }
};

// 1. Initialize Leaflet Map (Centering on Kerala Coordinates)
const map = L.map('map').setView([9.5916, 76.5222], 9);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Custom Leaflet DivIcons for Bus and Passenger
const busIcon = L.divIcon({
  className: 'custom-bus-pin',
  html: `<div style="background-color: #1b5e20; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">🚌</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

const passengerIcon = L.divIcon({
  className: 'custom-user-pin',
  html: `<div style="background-color: #2563eb; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2.5px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">👤</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

/**
 * 4. Haversine Formula for Great-Circle Distance:
 * Given two latitude/longitude pairs on a spherical Earth of radius R = 6371 km.
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's mean radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

/**
 * Calculate Estimated Arrival Time (ETA):
 * ETA (mins) = (Haversine Distance (km) / Speed (km/h)) * 60
 */
function calculateETA(distanceKm, speedKmh = 30) {
  // Assume default transit speed of 30 km/h unless real bus is moving at >= 10 km/h
  const effectiveSpeed = (speedKmh && speedKmh >= 10) ? speedKmh : 30;
  const etaMinutes = (distanceKm / effectiveSpeed) * 60;
  return Math.round(etaMinutes);
}

/**
 * Recalculate and update Telemetry and ETA displays
 */
function updateTelemetryDisplay() {
  const distanceEl = document.getElementById("distanceVal");
  const etaEl = document.getElementById("etaVal");
  const speedEl = document.getElementById("speedVal");
  const lastUpdatedEl = document.getElementById("lastUpdatedVal");

  if (busLocation) {
    // Speed display
    speedEl.textContent = busLocation.speed ? `${busLocation.speed} km/h` : "30 km/h (avg)";

    // Last updated ticker
    if (busLocation.updatedAt) {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - busLocation.updatedAt) / 1000));
      if (elapsedSeconds < 60) {
        lastUpdatedEl.textContent = `${elapsedSeconds}s ago`;
      } else {
        lastUpdatedEl.textContent = `${Math.floor(elapsedSeconds / 60)}m ago`;
      }
    } else {
      lastUpdatedEl.textContent = "Live";
    }

    // Distance & ETA if passenger location is also known
    if (passengerLocation) {
      const distance = calculateHaversineDistance(
        passengerLocation.lat,
        passengerLocation.lng,
        busLocation.lat,
        busLocation.lng
      );
      const eta = calculateETA(distance, busLocation.speed);

      distanceEl.textContent = `${distance.toFixed(1)} km`;
      etaEl.textContent = `${eta} mins`;
    } else {
      distanceEl.textContent = "Locate me";
      etaEl.textContent = "--";
    }
  } else {
    distanceEl.textContent = "--";
    etaEl.textContent = "--";
    speedEl.textContent = "--";
    lastUpdatedEl.textContent = "Offline";
  }
}

/**
 * 1. Load static bus metadata from Firestore
 */
async function loadBusMetadata() {
  if (!busId) {
    document.getElementById("regNumber").textContent = "No Bus Selected";
    document.getElementById("busMeta").textContent = "Please choose a bus from the route results.";
    return;
  }

  try {
    const busDoc = await db.collection("buses").doc(busId).get();
    if (busDoc.exists) {
      const bus = busDoc.data();
      const rawOp = (bus.operator || "").trim();
      const rawType = (bus.busType || bus.bustype || "").trim();
      const operator = (!rawOp || ["ksrtc", "k.s.r.t.c."].includes(rawOp.toLowerCase())) ? "Private Bus" : rawOp;
      const busType = (!rawType || ["fast passenger", "ordinary", "super fast", "minnal deluxe"].includes(rawType.toLowerCase())) ? "Private Bus" : rawType;

      document.getElementById("regNumber").textContent = bus.registrationNumber || bus.regNumber || "KL Registered Bus";
      document.getElementById("operatorBadge").textContent = operator;
      const depTime = bus.departureTime || bus["departure time"] || "Scheduled";
      document.getElementById("busMeta").textContent = `${busType} • Departure: ${depTime}`;
      return;
    }
  } catch (err) {
    console.warn("Could not fetch bus from Firestore:", err.message);
  }

  // Check fallback mock data for testing/demo
  if (FALLBACK_BUS_DOCS[busId]) {
    const bus = FALLBACK_BUS_DOCS[busId];
    document.getElementById("regNumber").textContent = bus.registrationNumber;
    document.getElementById("operatorBadge").textContent = bus.operator;
    document.getElementById("busMeta").textContent = `${bus.busType} (Demo Vehicle)`;
  } else {
    document.getElementById("regNumber").textContent = `Bus ID: ${busId}`;
    document.getElementById("operatorBadge").textContent = "Vehicle";
    document.getElementById("busMeta").textContent = "Active tracking session";
  }
}

/**
 * 2 & 3. Real-Time Telemetry Listener & Dynamic Leaflet Marker Updates
 */
function initRealtimeTracking() {
  if (!busId) return;

  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const pulseIndicator = document.getElementById("pulseIndicator");

  liveLocationRef = rtdb.ref(`liveLocations/${busId}`);

  liveLocationRef.on("value", (snapshot) => {
    const loc = snapshot.val();

    if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
      busLocation = loc;

      // Update Live Status Pill UI
      statusPill.className = "status-pill status-live";
      pulseIndicator.className = "pulse-dot";
      statusText.textContent = "🟢 Live GPS Telemetry Active";

      // Dynamically update Leaflet marker position without canvas re-render
      if (busMarker) {
        busMarker.setLatLng([loc.lat, loc.lng]);
      } else {
        busMarker = L.marker([loc.lat, loc.lng], { icon: busIcon }).addTo(map);
        busMarker.bindPopup(`<b>${document.getElementById("regNumber").textContent}</b><br>Live Stream`).openPopup();
      }

      // If user marker is not yet placed, center on bus
      if (!passengerMarker) {
        map.setView([loc.lat, loc.lng], 13);
      } else {
        // Fit view bounds to show both bus and passenger
        const group = L.featureGroup([busMarker, passengerMarker]);
        map.fitBounds(group.getBounds().pad(0.2));
      }

      updateTelemetryDisplay();
    } else {
      // Offline State
      busLocation = null;
      statusPill.className = "status-pill status-offline";
      pulseIndicator.className = "";
      statusText.textContent = "⚪ No live GPS broadcast — showing schedule only";
      updateTelemetryDisplay();
    }
  });
}

/**
 * Acquire passenger's current location to compute distance and ETA
 */
function locatePassenger() {
  const locateBtn = document.getElementById("locateUserBtn");
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }

  locateBtn.textContent = "Locating your position...";
  locateBtn.disabled = true;

  passengerWatchId = navigator.geolocation.watchPosition(
    (position) => {
      locateBtn.textContent = "📍 Location synced";
      locateBtn.disabled = false;

      passengerLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };

      if (passengerMarker) {
        passengerMarker.setLatLng([passengerLocation.lat, passengerLocation.lng]);
      } else {
        passengerMarker = L.marker([passengerLocation.lat, passengerLocation.lng], { icon: passengerIcon }).addTo(map);
        passengerMarker.bindPopup("<b>You are here</b><br>Boarding Point").openPopup();
      }

      if (busMarker) {
        const group = L.featureGroup([busMarker, passengerMarker]);
        map.fitBounds(group.getBounds().pad(0.25));
      } else {
        map.setView([passengerLocation.lat, passengerLocation.lng], 13);
      }

      updateTelemetryDisplay();
    },
    (err) => {
      console.warn("Passenger geolocation warning:", err.message);
      locateBtn.textContent = "🧭 Measure My Distance & ETA";
      locateBtn.disabled = false;
      alert("Please allow location access to calculate distance and ETA to your bus.");
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
  );
}

/**
 * 5. "Share My Location" Crowdsourced GPS Broadcast Mode
 */
function toggleCrowdsourceBroadcast() {
  const shareBtn = document.getElementById("shareBtn");

  if (broadcastWatchId !== null) {
    // Currently broadcasting -> stop sharing
    navigator.geolocation.clearWatch(broadcastWatchId);
    broadcastWatchId = null;
    shareBtn.textContent = "📍 Share My Location (I'm on this bus)";
    shareBtn.classList.remove("btn-secondary");
    shareBtn.classList.add("btn-primary");
    alert("Stopped broadcasting location.");
    return;
  }

  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your device.");
    return;
  }

  shareBtn.textContent = "Broadcasting GPS coordinates...";

  broadcastWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const speedKmh = position.coords.speed !== null && !isNaN(position.coords.speed)
        ? Math.round(position.coords.speed * 3.6)
        : 30;

      const payload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        speed: speedKmh,
        updatedAt: Date.now()
      };

      // Write to Firebase Realtime Database liveLocations/{busId}
      rtdb.ref(`liveLocations/${busId}`).set(payload)
        .then(() => {
          shareBtn.textContent = "🛑 Stop Sharing Location (Active)";
          shareBtn.classList.remove("btn-primary");
          shareBtn.classList.add("btn-secondary");
        })
        .catch(err => {
          console.error("Error writing to Realtime Database:", err);
          alert("Database write error: " + err.message);
        });
    },
    (err) => {
      alert("Unable to acquire high-accuracy GPS: " + err.message);
      shareBtn.textContent = "📍 Share My Location (I'm on this bus)";
      broadcastWatchId = null;
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

/**
 * 6. Cleanup Logic (beforeunload) to Detach Listeners & Prevent Memory/Socket Leaks
 */
function setupCleanup() {
  window.addEventListener("beforeunload", () => {
    // Detach Firebase Realtime Database event listener
    if (liveLocationRef) {
      liveLocationRef.off("value");
      liveLocationRef.off();
      liveLocationRef = null;
    }

    // Clear active Geolocation watch IDs
    if (broadcastWatchId !== null) {
      navigator.geolocation.clearWatch(broadcastWatchId);
      broadcastWatchId = null;
    }

    if (passengerWatchId !== null) {
      navigator.geolocation.clearWatch(passengerWatchId);
      passengerWatchId = null;
    }

    // Clear refresh timer
    if (updateTicker) {
      clearInterval(updateTicker);
      updateTicker = null;
    }
  });
}

// Lifecycle Initialization
document.addEventListener("DOMContentLoaded", () => {
  loadBusMetadata();
  initRealtimeTracking();
  setupCleanup();

  // Periodic ticker to refresh "Xs ago" telemetry age and recalculate ETA
  updateTicker = setInterval(updateTelemetryDisplay, 5000);

  document.getElementById("shareBtn").addEventListener("click", toggleCrowdsourceBroadcast);
  document.getElementById("locateUserBtn").addEventListener("click", locatePassenger);
});
