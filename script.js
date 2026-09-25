/**
 * TRAVEL MATE - Dynamic Route Finder (script.js)
 * Architecture:
 * - Queries Firestore `routes` collection for transit vertices.
 * - Handles both array format `["Kollam", "Kottarakara"]` and CSV string `"Kollam,Kottarakara"`.
 * - Robust fallback to Kollam regional network if database is slow, empty, or offline.
 * - Direct Route Discovery: Sequence order validation index(from) < index(to).
 * - Multi-Leg 1-Transfer Graph Discovery: Connecting stop T where index(from) < index(T) on Route A 
 *   and index(T) < index(to) on Route B.
 * - Compatible with Firebase v10 Compat Mode.
 */

// Fallback transit dataset (Kerala public transport network - Kollam regional corridor)
const FALLBACK_ROUTES = [
  {
    id: "route-klm-ktr-01",
    name: "Kollam - Kottarakara - Punalur Private Bus",
    stops: ["Kollam", "Kottiyam", "Kundara", "Kottarakara", "Punalur", "Pathanamthitta"]
  },
  {
    id: "route-ktr-klm-02",
    name: "Pathanamthitta - Kottarakara - Kollam Private Bus",
    stops: ["Pathanamthitta", "Punalur", "Kottarakara", "Kundara", "Kottiyam", "Kollam"]
  },
  {
    id: "route-tvm-klm-03",
    name: "Trivandrum - Kollam - Karunagappally Private Bus",
    stops: ["Trivandrum", "Kazhakkoottam", "Attingal", "Chathannoor", "Kottiyam", "Kollam", "Chavara", "Karunagappally", "Oachira", "Kayamkulam"]
  },
  {
    id: "route-klm-tvm-04",
    name: "Karunagappally - Kollam - Trivandrum Private Bus",
    stops: ["Kayamkulam", "Oachira", "Karunagappally", "Chavara", "Kollam", "Kottiyam", "Chathannoor", "Attingal", "Kazhakkoottam", "Trivandrum"]
  },
  {
    id: "route-ktr-oyur-klm-05",
    name: "Kottarakara - Oyur - Kollam Private Bus",
    stops: ["Kottarakara", "Oyur", "Veliyam", "Kundara", "Kollam"]
  },
  {
    id: "route-klm-oyur-ktr-06",
    name: "Kollam - Oyur - Kottarakara Private Bus",
    stops: ["Kollam", "Kundara", "Veliyam", "Oyur", "Kottarakara"]
  },
  {
    id: "route-ktm-ktr-07",
    name: "Kottayam - Adoor - Kottarakara Private Bus",
    stops: ["Kottayam", "Changanassery", "Thiruvalla", "Chengannur", "Adoor", "Oyur", "Kottarakara"]
  },
  {
    id: "route-klm-ktm-08",
    name: "Kollam - Karunagappally - Kottayam Private Bus",
    stops: ["Kollam", "Chavara", "Karunagappally", "Oachira", "Kayamkulam", "Changanassery", "Kottayam"]
  },
  {
    id: "route-adoor-klm-09",
    name: "Adoor - Kottarakara - Kollam Private Bus",
    stops: ["Adoor", "Oyur", "Kottarakara", "Kundara", "Kollam"]
  }
];

// Fallback Kollam region stops list
const KOLLAM_STOPS = [
  "Adoor",
  "Attingal",
  "Chathannoor",
  "Chavara",
  "Changanassery",
  "Karunagappally",
  "Kayamkulam",
  "Kazhakkoottam",
  "Kollam",
  "Kottarakara",
  "Kottayam",
  "Kottiyam",
  "Kundara",
  "Oachira",
  "Oyur",
  "Pathanamthitta",
  "Punalur",
  "Trivandrum"
];

let cachedRoutes = [];
let isUsingFallback = false;

/**
 * Utility helper: promise with timeout to prevent blocking UI when network is slow
 */
