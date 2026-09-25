const params = new URLSearchParams(window.location.search);
const busId = params.get("busId");

// Default map center (Kerala) — will re-center once we get real data
const map = L.map('map').setView([9.5916, 76.5222], 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
let marker = null;

// ---- Load static bus + route info from Firestore ----
async function loadBusInfo() {
  const busDoc = await db.collection("buses").doc(busId).get();
  if (!busDoc.exists) {
    document.getElementById("regNumber").textContent = "Bus not found";
    return;
  }
  const bus = busDoc.data();
  document.getElementById("regNumber").textContent = bus.registrationNumber;
  document.getElementById("meta").textContent = `${bus.operator} • ${bus.busType}`;
}
loadBusInfo();

// ---- Listen for live location updates from Realtime Database ----
rtdb.ref(`liveLocations/${busId}`).on("value", (snapshot) => {
  const loc = snapshot.val();
  const statusEl = document.getElementById("status");

  if (loc && loc.lat && loc.lng) {
    statusEl.textContent = "🟢 Live tracking active";
    statusEl.className = "status-live";
    if (marker) {
      marker.setLatLng([loc.lat, loc.lng]);
    } else {
      marker = L.marker([loc.lat, loc.lng]).addTo(map);
    }
    map.setView([loc.lat, loc.lng], 13);
  } else {
    statusEl.textContent = "No live data — showing schedule only";
    statusEl.className = "status-offline";
  }
});

// ---- "Share my location" button: turns THIS phone into the bus's live tracker ----
document.getElementById("shareBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Location sharing isn't supported on this device/browser.");
    return;
  }
  navigator.geolocation.watchPosition(
    (position) => {
      rtdb.ref(`liveLocations/${busId}`).set({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        updatedAt: Date.now()
      });
    },
    (err) => alert("Couldn't get your location: " + err.message),
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
  document.getElementById("shareBtn").textContent = "📍 Sharing live location...";
  document.getElementById("shareBtn").disabled = true;
});
