import "./style.css";
import { ymd, parseYmd, sessionsOn, getSession, saveSession, deleteSession, markAttendance, unmarkAttendance, recentOccurrences, getTimeline, stats, monthStats, listStudents, getStudent, saveStudent, deleteStudent, loadAll, clearAll, getProfile } from "./store.js";
import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const START_H = 0, END_H = 24, OPEN = 11, CLOSE = 19;
const phone = window.matchMedia("(max-width: 760px)"); // phones get a compact calendar
let HOUR_PX = phone.matches ? 44 : 64;

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
let view = "week";                       // "day" | "week" | "month"
let anchor = new Date(); anchor.setHours(0, 0, 0, 0); // the date the calendar is centred on

// Sessions that overlap in time sit side by side instead of on top of each other.
function layout(evs) {
  const sorted = [...evs].sort((a, b) => toH(a.start) - toH(b.start) || toH(b.end) - toH(a.end));
  const out = []; let cluster = [], clusterEnd = -1;
  const flush = () => { const n = Math.max(...cluster.map((e) => e.lane)) + 1; cluster.forEach((e) => (e.lanes = n)); out.push(...cluster); cluster = []; };
  for (const e of sorted) {
    if (cluster.length && toH(e.start) >= clusterEnd) { flush(); clusterEnd = -1; }
    const used = new Set(cluster.filter((c) => toH(c.end) > toH(e.start)).map((c) => c.lane));
    let lane = 0; while (used.has(lane)) lane++;
    e.lane = lane; cluster.push(e); clusterEnd = Math.max(clusterEnd, toH(e.end));
  }
  if (cluster.length) flush();
  return out;
}

function renderWeek() {
  HOUR_PX = phone.matches ? 44 : 64;
  const grid = $("grid");
  grid.style.setProperty("--hour", HOUR_PX + "px");
  const todayKey = ymd(new Date());
  if (view === "month") return renderMonth(todayKey);

  const days = view === "day" ? [anchor] : [...Array(7)].map((_, i) => addDays(mondayOf(anchor), i));
  grid.style.setProperty("--cols", days.length);
  const colH = (END_H - START_H) * HOUR_PX;
  const now = new Date(), nowH = now.getHours() + now.getMinutes() / 60;

  const heads = '<div class="corner"></div>' + days.map((d) =>
    `<div class="${ymd(d) === todayKey ? "today" : ""}">${d.toLocaleDateString("en-GB", { weekday: "short" })} <span class="dm">${d.getDate()}</span> <span class="mo">${d.toLocaleDateString("en-GB", { month: "short" })}</span></div>`).join("");
  const times = [...Array(END_H - START_H)].map((_, i) => `<div>${i ? hourLabel(START_H + i) : ""}</div>`).join("");

  const cols = days.map((d) => {
    const events = layout(sessionsOn(d)).map((s) => {
      const top = (toH(s.start) - START_H) * HOUR_PX, h = (toH(s.end) - toH(s.start)) * HOUR_PX;
      const pos = `left:calc(${(s.lane * 100) / s.lanes}% + 2px);width:calc(${100 / s.lanes}% - 4px)`;
      return `<button class="ev" data-id="${s.id}" style="top:${top}px;height:${h}px;${pos}"><span class="tm">${fmtT(s.start)} - ${fmtT(s.end)}<br></span>${s.marked ? "&#10003; " : ""}${esc(s.title)}<small>${esc(s.student)}</small></button>`;
    }).join("");
    const nowLine = ymd(d) === todayKey && nowH >= START_H && nowH <= END_H
      ? `<div class="now" style="top:${(nowH - START_H) * HOUR_PX}px"></div>` : "";
    return `<div class="col" data-date="${ymd(d)}" style="height:${colH}px">
      <div class="off" style="top:0;height:${(OPEN - START_H) * HOUR_PX}px"></div>
      <div class="off" style="top:${(CLOSE - START_H) * HOUR_PX}px;bottom:0"></div>${events}${nowLine}</div>`;
  }).join("");

  grid.innerHTML = `<div class="heads">${heads}</div><div class="body"><div class="times">${times}</div>${cols}</div>`;
  const o = { day: "numeric", month: "short" }, first = days[0], last = days[days.length - 1];
  $("range").textContent = view === "day"
    ? first.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : `${first.toLocaleDateString("en-GB", o)} – ${last.toLocaleDateString("en-GB", o)}, ${last.getFullYear()}`;
}

