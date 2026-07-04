// Tesla Lease Deal Tracker — renders history.json into deal cards + charts.

const fmtMoney = (n) => n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US");
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// True monthly cost = all upfront cash + remaining monthly payments, spread over the term.
// This lets us compare offers fairly even when down payments differ.
function effectiveMonthly(s) {
  if (!s.available || s.monthly == null) return null;
  if (s.dueAtSigning != null && s.termMonths) {
    return (s.dueAtSigning + s.monthly * (s.termMonths - 1)) / s.termMonths;
  }
  return s.monthly;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

// Classify the latest offer against its own history.
function scoreDeal(series) {
  const avail = series.filter((s) => effectiveMonthly(s) != null);
  if (avail.length === 0) return { kind: "none", label: "No lease offered yet" };
  const latest = avail[avail.length - 1];
  const cur = effectiveMonthly(latest);
  const values = avail.map(effectiveMonthly);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // How long since we last saw a price this low (or lower)?
  let bestInDays = 0;
  const firstDate = avail[0].date;
  for (let i = avail.length - 1; i >= 0; i--) {
    if (effectiveMonthly(avail[i]) < cur - 0.5) break;
    bestInDays = daysBetween(avail[i].date, latest.date);
  }

  if (avail.length === 1) {
    return { kind: "good", label: "Baseline set — tracking starts now", cur, min, max, median };
  }
  if (cur <= min + 0.5) {
    const span = daysBetween(firstDate, latest.date);
    const label = span >= bestInDays && span > 0
      ? `Best deal in ${span} days of tracking`
      : "Best deal on record";
    return { kind: "best", label, cur, min, max, median };
  }
  const pctAboveMin = ((cur - min) / min) * 100;
  if (pctAboveMin <= 2) return { kind: "great", label: "Near the best price seen", cur, min, max, median };
  if (cur <= median)     return { kind: "good",  label: "Below average — decent time", cur, min, max, median };
  return { kind: "wait", label: "Above average — consider waiting", cur, min, max, median };
}

function stat(label, value, sub, delta) {
  const d = delta
    ? `<div class="delta ${delta.dir}">${delta.text}</div>`
    : "";
  return `<div class="stat"><div class="label">${label}</div>
    <div class="value">${value}${sub ? ` <small>${sub}</small>` : ""}</div>${d}</div>`;
}

function deltaVsPrev(series) {
  const avail = series.filter((s) => s.available && s.monthly != null);
  if (avail.length < 2) return null;
  const cur = avail[avail.length - 1].monthly;
  const prev = avail[avail.length - 2].monthly;
  const diff = cur - prev;
  if (Math.abs(diff) < 0.5) return { dir: "flat", text: "no change since last check" };
  const dir = diff < 0 ? "down" : "up";
  const arrow = diff < 0 ? "▼" : "▲";
  return { dir, text: `${arrow} ${fmtMoney(Math.abs(diff))}/mo vs. last check` };
}

function renderModel(container, modelKey, model, allSnaps) {
  const series = allSnaps
    .filter((s) => s.model === modelKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = series[series.length - 1];
  const score = scoreDeal(series);
  const card = document.createElement("section");
  card.className = "card";

  const badgeClass = { best: "best", great: "great", good: "good", wait: "wait", none: "none" }[score.kind];

  let statsHtml = "";
  let verdictHtml = "";
  if (score.kind === "none") {
    verdictHtml = `<p class="verdict">${model.note || "Tesla is not offering a lease on this model yet."}
      The tracker checks daily and will flag the first lease offer here.</p>`;
    statsHtml = `<div class="stats">
      ${stat("Cash price", "$61,990", "Launch Series")}
      ${stat("Lease status", "Not offered", "watching")}
      ${stat("Days watched", String(series.length))}
    </div>`;
  } else {
    const delta = deltaVsPrev(series);
    const eff = effectiveMonthly(latest);
    statsHtml = `<div class="stats">
      ${stat("Advertised", fmtMoney(latest.monthly), "/mo", delta)}
      ${stat("True cost", fmtMoney(eff), "/mo all-in")}
      ${stat("Due at signing", fmtMoney(latest.dueAtSigning))}
      ${stat("Term", latest.termMonths ? latest.termMonths + " mo" : "—", latest.milesPerYear ? (latest.milesPerYear/1000) + "k mi/yr" : "")}
      ${stat("Interest (APR)", latest.apr != null ? latest.apr.toFixed(2) + "%" : "—", latest.moneyFactor != null ? "MF " + latest.moneyFactor : "not published")}
    </div>`;
    const lowSpread = score.max > score.min
      ? `Range seen: ${fmtMoney(score.min)}–${fmtMoney(score.max)}/mo all-in.`
      : "";
    verdictHtml = `<p class="verdict"><strong>${score.label}.</strong> ${lowSpread}</p>`;
  }

  card.innerHTML = `
    <div class="card-head">
      <div>
        <h2>${model.name}</h2>
        <div class="trim">${latest.available ? latest.trim : (model.note ? "Purchase only" : "")}</div>
      </div>
      <div class="badge ${badgeClass}">${score.label}</div>
    </div>
    ${statsHtml}
    ${verdictHtml}
    <div class="charts">
      <div class="chart-box"><h3>Monthly payment over time</h3><canvas id="pay-${modelKey}"></canvas></div>
      <div class="chart-box"><h3>Effective interest (APR) over time</h3><canvas id="apr-${modelKey}"></canvas></div>
    </div>
  `;
  container.appendChild(card);

  drawCharts(modelKey, series);
}

const CHART_DEFAULTS = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: "#9aa0aa", maxRotation: 0, autoSkip: true }, grid: { color: "#2a2f3a" } },
    y: { ticks: { color: "#9aa0aa" }, grid: { color: "#2a2f3a" } }
  }
};

