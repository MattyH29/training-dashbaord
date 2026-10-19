// Training analysis page. Uses helpers from shared.js.
let D, ACTS, RUNS, C, BAD, RANGE = "12", RAMP = "km", TAB = "run", SORT = { k: "d", dir: -1 };
const charts = {};
const kmOf = (w) => sum(w, (r) => r.km);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmtDate = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dur = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const S = (l, v, c = "") => `<div class="stat"><b class="${c}">${v}</b><span>${l}</span></div>`;
const group = (rows, weeks) => {
  const m = new Map(weeks.map((w) => [w, []]));
  rows.forEach((r) => { const k = monday(r.d); if (m.has(k)) m.get(k).push(r); });
  return weeks.map((w) => m.get(w));
};
function rangeWeeks() {
  const end = monday(todayUK());
  let start;
  if (RANGE === "all") {
    const all = [...D.activities, ...D.gym].map((r) => r.d).sort();
    start = all.length ? monday(all[0]) : end;
  } else start = addDays(end, -7 * (Number(RANGE) - 1));
  const out = [];
  for (let w = start; w <= end; w = addDays(w, 7)) out.push(w);
  return out;
}

// bar + line builder with optional right-hand axis. ds: {type,label,data,color,axis,fmt,dash,pr,outline}
function mixCfg(labels, ds, axes) {
  const datasets = ds.map((d) => ({ type: d.type, label: d.label, data: d.data, yAxisID: d.axis, fmt: d.fmt,
    ...(d.type === "bar"
      ? { backgroundColor: d.outline ? d.color + "33" : d.color, borderColor: d.color, borderWidth: d.outline ? 1.5 : 0, borderRadius: 3, order: 2 }
      : { borderColor: d.color, backgroundColor: d.color, tension: 0.25, pointRadius: d.pr ?? 3, spanGaps: true, order: 1, borderDash: d.dash || [] }) }));
  const scales = {};
  axes.forEach((a) => { scales[a.id] = { position: a.id === "y" ? "left" : "right", beginAtZero: !!a.zero, title: { display: true, text: a.t },
    grid: { drawOnChartArea: a.id === "y" }, ...(a.max ? { suggestedMax: a.max } : {}) }; });
  return { type: "bar", data: { labels, datasets }, options: { plugins: { legend: { display: ds.length > 1, position: "bottom", labels: { boxWidth: 10 } },
    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.dataset.fmt ? c.dataset.fmt(c.parsed.y) : num(c.parsed.y)}` } } }, scales } };
}
function draw(id, cfg, ok = true) {
  charts[id]?.destroy(); delete charts[id];
  const cv = $("#" + id), box = cv.parentElement;
  box.querySelector(".empty")?.remove();
  cv.style.display = ok ? "" : "none";
  if (!ok) { box.insertAdjacentHTML("beforeend", '<div class="empty">Not enough data yet</div>'); return; }
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false } }, cfg.options);
  charts[id] = new Chart(cv, cfg);
}
function donut(id, items, centre) {
  items = items.filter((i) => i.v > 0);
  const ok = items.length > 0, tot = sum(items, (i) => i.v);
  draw(id, { type: "doughnut", data: { labels: items.map((i) => i.l), datasets: [{ data: items.map((i) => i.v), backgroundColor: items.map((i) => i.c), borderWidth: 0 }] },
    options: { cutout: "70%", interaction: { mode: "nearest", intersect: true }, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${items[c.dataIndex].f}` } } } } }, ok);
  $("#" + id + "Lg").innerHTML = items.map((i) => `<div class="lg"><i style="background:${i.c}"></i><span>${i.l}</span><b>${i.f}</b></div>`).join("");
  $("#" + id + "C").innerHTML = ok ? centre(tot) : "";
}

