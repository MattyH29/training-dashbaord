// Training Analytics: loads data.json (built by build_data.py) and renders charts.
const COL = { run: "#38bdf8", cardio: "#2dd4bf", gym: "#fb923c", ride: "#a78bfa", swim: "#2dd4bf", other: "#94a3b8" };
const MAIN_LIFTS = ["Bench Press", "Squat", "Deadlift", "Shoulder Press"];
const charts = {};
let DATA = null, RANGE = "12";

Chart.defaults.color = "#8b9bb0";
Chart.defaults.borderColor = "#263140";
Chart.defaults.font.family = '-apple-system, "Segoe UI", Inter, Roboto, sans-serif';

const $ = (s) => document.querySelector(s);
const sum = (a, f) => a.reduce((t, r) => t + (f(r) || 0), 0);

// ---------- dates (all YYYY-MM-DD strings, Europe/London for "today") ----------
const todayUK = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (s) => addDays(s, -((new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7));
const label = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

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

// ---------- chart helper (destroys the old instance before redrawing) ----------
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

const num = (v, d = 1) => (v == null ? "–" : v.toLocaleString("en-GB", { maximumFractionDigits: d }));
const pace = (v) => (v == null ? "–" : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`.replace(/^(\d+):60$/, (_, m) => `${+m + 1}:00`));

function bar(id, labels, values, color, unit, d = 1) {
  draw(id, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${num(c.parsed.y, d)} ${unit}` } } }, scales: { y: { beginAtZero: true } } },
  }, values.some((v) => v));
}

// ---------- groups ----------
const groupOf = (t) => (/run/i.test(t) ? "Run" : /ride|bike/i.test(t) ? "Cycling" : /swim/i.test(t) ? "Swim" : "Other cardio");
const GROUP_COL = { Run: COL.run, Cycling: COL.ride, Swim: COL.swim, "Other cardio": COL.other };