function drawCharts(modelKey, series) {
  const avail = series.filter((s) => s.available && s.monthly != null);
  const labels = avail.map((s) => fmtDate(s.date));

  const payCtx = document.getElementById("pay-" + modelKey);
  const aprCtx = document.getElementById("apr-" + modelKey);

  if (avail.length === 0) {
    payCtx.parentElement.innerHTML = '<h3>Monthly payment over time</h3><p class="empty">No lease offers recorded yet.</p>';
    aprCtx.parentElement.innerHTML = '<h3>Effective interest (APR) over time</h3><p class="empty">No interest data yet.</p>';
    return;
  }

  new Chart(payCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Advertised $/mo", data: avail.map((s) => s.monthly), borderColor: "#e82127", backgroundColor: "rgba(232,33,39,.12)", fill: true, tension: .25, pointRadius: 3 },
        { label: "True cost $/mo", data: avail.map(effectiveMonthly), borderColor: "#f4c542", borderDash: [5,4], fill: false, tension: .25, pointRadius: 2 }
      ]
    },
    options: { ...CHART_DEFAULTS, plugins: { legend: { display: true, labels: { color: "#9aa0aa", boxWidth: 12 } } } }
  });

  const hasApr = avail.some((s) => s.apr != null);
  if (!hasApr) {
    aprCtx.parentElement.innerHTML = '<h3>Effective interest (APR) over time</h3><p class="empty">Tesla hasn\'t published lease interest (money factor) for this offer. Will chart it once available.</p>';
    return;
  }
  new Chart(aprCtx, {
    type: "line",
    data: { labels, datasets: [{ label: "APR %", data: avail.map((s) => s.apr), borderColor: "#27d17c", backgroundColor: "rgba(39,209,124,.12)", fill: true, tension: .25, pointRadius: 3 }] },
    options: CHART_DEFAULTS
  });
}

async function main() {
  const app = document.getElementById("app");
  try {
    const res = await fetch("data/history.json?" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const db = await res.json();
    app.innerHTML = "";
    document.getElementById("updated").textContent =
      "Last updated " + fmtDate(db.meta.lastUpdated) + " · " + db.snapshots.length + " snapshots recorded";
    for (const [key, model] of Object.entries(db.models)) {
      renderModel(app, key, model, db.snapshots);
    }
  } catch (e) {
    app.innerHTML = `<p class="empty">Couldn't load data (${e.message}). If you just opened the file directly, run it through a local server instead.</p>`;
  }
}

main();