// ---------- 1. Race countdown ----------
function renderHero() {
  const today = todayUK(), race = D.races.filter((r) => r.d >= today)[0], el = $("#hero");
  if (!race) {
    el.style.gridTemplateColumns = "1fr";
    el.innerHTML = `<div><div class="eyebrow">Race countdown</div><div class="rname" style="margin-top:6px">No upcoming race found</div><div class="d">${D.has_races_db
      ? "Add a future-dated race to your Races database."
      : "Add the <b>NOTION_RACES_DB</b> secret, share the database with the integration and re-run the workflow."}</div></div>`;
    return;
  }
  const left = days(today, race.d), taper = addDays(race.d, -14), toTaper = days(today, taper);
  const plan = D.plan.filter((p) => p.d >= today && p.d <= race.d);
  const ws = [];
  for (let w = monday(today); w <= race.d; w = addDays(w, 7)) ws.push(w);
  const peak = Math.max(0, ...group(plan, ws).map(kmOf));
  const longestDone = Math.max(0, ...RUNS.map((r) => r.km || 0));
  const longestPlan = Math.max(0, ...plan.map((p) => p.km || 0));
  const first = D.plan.length ? D.plan[0].d : null, total = first ? days(first, race.d) : 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (days(first, today) / total) * 100)) : null;
  const tp = total > 0 ? Math.max(0, Math.min(100, (days(first, taper) / total) * 100)) : null;
  const hasPlan = D.plan.length > 0;
  el.innerHTML = `
    <div><div class="eyebrow">Race countdown</div><div class="big">${left}</div><div class="unit">${left === 1 ? "day" : "days"} to go</div></div>
    <div><div class="rname">${esc(race.name)}</div>
      <div class="d">${fmtDate(race.d)} · ${(left / 7).toFixed(1)} weeks${race.km ? ` · ${num(race.km, 0)} km` : ""}${race.elev ? ` · ${num(race.elev, 0)} m climb` : ""}</div>
      <div class="stats tiles">
        ${S("Planned km remaining", hasPlan ? num(sum(plan, (p) => p.km), 0) + " km" : "–")}
        ${S("Sessions remaining", hasPlan ? plan.filter((p) => p.km > 0 || p.min > 0).length : "–")}
        ${S("Peak planned week", hasPlan ? num(peak, 0) + " km" : "–")}
        ${S("Longest run so far", num(longestDone) + " km")}
        ${S("Longest planned run", hasPlan && longestPlan ? num(longestPlan) + " km" : "–")}
      </div>
      ${pct == null ? "" : `<div class="pbar"><i style="width:${pct}%"></i><u style="left:${tp}%"></u></div>
      <div class="d">Plan ${Math.round(pct)}% elapsed · ${toTaper > 0 ? `a typical 2-week taper would start in ${toTaper} days (orange marker)` : "inside the typical 2-week taper window"}</div>`}
    </div>`;
}

// ---------- 2. Plan vs actual ----------
function renderPlan() {
  const tw = monday(todayUK()), weeks = Array.from({ length: 12 }, (_, i) => addDays(tw, -49 + 7 * i));
  const ok = D.has_plan_db && D.plan.length > 0;
  $("#planMsg").hidden = ok; $("#planMain").hidden = !ok; $("#planSide").hidden = !ok;
  if (!ok) {
    $("#planMsg").innerHTML = D.has_plan_db ? "No Training Plan rows found." : "Plan data unavailable. Add the <b>NOTION_PLAN_DB</b> secret, share the Training Plan database with the integration and re-run the workflow.";
    return;
  }
  const planKm = group(D.plan, weeks).map(kmOf), act = group(RUNS, weeks).map(kmOf);
  const actual = act.map((v, i) => (weeks[i] <= tw ? v : null));
  const adh = weeks.map((w, i) => (w < tw && planKm[i] > 0 ? (act[i] / planKm[i]) * 100 : null));
  draw("planChart", mixCfg(weeks.map(label), [
    { type: "bar", label: "Planned", data: planKm, color: C.run, outline: true, axis: "y", fmt: (v) => num(v) + " km" },
    { type: "bar", label: "Actual", data: actual, color: C.run, axis: "y", fmt: (v) => num(v) + " km" },
    { type: "line", label: "Adherence", data: adh, color: C.ride, axis: "y1", fmt: (v) => Math.round(v) + "%" }],
    [{ id: "y", t: "km", zero: true }, { id: "y1", t: "% of plan", zero: true, max: 120 }]));
  const idx = weeks.map((w, i) => (w < tw ? i : -1)).filter((i) => i >= 0).slice(-4);
  const p = sum(idx, (i) => planKm[i]), a = sum(idx, (i) => act[i]), pct = p > 0 ? (a / p) * 100 : null;
  const ring = $("#ring");
  ring.style.setProperty("--p", pct == null ? 0 : Math.min(pct, 100));
  ring.style.setProperty("--a", pct == null ? "var(--line)" : pct >= 90 ? "var(--good)" : pct >= 70 ? "var(--gym)" : "var(--bad)");
  $("#ringN").textContent = pct == null ? "–" : Math.round(pct) + "%";
  $("#ringTxt").innerHTML = pct == null ? "No planned km in the last 4 full weeks." : `${num(a, 0)} km run of ${num(p, 0)} km planned<br>last 4 full weeks`;
}

