// Helpers shared by index.html (charts), kpi.html and side.html.
// Theme: dark by default. Add ?theme=light to the page URL for a light Notion page.
document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";

const $ = (s) => document.querySelector(s);
const sum = (a, f) => a.reduce((t, r) => t + (f(r) || 0), 0);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const colours = () => ({ run: css("--run"), cardio: css("--cardio"), gym: css("--gym"), ride: css("--ride"), other: css("--other") });
const MAIN_LIFTS = ["Bench Press", "Squat", "Deadlift", "Shoulder Press"];

// Dates are YYYY-MM-DD strings; "today" is the UK date.
const todayUK = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (s) => addDays(s, -((new Date(s + "T00:00:00Z").getUTCDay() + 6) % 7));
const label = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const num = (v, d = 1) => (v == null ? "–" : v.toLocaleString("en-GB", { maximumFractionDigits: d }));
const pace = (v) => {
  if (v == null) return "–";
  let m = Math.floor(v), s = Math.round((v - m) * 60);
  if (s === 60) { m++; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
};
const groupOf = (t) => (/run/i.test(t) ? "Run" : /ride|bike/i.test(t) ? "Cycling" : /swim/i.test(t) ? "Swim" : "Other cardio");

// Totals for one calendar week (Monday start). Pace = total time / total distance.
function weekStats(D, w) {
  const inW = (r) => monday(r.d) === w;
  const acts = D.activities.filter(inW).map((a) => ({ ...a, g: groupOf(a.type) }));
  const runs = acts.filter((a) => a.g === "Run");
  const valid = runs.filter((r) => r.km > 0 && r.min > 0), vk = sum(valid, (r) => r.km);
  return {
    km: sum(runs, (r) => r.km),
    cardio: sum(acts.filter((a) => a.g !== "Run"), (r) => r.min) / 60,
    gym: D.gym.filter(inW).length,
    pace: vk > 0 ? sum(valid, (r) => r.min) / vk : null,
  };
}

async function loadData() {
  const msg = (h) => { const m = $("#msg"); m.innerHTML = h; m.hidden = false; };
  let D;
  try {
    const r = await fetch("data.json?v=" + Date.now());
    if (!r.ok) throw new Error(r.status);
    D = await r.json();
  } catch {
    msg("<b>No data yet.</b> data.json could not be loaded. Run the “Build and deploy dashboard” workflow and check the Notion secrets.");
    return null;
  }
  if (![D.activities, D.gym, D.lifts].some((a) => a && a.length)) {
    msg("<b>No data found.</b> The export worked but the databases returned no rows. Check the integration has access to all three.");
    return null;
  }
  return D;
}
