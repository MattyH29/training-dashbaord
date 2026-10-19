// Strength tab. Uses globals from analysis.js and shared.js.
// Movement groups for the lifts you track. Edit this when you add exercises in sync.py.
const MOVE = { "Bench Press": "Push", "Shoulder Press": "Push", "Barbell Row": "Pull", "Lat Pulldown": "Pull",
  Squat: "Lower", Deadlift: "Lower", RDL: "Lower", "Bulgarian Split Squat": "Lower" };
const moveOf = (ex) => MOVE[ex] || "Other";
const moveCol = () => ({ Push: C.gym, Pull: C.ride, Lower: C.cardio, Other: C.other });
let STR_SEL = null;

const liftRows = (ex) => D.lifts.filter((l) => l.ex === ex).sort((a, b) => a.d.localeCompare(b.d));
const liftNames = () => {
  const r = (x) => (MAIN_LIFTS.includes(x) ? MAIN_LIFTS.indexOf(x) : 99);
  return [...new Set(D.lifts.map((l) => l.ex))].sort((a, b) => r(a) - r(b) || a.localeCompare(b));
};
const chg = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const chgS = (l, p) => (p == null ? S(l, "–") : S(l, `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(0)}%`, p > 0 ? "good" : p < 0 ? "bad" : ""));
const sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "");