// ---------- render ----------
function render() {
  const weeks = weekStarts(), labels = weeks.map(label);
  const acts = DATA.activities.map((a) => ({ ...a, g: groupOf(a.type) }));

  // Running
  const runs = byWeek(acts.filter((a) => a.g === "Run"), weeks);
  bar("runDist", labels, runs.map((w) => sum(w, (r) => r.km)), COL.run, "km");
  bar("runTime", labels, runs.map((w) => sum(w, (r) => r.min) / 60), COL.run, "h", 2);

  // Pace = total time / total distance over runs with valid distance and duration
  const paceVals = runs.map((w) => {
    const v = w.filter((r) => r.km > 0 && r.min > 0);
    const km = sum(v, (r) => r.km);
    return km > 0 ? sum(v, (r) => r.min) / km : null;
  });
  draw("runPace", {
    type: "line",
    data: { labels, datasets: [{ data: paceVals, borderColor: COL.run, backgroundColor: COL.run, tension: 0.25, pointRadius: 3, spanGaps: true }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${pace(c.parsed.y)} min/km` } } },
      scales: { y: { reverse: true, ticks: { callback: (v) => pace(v) } } } },
  }, paceVals.some((v) => v != null));

  // Elevation: weeks with runs but no elevation values stay empty rather than zero
  const elev = runs.map((w) => { const v = w.filter((r) => r.elev != null); return v.length ? sum(v, (r) => r.elev) : null; });
  draw("runElev", {
    type: "bar",
    data: { labels, datasets: [{ data: elev, backgroundColor: COL.run, borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${num(c.parsed.y, 0)} m` } } }, scales: { y: { beginAtZero: true } } },
  }, elev.some((v) => v != null));

  // Activity mix (duration only, so units stay comparable)
  const groups = Object.keys(GROUP_COL);
  const wk = byWeek(acts, weeks);
  const datasets = groups.map((g) => ({
    label: g, backgroundColor: GROUP_COL[g], borderRadius: 2,
    data: wk.map((w) => sum(w.filter((r) => r.g === g), (r) => r.min) / 60),
  }));
  draw("mix", {
    type: "bar", data: { labels, datasets },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.parsed.y, 2)} h` } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
  }, datasets.some((d) => d.data.some((v) => v)));

  // Totals table (distance shown separately per type, never summed across types)
  const inRange = wk.flat();
  const rows = groups.map((g) => {
    const r = inRange.filter((a) => a.g === g);
    return r.length ? `<tr><td>${g}</td><td>${r.length}</td><td>${num(sum(r, (x) => x.km))}</td><td>${num(sum(r, (x) => x.min) / 60)}</td></tr>` : "";
  }).join("");
  $("#totals").innerHTML = rows
    ? `<table><tr><th>Type</th><th>Sessions</th><th>Distance (km)</th><th>Time (h)</th></tr>${rows}</table>`
    : '<p class="note">No activities in this range.</p>';

  // Gym
  const gym = byWeek(DATA.gym, weeks);
  bar("gymCount", labels, gym.map((w) => w.length), COL.gym, "sessions", 0);
  bar("gymVol", labels, gym.map((w) => sum(w, (r) => r.vol)), COL.gym, "kg", 0);

  renderLift(weeks[0]);
}

function renderLift(startWeek) {
  const ex = $("#lift").value;
  const pts = DATA.lifts.filter((l) => l.ex === ex && l.d >= startWeek);
  const best = (f) => pts.reduce((b, p) => (p[f] != null && (!b || p[f] > b[f]) ? p : b), null);
  const bw = best("kg"), be = best("e1rm");
  $("#liftStats").innerHTML = pts.length
    ? `<div class="stat"><b>${num(bw?.kg)} kg${bw?.reps ? ` × ${bw.reps}` : ""}</b><span>Best top set (recorded)</span></div>
       <div class="stat"><b>${num(be?.e1rm)} kg</b><span>Best estimated 1RM (Epley)</span></div>
       <div class="stat"><b>${pts.length}</b><span>Sessions logged</span></div>` : "";
  const l = pts.map((p) => label(p.d) + (p.d.slice(0, 4) !== todayUK().slice(0, 4) ? " " + p.d.slice(2, 4) : ""));
  draw("liftChart", {
    type: "line",
    data: { labels: l, datasets: [
      { label: "Top set weight (kg)", data: pts.map((p) => p.kg), borderColor: COL.gym, backgroundColor: COL.gym, tension: 0.2, pointRadius: 3 },
      { label: "Estimated 1RM (kg)", data: pts.map((p) => p.e1rm), borderColor: "#fdba74", borderDash: [6, 4], tension: 0.2, pointRadius: 2 },
    ] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } },
      tooltip: { callbacks: { afterBody: (items) => (pts[items[0].dataIndex].reps ? `Reps: ${pts[items[0].dataIndex].reps}` : "") } } } },
  }, pts.length > 0);
}

// ---------- boot ----------
function showMsg(html) { const m = $("#msg"); m.innerHTML = html; m.hidden = false; $("#content").hidden = true; }

async function init() {
  try {
    const r = await fetch("data.json?v=" + Date.now());
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch {
    return showMsg("<b>No data yet.</b> data.json could not be loaded. Run the “Build and deploy dashboard” workflow in GitHub Actions and check that the Notion secrets are set.");
  }
  if (!DATA.activities?.length && !DATA.gym?.length && !DATA.lifts?.length)
    return showMsg("<b>No data found.</b> The export worked but the Notion databases returned no rows. Check the integration has access to all three databases.");

  $("#updated").textContent = "Updated " + new Date(DATA.generated_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });

  const names = [...new Set(DATA.lifts.map((l) => l.ex))];
  names.sort((a, b) => { const i = (n) => (MAIN_LIFTS.includes(n) ? MAIN_LIFTS.indexOf(n) : 99); return i(a) - i(b) || a.localeCompare(b); });
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