function renderMonth(todayKey) {
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7;
  const weeks = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7);
  const max = phone.matches ? 2 : 3;
  const head = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="mh">${d}</div>`).join("");
  const cells = [...Array(weeks * 7)].map((_, i) => {
    const d = addDays(first, i - lead), evs = sessionsOn(d);
    const chips = evs.slice(0, max).map((s) => `<button class="chip" data-id="${s.id}">${s.marked ? "&#10003; " : ""}${esc(s.title)}</button>`).join("");
    return `<div class="mcell${d.getMonth() !== m ? " out" : ""}${ymd(d) === todayKey ? " today" : ""}" data-date="${ymd(d)}"><span class="dn">${d.getDate()}</span>${chips}${evs.length > max ? `<div class="more">+${evs.length - max} more</div>` : ""}</div>`;
  }).join("");
  $("grid").innerHTML = `<div class="month">${head}${cells}</div>`;
  $("range").textContent = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function setView(v) { view = v; $("viewSel").value = v; renderWeek(); }
phone.addEventListener("change", renderWeek);
const step = (dir) => {
  anchor = view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1) : addDays(anchor, dir * (view === "day" ? 1 : 7));
  renderWeek();
};
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("today").onclick = () => { anchor = new Date(); anchor.setHours(0, 0, 0, 0); renderWeek(); };
$("viewSel").onchange = (e) => setView(e.target.value);

// Click a session to edit it; click an empty slot to add one at that time.
$("grid").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) return openDialog({ id: chip.dataset.id });
  const cell = e.target.closest(".mcell");
  if (cell) { anchor = parseYmd(cell.dataset.date); return setView("day"); } // click a date to zoom into that day
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
  $("studentList").innerHTML = listStudents().map((x) => `<option value="${esc(x.name)}">`).join("");
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
  try {
    // Match the typed name to an existing student, or create the student on the fly.
    const st = listStudents().find((x) => x.name.toLowerCase() === f.student.toLowerCase()) || await saveStudent({ name: f.student, status: "active" });
    f.student = st.name; f.studentId = st.id;
    await saveSession(f);
  } catch (err) { $("dlgError").textContent = err.message; return; }
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
function renderInsights() {
  const now = new Date();
  const ms = [...Array(8)].map((_, i) => {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { label: m.toLocaleDateString("en-GB", { month: "short", year: "numeric" }), ...monthStats(m.getFullYear(), m.getMonth()) };
  });
  $("prod").innerHTML = `<div class="trow th"><span>Month</span><span>Classes</span><span>Students</span></div>` +
    ms.map((x) => `<div class="trow"><span>${x.label}</span><span>${x.classes}</span><span>${x.students}</span></div>`).join("");
  const titles = [...new Set([...Object.keys(ms[0].byTitle), ...Object.keys(ms[1].byTitle)])]
    .sort((a, b) => (ms[0].byTitle[b] || 0) - (ms[0].byTitle[a] || 0) || (ms[1].byTitle[b] || 0) - (ms[1].byTitle[a] || 0)).slice(0, 5);
  $("popular").innerHTML = titles.length
    ? `<div class="trow th"><span>Subject</span><span>This month</span><span>Last month</span></div>` +
      titles.map((t) => `<div class="trow"><span>${esc(t)}</span><span>${ms[0].byTitle[t] || 0}</span><span>${ms[1].byTitle[t] || 0}</span></div>`).join("")
    : '<p class="empty">No classes yet.</p>';
}

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
  renderInsights();
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
const SECTIONS = ["home", "cal", "people", "resources", "gradebook", "chat", "reports", "profile"];
const REAL = { cal: "calView", home: "homeView", people: "peopleView" };
const SOON = {
  resources: ["Resources", "Upload and share files and courses with your students."],
  gradebook: ["Gradebook", "Grade your students and track their progress over time."],
  chat: ["Chat", "Message students and parents."],
  reports: ["Reports", "Staff and student dashboards."],
  profile: ["Profile", "Your details, working hours, leaves and timesheet."],
};
function show(which) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
  $(REAL[which] || "soonView").classList.add("on");
  if (!REAL[which]) { $("soonTitle").textContent = SOON[which][0]; $("soonText").textContent = SOON[which][1] + " Coming in a later phase."; }
  document.querySelectorAll(".side [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === which));
  history.replaceState(null, "", "#" + which);
  if (which === "people") renderPeople();
}
document.querySelectorAll(".side [data-go]").forEach((b) => (b.onclick = () => show(b.dataset.go)));

// ---------- people: students ----------
let peopleTab = "students";
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
function renderPeople() {
  document.querySelectorAll("#peopleView [data-sub]").forEach((b) => b.classList.toggle("on", b.dataset.sub === peopleTab));
  const isStudents = peopleTab === "students";
  $("studentsPane").hidden = !isStudents;
  $("peopleSoon").hidden = isStudents;
  if (!isStudents) { $("peopleSoonTitle").textContent = peopleTab === "batches" ? "Batches" : "Guardians"; return; }
  const all = listStudents(), q = $("stSearch").value.trim().toLowerCase(), f = $("stFilter").value;
  const rows = all.filter((s) => (f === "all" || s.status === f) && `${s.name} ${s.email || ""} ${s.phone || ""}`.toLowerCase().includes(q));
  $("stActive").textContent = all.filter((s) => s.status === "active").length;
  $("stNew").textContent = all.filter((s) => Date.now() - new Date(s.created_at) < 30 * 864e5).length;
  $("stTotal").textContent = all.length;
  $("studentTable").innerHTML = rows.length
    ? `<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Email</th><th>Phone</th><th>Created</th></tr></thead><tbody>${rows.map((s) =>
        `<tr data-id="${s.id}" tabindex="0"><td><span class="av">${esc(initials(s.name))}</span>${esc(s.name)}</td><td><span class="pill ${s.status}">${s.status === "active" ? "Active" : "Inactive"}</span></td><td>${esc(s.email || "")}</td><td>${esc(s.phone || "")}</td><td>${new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td></tr>`).join("")}</tbody></table>`
    : `<p class="empty">${all.length ? "No students match your search." : "No students yet. Click Add student to create the first one."}</p>`;
}
document.querySelectorAll("#peopleView [data-sub]").forEach((b) => (b.onclick = () => { peopleTab = b.dataset.sub; renderPeople(); }));
$("stSearch").oninput = renderPeople;
$("stFilter").onchange = renderPeople;

const stDlg = $("studentDialog"), stForm = $("studentForm");
function openStudent(id) {
  const s = id ? getStudent(id) : null;
  $("stDlgTitle").textContent = s ? "Edit student" : "Add student";
  $("stDelete").hidden = !s;
  $("stDlgError").textContent = "";
  stForm.reset();
  const v = { id: s?.id ?? "", name: s?.name ?? "", email: s?.email ?? "", phone: s?.phone ?? "", status: s?.status ?? "active" };
  for (const [k, val] of Object.entries(v)) stForm.elements[k].value = val;
  stDlg.showModal();
  stForm.elements.name.focus();
}
$("addStudentBtn").onclick = () => openStudent();
const rowOpen = (e) => { const r = e.target.closest("tr[data-id]"); if (r) openStudent(r.dataset.id); };
$("studentTable").addEventListener("click", rowOpen);
$("studentTable").addEventListener("keydown", (e) => { if (e.key === "Enter") rowOpen(e); });
stForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(stForm));
  f.name = f.name.trim();
  if (!f.id) delete f.id;
  try { await saveStudent(f); } catch (err) { $("stDlgError").textContent = err.message; return; }
  stDlg.close(); renderPeople(); renderAll();
});
$("stCancel").onclick = () => stDlg.close();
$("stDelete").onclick = async () => {
  if (!confirm("Delete this student? Their past sessions stay on your calendar.")) return;
  try { await deleteStudent(stForm.elements.id.value); } catch (err) { $("stDlgError").textContent = err.message; return; }
  stDlg.close(); renderPeople(); renderAll();
};
stDlg.addEventListener("click", (e) => { if (e.target === stDlg) stDlg.close(); });

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
    show(SECTIONS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "cal");
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

// Register the (cache-free) service worker so the app can be installed. Live site only.
if ("serviceWorker" in navigator && import.meta.env.PROD && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
