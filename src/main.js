import "./style.css";
import { ymd, parseYmd, sessionsOn, getSession, saveSession, deleteSession, markAttendance, unmarkAttendance, recentOccurrences, getTimeline, stats, loadAll, clearAll, getProfile } from "./store.js";
import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const START_H = 0, END_H = 24, HOUR_PX = 64, OPEN = 11, CLOSE = 19;

// ---------- small helpers ----------
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
const fmtDay = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const hourLabel = (h) => (h % 12 || 12) + (h < 12 ? "am" : "pm");
const hourStr = (h) => `${String(h).padStart(2, "0")}:00`;
const toH = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
const fmtT = (t) => { const [h, m] = t.split(":").map(Number); return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
// Anything a user typed must be escaped before going into innerHTML.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- calendar ----------
let weekStart = mondayOf(new Date());

function renderWeek() {
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  const todayKey = ymd(new Date());
  const colH = (END_H - START_H) * HOUR_PX;
  const now = new Date(), nowH = now.getHours() + now.getMinutes() / 60;

  const heads = '<div class="corner"></div>' +
    days.map((d) => `<div class="${ymd(d) === todayKey ? "today" : ""}">${fmtDay(d)}</div>`).join("");
  const times = [...Array(END_H - START_H)].map((_, i) => `<div>${i ? hourLabel(START_H + i) : ""}</div>`).join("");

  const cols = days.map((d) => {
    const events = sessionsOn(d).map((s) => {
      const top = (toH(s.start) - START_H) * HOUR_PX, h = (toH(s.end) - toH(s.start)) * HOUR_PX;
      return `<button class="ev" data-id="${s.id}" style="top:${top}px;height:${h}px">${fmtT(s.start)} - ${fmtT(s.end)}<br>${s.marked ? "&#10003; " : ""}${esc(s.title)}<small>${esc(s.student)}</small></button>`;
    }).join("");
    const nowLine = ymd(d) === todayKey && nowH >= START_H && nowH <= END_H
      ? `<div class="now" style="top:${(nowH - START_H) * HOUR_PX}px"></div>` : "";
    return `<div class="col" data-date="${ymd(d)}" style="height:${colH}px">
      <div class="off" style="top:0;height:${(OPEN - START_H) * HOUR_PX}px"></div>
      <div class="off" style="top:${(CLOSE - START_H) * HOUR_PX}px;bottom:0"></div>${events}${nowLine}</div>`;
  }).join("");

  $("grid").innerHTML = `<div class="heads">${heads}</div><div class="body"><div class="times">${times}</div>${cols}</div>`;
  const o = { day: "numeric", month: "short" }, last = days[6];
  $("range").textContent = `${days[0].toLocaleDateString("en-GB", o)} – ${last.toLocaleDateString("en-GB", o)}, ${last.getFullYear()}`;
}

$("prev").onclick = () => { weekStart = addDays(weekStart, -7); renderWeek(); };
$("next").onclick = () => { weekStart = addDays(weekStart, 7); renderWeek(); };
$("today").onclick = () => { weekStart = mondayOf(new Date()); renderWeek(); };

// Click a session to edit it; click an empty slot to add one at that time.
$("grid").addEventListener("click", (e) => {
  const ev = e.target.closest(".ev");
  if (ev) return openDialog({ id: ev.dataset.id });
  const col = e.target.closest(".col");
  if (!col) return;
  const y = e.clientY - col.getBoundingClientRect().top;
  openDialog({ date: col.dataset.date, start: hourStr(Math.min(END_H - 1, Math.floor(START_H + y / HOUR_PX))) });
});

// ---------- add / edit dialog ----------
const dlg = $("sessionDialog"), form = $("sessionForm");

function openDialog({ id, date, start } = {}) {
  const s = id ? getSession(id) : null;
  const startH = start ?? "18:00";
  $("dlgTitle").textContent = s ? "Edit session" : "Add session";
  $("dlgDelete").hidden = !s;
  $("dlgHint").hidden = !(s && s.repeat === "weekly");
  $("dlgError").textContent = "";
  form.reset();
  const v = {
    id: s?.id ?? "", title: s?.title ?? "", student: s?.student ?? "",
    date: s?.date ?? date ?? ymd(new Date()), start: s?.start ?? startH,
    end: s?.end ?? (parseInt(startH, 10) >= 23 ? "23:59" : hourStr(parseInt(startH, 10) + 1)), repeat: s?.repeat ?? "none",
  };
  for (const [k, val] of Object.entries(v)) form.elements[k].value = val;
  dlg.showModal();
  form.elements.title.focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  f.title = f.title.trim(); f.student = f.student.trim();
  if (f.end <= f.start) { $("dlgError").textContent = "End time must be after the start time."; return; }
  if (!f.id) delete f.id;
  try { await saveSession(f); } catch (err) { $("dlgError").textContent = err.message; return; }
  dlg.close();
  renderAll();
});
$("dlgCancel").onclick = () => dlg.close();
$("dlgDelete").onclick = async () => {
  if (!confirm("Delete this session and all of its repeats?")) return;
  try { await deleteSession(form.elements.id.value); } catch (err) { $("dlgError").textContent = err.message; return; }
  dlg.close();
  renderAll();
};
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click on backdrop
$("addBtn").onclick = () => openDialog();

