// ---- Load all stops into the From/To dropdowns ----
async function loadStops() {
  const snapshot = await db.collection("routes").get();
  const stopsSet = new Set();
  snapshot.forEach(doc => {
    const route = doc.data();
    route.stops.forEach(s => stopsSet.add(s));
  });

  const stops = Array.from(stopsSet).sort();
  const fromSelect = document.getElementById("from");
  const toSelect = document.getElementById("to");

  stops.forEach(stop => {
    fromSelect.innerHTML += `<option value="${stop}">${stop}</option>`;
    toSelect.innerHTML += `<option value="${stop}">${stop}</option>`;
  });
}
loadStops();

// ---- Search logic: find direct route, or one-transfer combo ----
async function searchRoutes(from, to) {
  const snapshot = await db.collection("routes").get();
  const routes = [];
  snapshot.forEach(doc => routes.push({ id: doc.id, ...doc.data() }));

  // 1. Check for a direct route (from appears before to in the same route)
  for (const route of routes) {
    const iFrom = route.stops.indexOf(from);
    const iTo = route.stops.indexOf(to);
    if (iFrom !== -1 && iTo !== -1 && iFrom < iTo) {
      return [{ type: "direct", legs: [route] }];
    }
  }

  // 2. Check for a one-transfer combo: routeA has 'from', routeB has 'to',
  //    and they share a common stop where you can change buses.
  for (const routeA of routes) {
    if (!routeA.stops.includes(from)) continue;
    for (const routeB of routes) {
      if (routeA.id === routeB.id || !routeB.stops.includes(to)) continue;
      const shared = routeA.stops.find(s => routeB.stops.includes(s) && s !== from && s !== to);
      if (shared) {
        return [{ type: "transfer", transferPoint: shared, legs: [routeA, routeB] }];
      }
    }
  }

  return []; // no route found
}

// ---- On search button click ----
document.getElementById("searchBtn").addEventListener("click", async () => {
  const from = document.getElementById("from").value;
  const to = document.getElementById("to").value;
  if (from === to) { alert("Pick two different stops."); return; }

  const results = await searchRoutes(from, to);
  // Pass results to the results page via localStorage (simple for a hackathon demo)
  localStorage.setItem("searchResults", JSON.stringify({ from, to, results }));
  window.location.href = "results.html";
});