// A PR is a session whose estimated 1RM beats every earlier session for that lift.
function allPRs() {
  const out = [];
  liftNames().forEach((ex) => {
    let max = null;
    liftRows(ex).forEach((r) => {
      if (r.e1rm == null) return;
      if (max != null && r.e1rm > max) out.push({ ex, d: r.d, e: r.e1rm, gain: r.e1rm - max, kg: r.kg, reps: r.reps });
      if (max == null || r.e1rm > max) max = r.e1rm;
    });
  });
  return out.sort((a, b) => b.d.localeCompare(a.d));
}
// Weekly best estimated 1RM, carried forward through weeks without a session.
function carry(ex, weeks) {
  const rows = liftRows(ex).filter((r) => r.e1rm != null), before = rows.filter((r) => r.d < weeks[0]);
  let cur = before.length ? before[before.length - 1].e1rm : null;
  return group(rows, weeks).map((w) => { if (w.length) cur = Math.max(...w.map((r) => r.e1rm)); return cur; });
}
const spark = (v, color) => {
  if (v.length < 2) return '<div class="spark"></div>';
  const lo = Math.min(...v), r = Math.max(...v) - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${26 - ((x - lo) / r) * 24}`).join(" ");
  return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
};
const markBoard = () => document.querySelectorAll(".lc").forEach((x) => x.classList.toggle("on", x.dataset.ex === STR_SEL));

function renderDetail() {
  const start = rangeWeeks()[0], ex = $("#strSel").value, pts = liftRows(ex).filter((r) => r.d >= start);
  const prs = allPRs().filter((p) => p.ex === ex), today = todayUK();
  const top = (f) => { const v = pts.filter((p) => p[f] != null); return v.length ? v.reduce((b, p) => (p[f] > b[f] ? p : b)) : null; };
  const be = top("e1rm"), bk = top("kg");
  $("#detStrip").innerHTML = S("Best est. 1RM", be ? num(be.e1rm) + " kg" : "–") +
    S("Heaviest top set", bk ? `${num(bk.kg)} kg${bk.reps ? " × " + bk.reps : ""}` : "–") + S("Sessions", pts.length) +
    S("PRs in range", prs.filter((p) => p.d >= start).length) + S("Since last PR", prs.length ? days(prs[0].d, today) + " d" : "–");
  const yr = today.slice(0, 4);
  draw("detChart", mixCfg(pts.map((p) => label(p.d) + (p.d.slice(0, 4) !== yr ? " " + p.d.slice(2, 4) : "")), [
    { type: "line", label: "Top set (kg)", data: pts.map((p) => p.kg), color: C.gym, axis: "y", fmt: (v) => num(v) + " kg" },
    { type: "line", label: "Est. 1RM (kg)", data: pts.map((p) => p.e1rm), color: C.gym, dash: [6, 4], pr: 2, axis: "y", fmt: (v) => num(v) + " kg" },
    { type: "bar", label: "Session volume", data: pts.map((p) => p.vol), color: C.gym, outline: true, axis: "y1", fmt: (v) => num(v, 0) + " kg" }],
    [{ id: "y", t: "kg" }, { id: "y1", t: "volume (kg)", zero: true }]), pts.length > 0);
}

function renderStrength() {
  const weeks = rangeWeeks(), n = weeks.length, start = weeks[0], today = todayUK();
  const prevW = RANGE === "all" ? null : weeks.map((w) => addDays(w, -7 * n));
  const gw = group(D.gym, weeks), sess = gw.flat(), timed = sess.filter((r) => r.min >= 10);
  const vol = sum(sess, (r) => r.vol), pg = prevW ? group(D.gym, prevW).flat() : null;

  // KPIs
  $("#strKpi").innerHTML = S("Sessions", sess.length) + S("Sessions per week", num(sess.length / n)) + S("Total volume", num(vol, 0) + " kg") +
    S("Total sets", num(sum(sess, (r) => r.sets), 0)) + S("Avg session", timed.length ? dur(sum(timed, (r) => r.min) / timed.length) : "–") +
    chgS(`Volume vs previous ${n} wks`, pg ? chg(vol, sum(pg, (r) => r.vol)) : null);

  // Weekly volume (bars) and sets (line)
  draw("volChart", mixCfg(weeks.map(label), [
    { type: "bar", label: "Volume", data: gw.map((w) => sum(w, (r) => r.vol)), color: C.gym, axis: "y", fmt: (v) => num(v, 0) + " kg" },
    { type: "line", label: "Sets", data: gw.map((w) => sum(w, (r) => r.sets)), color: C.ride, axis: "y1", fmt: (v) => num(v, 0) }],
    [{ id: "y", t: "kg", zero: true }, { id: "y1", t: "sets", zero: true }]), sess.length > 0);

  // Push / pull / lower split
  const lr = D.lifts.filter((l) => l.d >= start), mc = moveCol();
  const mv = Object.keys(mc).map((k) => ({ l: k, v: sum(lr.filter((l) => moveOf(l.ex) === k), (l) => l.vol), c: mc[k] }));
  mv.forEach((i) => (i.f = num(i.v, 0) + " kg"));
  donut("move", mv, () => `<div><b>${mv[1].v > 0 ? (mv[0].v / mv[1].v).toFixed(2) : "–"}</b><span>push : pull</span></div>`);

  // Lift selector, scoreboard, detail
  const names = liftNames(), prs = allPRs();
  $("#strSel").innerHTML = names.map((x) => `<option>${esc(x)}</option>`).join("");
  if (!names.includes(STR_SEL)) STR_SEL = names[0] || null;
  if (STR_SEL) $("#strSel").value = STR_SEL;
  $("#strSel").onchange = () => { STR_SEL = $("#strSel").value; markBoard(); renderDetail(); };
  $("#board").innerHTML = names.map((ex) => {
    const rows = liftRows(ex).filter((r) => r.e1rm != null), inR = rows.filter((r) => r.d >= start);
    if (!rows.length) return "";
    const last = rows[rows.length - 1], best = Math.max(...rows.map((r) => r.e1rm));
    const ch = inR.length >= 2 ? inR[inR.length - 1].e1rm - inR[0].e1rm : null;
    const pr = prs.find((p) => p.ex === ex), col = mc[moveOf(ex)];
    return `<div class="lc ${ex === STR_SEL ? "on" : ""}" data-ex="${esc(ex)}"><div class="lh"><b>${esc(ex)}</b><span style="color:${col}">${moveOf(ex)}</span></div>
      <div class="lv">${num(last.e1rm)}<small> kg e1RM</small></div>${spark(inR.slice(-20).map((r) => r.e1rm), col)}
      <div class="d">Best ${num(best)} kg · ${pr ? "PR " + days(pr.d, today) + " d ago" : "no PR yet"}</div>
      <div class="d ${ch > 0 ? "good" : ch < 0 ? "bad" : ""}">${ch == null ? "Not enough sessions in range" : `${sign(ch)}${num(Math.abs(ch))} kg in range`}</div></div>`;
  }).join("");
  document.querySelectorAll(".lc").forEach((el) => (el.onclick = () => { STR_SEL = el.dataset.ex; $("#strSel").value = STR_SEL; markBoard(); renderDetail(); }));
  renderDetail();

  // PR feed
  $("#prFeed").innerHTML = prs.length ? prs.slice(0, 8).map((p) =>
    `<div class="li"><span><span class="dot" style="background:${mc[moveOf(p.ex)]}"></span>${esc(p.ex)}<small>${fmtDate(p.d)}</small></span>
     <span class="r"><b>${num(p.e)} kg</b><small>+${num(p.gain)} kg${p.reps ? ` · ${num(p.kg)} × ${p.reps}` : ""}</small></span></div>`).join("")
    : '<p class="msgbox">No PRs yet.</p>';

  // Estimated Big 3 total (stacked)
  const trio = ["Bench Press", "Squat", "Deadlift"].filter((x) => D.lifts.some((l) => l.ex === x));
  const series = trio.map((x) => carry(x, weeks));
  const tot = weeks.map((_, i) => (series.every((s) => s[i] != null) ? sum(series, (s) => s[i]) : null));
  const known = tot.filter((x) => x != null), d3 = known.length > 1 ? known[known.length - 1] - known[0] : null;
  const cols3 = { "Bench Press": C.gym, Squat: C.cardio, Deadlift: C.run };
  $("#b3Strip").innerHTML = trio.length >= 2 && known.length
    ? S("Current total", num(known[known.length - 1], 0) + " kg") +
      (d3 == null ? "" : S("Change in range", `${sign(d3)}${num(Math.abs(d3), 0)} kg`, d3 > 0 ? "good" : d3 < 0 ? "bad" : "")) +
      trio.map((x, i) => S(x, num(series[i][series[i].length - 1], 0) + " kg")).join("") : "";
  draw("b3Chart", { type: "bar", data: { labels: weeks.map(label), datasets: trio.map((x, i) => ({ label: x, data: series[i].map((v, k) => (tot[k] == null ? null : v)), backgroundColor: cols3[x], borderRadius: 2 })) },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.parsed.y, 0)} kg` } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "est. 1RM total (kg)" } } } } }, trio.length >= 2 && known.length > 0);

  // Rep ranges of top sets
  const ri = [["1 to 5 reps", 1, 5, C.gym], ["6 to 10 reps", 6, 10, C.ride], ["11+ reps", 11, 1e9, C.cardio]]
    .map(([l, lo, hi, c]) => ({ l, c, v: lr.filter((x) => x.reps >= lo && x.reps <= hi).length }));
  ri.forEach((i) => (i.f = i.v + " top sets"));
  donut("reps", ri, (t) => `<div><b>${t}</b><span>top sets</span></div>`);

  // Session length and density (kg per minute)
  const dw = group(timed, weeks);
  draw("denChart", mixCfg(weeks.map(label), [
    { type: "bar", label: "Avg session length", data: dw.map((w) => (w.length ? sum(w, (r) => r.min) / w.length : null)), color: C.gym, outline: true, axis: "y", fmt: (v) => dur(v) },
    { type: "line", label: "Density", data: dw.map((w) => { const m = sum(w, (r) => r.min); return m > 0 ? sum(w, (r) => r.vol) / m : null; }), color: C.ride, axis: "y1", fmt: (v) => num(v) + " kg/min" }],
    [{ id: "y", t: "minutes", zero: true }, { id: "y1", t: "kg per minute", zero: true }]), timed.length > 0);

  // Days since each lift was last logged
  const fr = names.map((ex) => { const r = liftRows(ex); return r.length ? { ex, dd: days(r[r.length - 1].d, today) } : null; }).filter(Boolean).sort((a, b) => b.dd - a.dd);
  $("#fresh").innerHTML = fr.map((f) => `<div class="fr"><span>${esc(f.ex)}</span><div class="meter"><i style="width:${(Math.min(f.dd, 30) / 30) * 100}%;background:${f.dd <= 7 ? "var(--good)" : f.dd <= 14 ? "var(--gym)" : "var(--bad)"}"></i></div><b>${f.dd} d</b></div>`).join("")
    || '<p class="msgbox">No lifts yet.</p>';

  // Gym log
  const log = [...D.gym].sort((a, b) => b.d.localeCompare(a.d)).slice(0, 15);
  $("#gymLog").innerHTML = log.length
    ? `<table><thead><tr><th>Date</th><th>Time</th><th>Sets</th><th>Volume</th><th>kg/min</th></tr></thead><tbody>${log.map((g) =>
        `<tr><td>${fmtDate(g.d)}</td><td>${g.min >= 1 ? dur(g.min) : "–"}</td><td>${num(g.sets, 0)}</td><td>${num(g.vol, 0)} kg</td><td>${g.min >= 10 && g.vol ? num(g.vol / g.min) : "–"}</td></tr>`).join("")}</tbody></table>`
    : '<p class="msgbox">No gym sessions yet.</p>';
}