// ---------- dashboard ----------
function renderDash() {
  const rows = recentOccurrences(5);
  $("att").innerHTML = rows.length ? rows.map((s) => `
    <div class="row">
      <div>${esc(s.title)}<br><span>${esc(s.student)} · ${fmtDay(parseYmd(s.occurrence))} · ${fmtT(s.start)} - ${fmtT(s.end)}</span></div>
      ${s.marked
        ? `<span class="act"><span class="mark done">Marked</span><button class="undo" data-act="unmark" data-id="${s.id}" data-occ="${s.occurrence}">Unmark</button></span>`
        : `<button class="mark" data-act="mark" data-id="${s.id}" data-occ="${s.occurrence}">Mark attendance</button>`}
    </div>`).join("") : '<p class="empty">No past sessions yet. Add one from the calendar.</p>';

  const tl = getTimeline();
  $("tl").innerHTML = tl.length ? tl.map((t) => `
    <div class="tl"><i></i><p>Attendance for <b>${esc(t.title)}</b> on ${fmtDay(parseYmd(t.occurrence))} was marked.<em>${new Date(t.at).toLocaleString("en-GB")}</em></p></div>`).join("")
    : '<p class="empty" style="padding:0">Activity will appear here.</p>';

  const st = stats();
  $("sClasses").textContent = st.classes;
  $("sStudents").textContent = st.students;
}

$("att").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const change = b.dataset.act === "unmark" ? unmarkAttendance : markAttendance;
  b.disabled = true; // stops double-clicks
  try { await change(b.dataset.id, b.dataset.occ); } catch (err) { b.disabled = false; return alert(err.message); }
  renderAll();
});

// ---------- navigation ----------
function show(which) {
  $("calView").classList.toggle("on", which === "cal");
  $("homeView").classList.toggle("on", which === "home");
  $("goCal").classList.toggle("on", which === "cal");
  $("goHome").classList.toggle("on", which === "home");
  history.replaceState(null, "", which === "home" ? "#home" : "#calendar");
}
$("goCal").onclick = () => show("cal");
$("goHome").onclick = () => show("home");

function renderAll() { renderWeek(); renderDash(); }

// ---------- log in / sign up ----------
let mode = "login";
function setMode(m) {
  mode = m;
  const signup = m === "signup";
  $("authTitle").textContent = signup ? "Create your account" : "Log in";
  $("authSubmit").textContent = signup ? "Create account" : "Log in";
  $("authNameWrap").hidden = !signup;
  $("authToggleText").textContent = signup ? "Already have an account?" : "New here?";
  $("authToggle").textContent = signup ? "Log in" : "Create an account";
  $("authPassword").autocomplete = signup ? "new-password" : "current-password";
}
$("authToggle").onclick = () => { $("authMsg").textContent = ""; setMode(mode === "login" ? "signup" : "login"); };

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("authMsg");
  msg.textContent = ""; msg.className = "err";
  $("authSubmit").disabled = true;
  try {
    const email = $("authEmail").value.trim(), password = $("authPassword").value;
    if (mode === "login") await auth.signIn(email, password);
    else if (!(await auth.signUp(email, password, $("authName").value.trim()))) {
      setMode("login");
      msg.className = "hint";
      msg.textContent = "Check your email to confirm your account, then log in.";
    }
  } catch (err) { msg.textContent = err.message; }
  finally { $("authSubmit").disabled = false; }
});
$("logoutBtn").onclick = () => auth.signOut();

// Runs whenever someone logs in or out
let currentId = null;
async function handleUser(user) {
  const id = user?.id ?? null;
  if (id === currentId) return; // ignore repeat events such as token refreshes
  currentId = id;
  document.body.classList.toggle("authed", !!user);
  if (!user) { clearAll(); $("authPassword").value = ""; return; }
  try {
    const [profile] = await Promise.all([getProfile(user.id), loadAll()]);
    const name = profile?.full_name || user.email.split("@")[0];
    $("whoName").textContent = name; $("barName").textContent = name; $("helloName").textContent = name;
    $("whoEmail").textContent = user.email;
    renderAll();
    show(location.hash === "#home" ? "home" : "cal");
    document.querySelector(".week").scrollTop = (OPEN - START_H - 0.5) * HOUR_PX;
  } catch (err) {
    alert(`Could not load your data: ${err.message}`);
  }
}

if (!auth.configured) {
  $("authForm").hidden = true;
  $("authSetup").hidden = false;
} else {
  setMode("login");
  auth.onAuthChange(handleUser);
  auth.currentUser().then(handleUser);
}
setInterval(renderWeek, 60_000); // keeps the red "now" line moving