// ---------- 3. Ramp rate ----------
function renderRamp() {
  const weeks = rangeWeeks(), tw = monday(todayUK());
  const all = [...Array.from({ length: 4 }, (_, i) => addDays(weeks[0], -7 * (4 - i))), ...weeks];
  const val = RAMP === "km" ? group(RUNS, all).map(kmOf)
    : group(ACTS, all).map((w, i) => sum(w, (r) => r.min) / 60 + sum(group(D.gym, all)[i], (r) => r.min) / 60);
  const ratio = all.map((w, i) => {
    if (i < 4 || w >= tw) return null;
    const base = (val[i - 4] + val[i - 3] + val[i - 2] + val[i - 1]) / 4;
    return base > 0 ? val[i] / base : null;
  });
  const unit = RAMP === "km" ? "km" : "h";
  draw("rampChart", mixCfg(weeks.map(label), [
    { type: "bar", label: RAMP === "km" ? "Run distance" : "Training time", data: val.slice(4), color: C.run, axis: "y", fmt: (v) => num(v) + " " + unit },
    { type: "line", label: "Ramp (× prior 4-wk avg)", data: ratio.slice(4), color: C.ride, axis: "y1", fmt: (v) => v.toFixed(2) + "×" },
    { type: "line", label: "1.3× guide", data: weeks.map(() => 1.3), color: BAD, dash: [5, 4], pr: 0, axis: "y1", fmt: (v) => v.toFixed(1) + "×" }],
    [{ id: "y", t: unit, zero: true }, { id: "y1", t: "× average", zero: true, max: 2 }]));
  const li = all.indexOf(addDays(tw, -7)), r = li >= 4 ? ratio[li] : null;
  const v = r == null ? ["–", "Not enough history", "var(--muted)"] : r < 0.8 ? ["", "Easing off", "var(--muted)"] : r <= 1.3 ? ["", "Steady build", "var(--good)"]
    : r <= 1.5 ? ["", "Rapid build", "var(--gym)"] : ["", "Big spike", "var(--bad)"];
  $("#rampN").textContent = r == null ? "–" : r.toFixed(2) + "×";
  $("#rampN").style.color = v[2];
  $("#rampV").textContent = v[1]; $("#rampV").style.color = v[2];
  $("#rampTxt").innerHTML = `Last full week compared with the average of the 4 weeks before it. Roughly 0.8 to 1.3× is a steady build and above 1.5× is a spike. A simple guide, not medical advice.<br><br>This week so far: <b>${num(val[val.length - 1])} ${unit}</b>`;
}

// ---------- 4. Long runs and time on feet ----------
function renderLong() {
  const weeks = rangeWeeks(), wk = group(RUNS, weeks);
  const km = wk.map((w) => (w.length ? Math.max(...w.map((r) => r.km || 0)) : null));
  const mins = wk.map((w) => (w.length ? Math.max(...w.map((r) => r.min || 0)) : null));
  let b2b = 0, bestWe = 0;
  weeks.forEach((w) => {
    const sat = RUNS.filter((r) => r.d === addDays(w, 5)), sun = RUNS.filter((r) => r.d === addDays(w, 6));
    const s = kmOf(sat) + kmOf(sun);
    if (kmOf(sat) >= 3 && kmOf(sun) >= 3) b2b++;
    bestWe = Math.max(bestWe, s);
  });
  const mk = Math.max(0, ...km.filter((x) => x != null)), mm = Math.max(0, ...mins.filter((x) => x != null));
  $("#longStrip").innerHTML = S("Longest run", num(mk) + " km") + S("Longest time on feet", dur(mm)) + S("Back-to-back weekends", b2b) + S("Best weekend", num(bestWe) + " km");
  draw("longChart", mixCfg(weeks.map(label), [
    { type: "bar", label: "Longest run", data: km, color: C.run, axis: "y", fmt: (v) => num(v) + " km" },
    { type: "line", label: "Longest run time", data: mins, color: C.cardio, axis: "y1", fmt: (v) => dur(v) }],
    [{ id: "y", t: "km", zero: true }, { id: "y1", t: "minutes", zero: true }]), km.some((x) => x));
}

