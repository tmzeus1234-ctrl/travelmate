async function render() {
  const data = JSON.parse(localStorage.getItem("searchResults"));
  const output = document.getElementById("output");
  const heading = document.getElementById("heading");

  if (!data || data.results.length === 0) {
    heading.textContent = "No route found";
    output.innerHTML = "<p>Try a different combination, or add more sample routes to Firestore.</p>";
    return;
  }

  heading.textContent = `${data.from} → ${data.to}`;
  const match = data.results[0];

  if (match.type === "direct") {
    output.innerHTML += `<h3>Direct bus</h3>`;
    await renderBusesForRoute(match.legs[0]);
  } else {
    output.innerHTML += `<h3>Leg 1: ${data.from} → ${match.transferPoint}</h3>`;
    await renderBusesForRoute(match.legs[0]);
    output.innerHTML += `<h3 style="margin-top:20px;">Leg 2: ${match.transferPoint} → ${data.to}</h3>`;
    await renderBusesForRoute(match.legs[1]);
  }
}

async function renderBusesForRoute(route) {
  const output = document.getElementById("output");
  output.innerHTML += `<div class="route-stops">Route: ${route.stops.join(" → ")}</div>`;

  const snapshot = await db.collection("buses").where("routeId", "==", route.id).get();
  if (snapshot.empty) {
    output.innerHTML += `<p>No buses added for this route yet.</p>`;
    return;
  }

  snapshot.forEach(doc => {
    const bus = doc.data();
    const card = document.createElement("div");
    card.className = "bus-card";
    card.innerHTML = `
      <div class="reg-number">${bus.registrationNumber}</div>
      <div class="bus-meta">${bus.operator} • ${bus.busType}</div>
      <div class="bus-meta">Departs: ${bus.departureTime || "N/A"}</div>
    `;
    card.onclick = () => {
      window.location.href = `bus.html?busId=${doc.id}`;
    };
    output.appendChild(card);
  });
}

render();