function fetchWithTimeout(promise, ms = 3500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore request timeout")), ms))
  ]);
}

/**
 * Helper to normalize stops whether stored as an Array or a comma-separated string
 */
function normalizeStops(raw) {
  if (Array.isArray(raw)) {
    return raw.map(s => String(s || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Display notification banner in index.html
 */
function showBanner(message, type = "info") {
  const banner = document.getElementById("statusBanner");
  if (!banner) return;
  banner.textContent = message;
  banner.className = `banner banner-${type}`;
  banner.style.display = "block";
}

/**
 * Load all stops into the From/To dropdowns
 * Queries Firestore 'routes' collection with fallback to Kollam region stops if empty.
 */
async function loadStops() {
  const stopsSet = new Set();
  cachedRoutes = [];

  try {
    const snapshot = await fetchWithTimeout(db.collection("routes").get(), 3000);
    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        const parsedStops = normalizeStops(data.stops);
        if (parsedStops.length > 0) {
          cachedRoutes.push({
            id: doc.id,
            name: data.name || "Transit Route",
            stops: parsedStops
          });
          parsedStops.forEach(s => stopsSet.add(s));
        }
      });
      console.log(`Loaded ${cachedRoutes.length} valid routes from Firestore.`);
    }
  } catch (err) {
    console.warn("Could not fetch from Firebase, using fallback routes:", err.message);
  }

  // If Firestore has no routes or failed, seed with fallback routes
  if (cachedRoutes.length === 0) {
    cachedRoutes = FALLBACK_ROUTES;
    isUsingFallback = true;
    showBanner("Notice: Operating with pre-loaded regional transit network (Firestore offline or unpopulated).", "warning");
  }

  // Always ensure all Kollam regional stops are available in the dropdown
  KOLLAM_STOPS.forEach(s => stopsSet.add(s));
  cachedRoutes.forEach(r => r.stops.forEach(s => stopsSet.add(s)));

  const stops = Array.from(stopsSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const fromSelect = document.getElementById("from");
  const toSelect = document.getElementById("to");

  fromSelect.innerHTML = "";
  toSelect.innerHTML = "";

  stops.forEach(stop => {
    fromSelect.innerHTML += `<option value="${stop}">${stop}</option>`;
    toSelect.innerHTML += `<option value="${stop}">${stop}</option>`;
  });

  // Preserve previous search if available, or set default to Kollam -> Kottarakara
  const savedSearch = localStorage.getItem("searchResults");
  let restored = false;
  if (savedSearch) {
    try {
      const parsed = JSON.parse(savedSearch);
      if (parsed.from && parsed.to && parsed.from !== parsed.to) {
        fromSelect.value = parsed.from;
        toSelect.value = parsed.to;
        restored = true;
      }
    } catch (_) {}
  }

  if (!restored) {
    // Default initial selection for intuitive demonstration
    fromSelect.value = "Kollam";
    toSelect.value = "Kottarakara";
  }
}

/**
 * Route Search Algorithm:
 * - Direct Routes: Checks if 'from' appears before 'to' in a single route's stops array.
 * - Multi-Leg Transfer Routes: Evaluates pairs (Route A, Route B) to find an intermediate 
 *   connecting stop 'transferPoint' satisfying:
 *   index(from) < index(transferPoint) in Route A AND index(transferPoint) < index(to) in Route B.
 */
function findRoutes(from, to, routes) {
  const norm = s => String(s || "").trim().toLowerCase();
  const targetFrom = norm(from);
  const targetTo = norm(to);

  const directMatches = [];
  const transferMatches = [];

  // 1. Direct Routes
  for (const route of routes) {
    const stops = normalizeStops(route.stops);
    const normStops = stops.map(norm);
    const iFrom = normStops.indexOf(targetFrom);
    const iTo = normStops.indexOf(targetTo);

    if (iFrom !== -1 && iTo !== -1 && iFrom < iTo) {
      directMatches.push({
        type: "direct",
        legs: [{ ...route, stops }],
        stopsCount: iTo - iFrom
      });
    }
  }

  // 2. Multi-Leg Transfer Routes (Route A -> Transfer Point -> Route B)
  for (const routeA of routes) {
    const stopsA = normalizeStops(routeA.stops);
    const normStopsA = stopsA.map(norm);
    const iFromA = normStopsA.indexOf(targetFrom);
    if (iFromA === -1) continue;

    for (const routeB of routes) {
      if (routeA.id === routeB.id) continue;
      const stopsB = normalizeStops(routeB.stops);
      const normStopsB = stopsB.map(norm);
      const iToB = normStopsB.indexOf(targetTo);
      if (iToB === -1) continue;

      // Scan all stops in Route A occurring strictly AFTER boarding stop 'from'
      for (let i = iFromA + 1; i < stopsA.length; i++) {
        const candidateTransfer = stopsA[i];
        const normCand = norm(candidateTransfer);

        if (normCand === targetTo || normCand === targetFrom) continue;

        const iTransferB = normStopsB.indexOf(normCand);

        // Enforce sequence: candidate must appear BEFORE 'to' in Route B
        if (iTransferB !== -1 && iTransferB < iToB) {
          transferMatches.push({
            type: "transfer",
            transferPoint: candidateTransfer,
            legs: [{ ...routeA, stops: stopsA }, { ...routeB, stops: stopsB }],
            stopsCount: (i - iFromA) + (iToB - iTransferB)
          });
          break; // Stop after first valid transfer for this pair
        }
      }
    }
  }

  directMatches.sort((a, b) => a.stopsCount - b.stopsCount);
  transferMatches.sort((a, b) => a.stopsCount - b.stopsCount);

  return [...directMatches, ...transferMatches];
}

/**
 * Handle route search action on button click
 */
async function handleSearch() {
  const from = document.getElementById("from").value;
  const to = document.getElementById("to").value;
  const searchBtn = document.getElementById("searchBtn");

  if (!from || !to) {
    alert("Please select both boarding and destination stops.");
    return;
  }

  if (from === to) {
    alert("Boarding and destination stops must be different. Please select two different stops.");
    return;
  }

  searchBtn.textContent = "Searching Routes...";
  searchBtn.disabled = true;

  try {
    // Gather all available routes (Firestore routes + Fallback routes merged)
    let allRoutes = [...cachedRoutes];
    FALLBACK_ROUTES.forEach(fbRoute => {
      if (!allRoutes.some(r => r.id === fbRoute.id)) {
        allRoutes.push(fbRoute);
      }
    });

    const results = findRoutes(from, to, allRoutes);

    // Store selected search queries and matching routes in localStorage and redirect
    const searchPayload = {
      from,
      to,
      results,
      timestamp: Date.now()
    };

    localStorage.setItem("searchResults", JSON.stringify(searchPayload));
    window.location.href = "results.html";

  } catch (error) {
    console.error("Error during route search:", error);
    // Fallback search execution ensuring user is never stranded
    const results = findRoutes(from, to, FALLBACK_ROUTES);
    localStorage.setItem("searchResults", JSON.stringify({
      from,
      to,
      results,
      timestamp: Date.now()
    }));
    window.location.href = "results.html";
  } finally {
    searchBtn.textContent = "Find Routes";
    searchBtn.disabled = false;
  }
}

/**
 * Swap "From" and "To" selections for convenient reverse discovery
 */
function handleSwap() {
  const fromSelect = document.getElementById("from");
  const toSelect = document.getElementById("to");
  const temp = fromSelect.value;
  fromSelect.value = toSelect.value;
  toSelect.value = temp;
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  loadStops();
  document.getElementById("searchBtn").addEventListener("click", handleSearch);
  document.getElementById("swapBtn").addEventListener("click", handleSwap);
});