// ---------- doughnuts ----------
function renderDonuts() {
  const weeks = rangeWeeks();
  const acts = group(ACTS, weeks).flat(), gym = group(D.gym, weeks).flat();
  const hrs = (rows) => sum(rows, (r) => r.min) / 60;
  const col = { Run: C.run, Cycling: C.ride, Swim: C.cardio, "Other cardio": C.other };
  const items = Object.keys(col).map((g) => ({ l: g, v: hrs(acts.filter((a) => a.g === g)), c: col[g] }));
  items.push({ l: "Gym", v: hrs(gym), c: C.gym });
  items.forEach((i) => (i.f = num(i.v) + " h"));
  donut("mix", items, (t) => `<div><b>${num(t, 0)} h</b><span>total</span></div>`);

  const runs = group(RUNS, weeks).flat(), bands = [["Under 5 km", 0, 5, 0.35], ["5 to 10 km", 5, 10, 0.55], ["10 to 20 km", 10, 20, 0.78], ["20 km +", 20, 1e9, 1]];
  const bi = bands.map(([l, lo, hi, o]) => ({ l, v: kmOf(runs.filter((r) => r.km >= lo && r.km < hi)), c: C.run + Math.round(o * 255).toString(16).padStart(2, "0") }));
  bi.forEach((i) => (i.f = num(i.v, 0) + " km"));
  donut("bands", bi, (t) => `<div><b>${num(t, 0)} km</b><span>run</span></div>`);
}

// ---------- 5. Efficiency scatter ----------
function renderEff() {
  const start = rangeWeeks()[0];
  const pts = RUNS.filter((r) => r.d >= start && r.hr > 0 && r.km >= 2 && r.min > 0).map((r) => ({ x: r.min / r.km, y: r.hr, d: r.d, km: r.km, e: ((r.km * 1000) / r.min) / r.hr }));
  const recent = pts.slice(-5), earlier = pts.slice(0, -5), mean = (a) => sum(a, (p) => p.e) / a.length;
  let strip = "";
  if (pts.length >= 3) {
    strip = S("Recent efficiency", num(mean(recent), 2) + " m/beat");
    if (earlier.length) { const ch = ((mean(recent) - mean(earlier)) / mean(earlier)) * 100;
      strip += S("vs earlier runs", `${ch > 0 ? "+" : ch < 0 ? "−" : ""}${Math.abs(ch).toFixed(1)}%`, ch > 0.5 ? "good" : ch < -0.5 ? "bad" : ""); }
  }
  $("#effStrip").innerHTML = strip;
  const dot = (data, color, r) => ({ data, backgroundColor: color, borderColor: color, pointRadius: r, pointHoverRadius: r + 2 });
  draw("effChart", { type: "scatter", data: { datasets: [{ label: "Earlier runs", ...dot(earlier, C.run + "77", 4) }, { label: "Last 5 runs", ...dot(recent, C.gym, 6) }] },
    options: { interaction: { mode: "nearest", intersect: true }, plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } },
      tooltip: { callbacks: { label: (c) => { const p = c.raw; return `${label(p.d)} · ${num(p.km)} km · ${pace(p.x)} /km · ${Math.round(p.y)} bpm`; } } } },
      scales: { x: { reverse: true, title: { display: true, text: "pace (min/km), faster to the right" }, ticks: { callback: (v) => pace(v) } },
        y: { title: { display: true, text: "average heart rate (bpm)" } } } } }, pts.length >= 3);
}

