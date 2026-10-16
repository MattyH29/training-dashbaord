// Charts page. Uses helpers from shared.js.
let DATA = null, RANGE = "12";
const charts = {};
const GROUPS = ["Run", "Cycling", "Swim", "Other cardio"];

function weekStarts() {
  const end = monday(todayUK());
  let start;
  if (RANGE === "all") {
    const all = [...DATA.activities, ...DATA.gym, ...DATA.lifts].map((r) => r.d).sort();
    start = all.length ? monday(all[0]) : end;
  } else start = addDays(end, -7 * (Number(RANGE) - 1));
  const out = [];
  for (let w = start; w <= end; w = addDays(w, 7)) out.push(w);
  return out;
}
function byWeek(rows, weeks) {
  const m = new Map(weeks.map((w) => [w, []]));
  rows.forEach((r) => { const k = monday(r.d); if (m.has(k)) m.get(k).push(r); });
  return weeks.map((w) => m.get(w));
}

// Destroys any previous chart on the canvas before drawing.
function draw(id, config, hasData) {
  charts[id]?.destroy();
  delete charts[id];
  const box = $("#" + id).parentElement;
  box.querySelector(".empty")?.remove();
  $("#" + id).style.display = hasData ? "" : "none";
  if (!hasData) { box.insertAdjacentHTML("beforeend", '<div class="empty">No data in this range</div>'); return; }
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false } }, config.options);
  charts[id] = new Chart($("#" + id), config);
}
function bar(id, labels, values, color, unit, d = 1) {
  draw(id, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${num(c.parsed.y, d)} ${unit}` } } }, scales: { y: { beginAtZero: true } } },
  }, values.some((v) => v));
}

function render() {
  const C = colours();
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  const weeks = weekStarts(), labels = weeks.map(label);
  const acts = DATA.activities.map((a) => ({ ...a, g: groupOf(a.type) }));
  const runs = byWeek(acts.filter((a) => a.g === "Run"), weeks);

  bar("runDist", labels, runs.map((w) => sum(w, (r) => r.km)), C.run, "km");
  bar("runTime", labels, runs.map((w) => sum(w, (r) => r.min) / 60), C.run, "h", 2);
  bar("runCount", labels, runs.map((w) => w.length), C.run, "runs", 0);
  // No runs in a week gives a gap, not a zero
  bar("runLong", labels, runs.map((w) => (w.length ? Math.max(...w.map((r) => r.km || 0)) : null)), C.run, "km");

  const paceVals = runs.map((w) => {
    const v = w.filter((r) => r.km > 0 && r.min > 0), km = sum(v, (r) => r.km);
    return km > 0 ? sum(v, (r) => r.min) / km : null;
  });
  draw("runPace", {
    type: "line",
    data: { labels, datasets: [{ data: paceVals, borderColor: C.run, backgroundColor: C.run, tension: 0.25, pointRadius: 3, spanGaps: true }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${pace(c.parsed.y)} min/km` } } },
      scales: { y: { reverse: true, ticks: { callback: (v) => pace(v) } } } },
  }, paceVals.some((v) => v != null));

  const elev = runs.map((w) => { const v = w.filter((r) => r.elev != null); return v.length ? sum(v, (r) => r.elev) : null; });
  bar("runElev", labels, elev, C.run, "m", 0);

  // Training time by discipline (duration only, so units stay comparable)
  const colOf = { Run: C.run, Cycling: C.ride, Swim: C.cardio, "Other cardio": C.other };
  const wk = byWeek(acts, weeks), gymWk = byWeek(DATA.gym, weeks);
  const datasets = GROUPS.map((g) => ({ label: g, backgroundColor: colOf[g], borderRadius: 2,
    data: wk.map((w) => sum(w.filter((r) => r.g === g), (r) => r.min) / 60) }));
  datasets.push({ label: "Gym", backgroundColor: C.gym, borderRadius: 2, data: gymWk.map((w) => sum(w, (r) => r.min) / 60) });
  draw("mix", {
    type: "bar", data: { labels, datasets },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.parsed.y, 2)} h` } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
  }, datasets.some((d) => d.data.some((v) => v)));

  // Distances stay per type and are never summed together
  const inRange = wk.flat();
  const rows = GROUPS.map((g) => {
    const r = inRange.filter((a) => a.g === g);
    return r.length ? `<tr><td>${g}</td><td>${r.length}</td><td>${num(sum(r, (x) => x.km))}</td><td>${num(sum(r, (x) => x.min) / 60)}</td></tr>` : "";
  }).join("");
  $("#totals").innerHTML = rows
    ? `<table><tr><th>Type</th><th>Sessions</th><th>Distance (km)</th><th>Time (h)</th></tr>${rows}</table>`
    : '<p class="note">No activities in this range.</p>';

  bar("gymCount", labels, gymWk.map((w) => w.length), C.gym, "sessions", 0);
  bar("gymVol", labels, gymWk.map((w) => sum(w, (r) => r.vol)), C.gym, "kg", 0);
  renderLift(weeks[0]);
}

function renderLift(startWeek) {
  const C = colours(), ex = $("#lift").value;
  const pts = DATA.lifts.filter((l) => l.ex === ex && l.d >= startWeek);
  const best = (f) => pts.reduce((b, p) => (p[f] != null && (!b || p[f] > b[f]) ? p : b), null);
  const bw = best("kg"), be = best("e1rm");
  $("#liftStats").innerHTML = pts.length
    ? `<div class="stat"><b>${num(bw?.kg)} kg${bw?.reps ? ` × ${bw.reps}` : ""}</b><span>Best top set (recorded)</span></div>
       <div class="stat"><b>${num(be?.e1rm)} kg</b><span>Best estimated 1RM (Epley)</span></div>
       <div class="stat"><b>${pts.length}</b><span>Sessions logged</span></div>` : "";
  const yr = todayUK().slice(0, 4);
  const labels = pts.map((p) => label(p.d) + (p.d.slice(0, 4) !== yr ? " " + p.d.slice(2, 4) : ""));
  draw("liftChart", {
    type: "line",
    data: { labels, datasets: [
      { label: "Top set weight (kg)", data: pts.map((p) => p.kg), borderColor: C.gym, backgroundColor: C.gym, tension: 0.2, pointRadius: 3 },
      { label: "Estimated 1RM (kg)", data: pts.map((p) => p.e1rm), borderColor: C.gym, borderDash: [6, 4], tension: 0.2, pointRadius: 2 },
    ] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } },
      tooltip: { callbacks: { afterBody: (i) => (pts[i[0].dataIndex].reps ? `Reps: ${pts[i[0].dataIndex].reps}` : "") } } } },
  }, pts.length > 0);
}

async function init() {
  DATA = await loadData();
  if (!DATA) { $("#content").hidden = true; return; }
  $("#updated").textContent = "Updated " + new Date(DATA.generated_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });
  const names = [...new Set(DATA.lifts.map((l) => l.ex))];
  const rank = (n) => (MAIN_LIFTS.includes(n) ? MAIN_LIFTS.indexOf(n) : 99);
  names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  $("#lift").innerHTML = names.map((n) => `<option>${n}</option>`).join("");
  $("#lift").onchange = () => renderLift(weekStarts()[0]);
  document.querySelectorAll("#range button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b));
    RANGE = b.dataset.w;
    render();
  }));
  render();
}
init();