// ---------- 6. Consistency heatmap ----------
function renderHeat() {
  const N = 26, today = todayUK(), start = addDays(monday(today), -7 * (N - 1));
  const by = new Map(), slot = (d) => by.get(d) || by.set(d, { run: [0, 0], cardio: [0, 0], gym: [0, 0] }).get(d);
  ACTS.forEach((a) => { const s = slot(a.d)[a.g === "Run" ? "run" : "cardio"]; s[0] += a.min || 0; s[1]++; });
  D.gym.forEach((g) => { const s = slot(g.d).gym; s[0] += g.min || 0; s[1]++; });
  const col = { run: C.run, cardio: C.cardio, gym: C.gym }, nm = { run: "Run", cardio: "Other cardio", gym: "Gym" };
  let cells = "", months = "", prevM = -1;
  const active = new Set();
  for (let i = 0; i < N * 7; i++) {
    const d = addDays(start, i);
    if (i % 7 === 0) { const m = new Date(d + "T00:00:00Z").getUTCMonth(); if (m !== prevM) { months += `<span style="grid-column:${i / 7 + 1}">${new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>`; prevM = m; } }
    const v = by.get(d);
    if (d > today) { cells += '<div class="hc fut"></div>'; continue; }
    if (!v) { cells += `<div class="hc" title="${fmtDate(d)}: rest"></div>`; continue; }
    const tot = sum(Object.values(v), (x) => x[0]);
    const top = Object.keys(v).sort((a, b) => v[b][0] - v[a][0] || v[b][1] - v[a][1])[0];
    const lvl = tot < 30 ? 0 : tot < 60 ? 1 : tot < 120 ? 2 : 3;
    active.add(d);
    const tip = Object.keys(v).filter((k) => v[k][1]).map((k) => `${nm[k]} ${Math.round(v[k][0])} min`).join(", ");
    cells += `<div class="hc" style="background:${col[top]};opacity:${[0.35, 0.55, 0.78, 1][lvl]}" title="${fmtDate(d)}: ${tip}"></div>`;
  }
  $("#heat").innerHTML = cells; $("#hm").innerHTML = months;
  const total = days(start, today) + 1;
  let best = 0, run = 0, gap = 0, bgap = 0, seen = false, cur = 0;
  for (let i = 0; i < total; i++) {
    if (active.has(addDays(start, i))) { run++; best = Math.max(best, run); seen = true; gap = 0; }
    else { run = 0; if (seen) { gap++; bgap = Math.max(bgap, gap); } }
  }
  for (let k = active.has(today) ? 0 : 1; active.has(addDays(today, -k)); k++) cur++;
  $("#heatStrip").innerHTML = S("Active days", `${active.size} / ${total}`) + S("Per week", (active.size / (total / 7)).toFixed(1) + " days") +
    S("Current streak", cur + " d") + S("Longest streak", best + " d") + S("Longest break", bgap + " d");
}

// ---------- 7. Run log ----------
function renderTable() {
  const yr = todayUK().slice(0, 4);
  const rows = RUNS.filter((r) => r.km > 0).map((r) => ({ d: r.d, km: r.km, min: r.min || null, pace: r.min > 0 ? r.min / r.km : null, hr: r.hr || null,
    elev: r.elev, climb: r.elev != null ? r.elev / r.km : null, eff: r.hr > 0 && r.min > 0 ? ((r.km * 1000) / r.min) / r.hr : null }));
  const k = SORT.k;
  rows.sort((a, b) => (a[k] == null ? 1 : b[k] == null ? -1 : (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * SORT.dir));
  const cols = [["d", "Date"], ["km", "Distance"], ["min", "Time"], ["pace", "Pace"], ["hr", "Avg HR"], ["elev", "Elev (m)"], ["climb", "m/km"], ["eff", "m/beat"]];
  const f = { d: (r) => label(r.d) + (r.d.slice(0, 4) !== yr ? " " + r.d.slice(2, 4) : ""), km: (r) => num(r.km) + " km", min: (r) => (r.min ? dur(r.min) : "–"),
    pace: (r) => (r.pace ? pace(r.pace) : "–"), hr: (r) => (r.hr ? Math.round(r.hr) : "–"), elev: (r) => num(r.elev, 0), climb: (r) => num(r.climb, 0), eff: (r) => num(r.eff, 2) };
  $("#tbl").innerHTML = rows.length
    ? `<table><thead><tr>${cols.map(([c, l]) => `<th data-k="${c}">${l}${SORT.k === c ? (SORT.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
       <tbody>${rows.slice(0, 30).map((r) => `<tr>${cols.map(([c]) => `<td>${f[c](r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : '<p class="msgbox">No runs yet.</p>';
  document.querySelectorAll("#tbl th").forEach((th) => (th.onclick = () => {
    const nk = th.dataset.k;
    SORT = nk === SORT.k ? { k: nk, dir: -SORT.dir } : { k: nk, dir: nk === "pace" ? 1 : -1 };
    renderTable();
  }));
}

// ---------- Easy vs hard running (share of max HR; edit these three numbers to taste) ----------
const MAX_HR = 202, EASY_BELOW = 0.75, HARD_FROM = 0.85;
const zoneOf = (r) => { const p = r.hr / MAX_HR; return p < EASY_BELOW ? "Easy" : p < HARD_FROM ? "Moderate" : "Hard"; };
function renderIntensity() {
  const weeks = rangeWeeks(), wk = group(RUNS, weeks), ok = (r) => r.hr > 0 && r.min > 0;
  const rows = wk.flat(), v = rows.filter(ok), zs = ["Easy", "Moderate", "Hard"];
  const col = { Easy: C.cardio, Moderate: C.gym, Hard: BAD };
  const hrs = (arr, z) => sum(arr.filter((r) => zoneOf(r) === z), (r) => r.min) / 60, total = sum(v, (r) => r.min) / 60;
  const pc = (z) => (total > 0 ? (hrs(v, z) / total) * 100 : null), fmt = (x) => (x == null ? "–" : Math.round(x) + "%");
  $("#intStrip").innerHTML = S("Easy", fmt(pc("Easy")), pc("Easy") >= 75 ? "good" : "") + S("Moderate", fmt(pc("Moderate"))) +
    S("Hard", fmt(pc("Hard")), pc("Hard") > 25 ? "bad" : "") + S("Runs without HR", rows.length - v.length);
  const datasets = zs.map((z) => ({ type: "bar", label: z, data: wk.map((w) => hrs(w.filter(ok), z)), backgroundColor: col[z], borderRadius: 2, yAxisID: "y" }));
  datasets.push({ type: "line", label: "Easy share", yAxisID: "y1", borderColor: C.ride, backgroundColor: C.ride, tension: 0.25, pointRadius: 3, spanGaps: true,
    data: wk.map((w) => { const x = w.filter(ok), t = sum(x, (r) => r.min); return t > 0 ? (sum(x.filter((r) => zoneOf(r) === "Easy"), (r) => r.min) / t) * 100 : null; }) });
  draw("intChart", { type: "bar", data: { labels: weeks.map(label), datasets }, options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } },
    tooltip: { callbacks: { label: (c) => (c.dataset.type === "line" ? `${c.dataset.label}: ${Math.round(c.parsed.y)}%` : `${c.dataset.label}: ${num(c.parsed.y, 2)} h`) } } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "hours" } },
      y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: "% easy" } } } } }, v.length > 0);
  const items = zs.map((z) => ({ l: z, v: hrs(v, z), c: col[z], f: `${num(hrs(v, z), 1)} h · ${fmt(pc(z))}` }));
  donut("int", items, (t) => `<div><b>${num(t, 0)} h</b><span>with HR</span></div>`);
  $("#intNote").textContent = `Easy under ${Math.round(MAX_HR * EASY_BELOW)} bpm, moderate ${Math.round(MAX_HR * EASY_BELOW)} to ${Math.round(MAX_HR * HARD_FROM) - 1}, hard ${Math.round(MAX_HR * HARD_FROM)}+ (max HR ${MAX_HR}). Many coaches aim for roughly 80% easy.`;
}
function renderRange() { renderRamp(); renderLong(); renderDonuts(); renderEff(); renderIntensity(); }
function renderActive() { if (TAB === "run") renderRange(); else renderStrength(); }
function showTab(t) {
  TAB = t;
  $("#tab-run").hidden = t !== "run"; $("#tab-str").hidden = t !== "str";
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  try { history.replaceState(null, "", t === "str" ? "#strength" : "#running"); } catch {}
  Object.values(charts).forEach((c) => c.resize());
  renderActive();
}

async function init() {
  D = await loadData();
  if (!D) { $("#tabs").hidden = true; return; }
  D.plan = D.plan || []; D.races = D.races || [];
  $("#content").hidden = false;
  C = colours(); BAD = css("--bad");
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  ACTS = D.activities.map((a) => ({ ...a, g: groupOf(a.type) }));
  RUNS = ACTS.filter((a) => a.g === "Run");
  $("#updated").textContent = "Updated " + new Date(D.generated_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });
  const wire = (sel, attr, set) => document.querySelectorAll(sel + " button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(sel + " button").forEach((x) => x.classList.toggle("on", x === b));
    set(b.dataset[attr]);
  }));
  wire("#range", "w", (v) => { RANGE = v; renderActive(); });
  wire("#rampTabs", "k", (v) => { RAMP = v; renderRamp(); });
  renderHero(); renderPlan(); renderHeat(); renderTable(); renderRange();
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.t)));
  if (location.hash === "#strength") showTab("str");
}
init();
