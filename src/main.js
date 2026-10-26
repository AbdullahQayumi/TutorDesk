import "./style.css";
import { ymd, parseYmd, sessionsOn, getSession, saveSession, deleteSession, markAttendance, unmarkAttendance, recentOccurrences, getTimeline, stats, monthStats, listStudents, getStudent, saveStudent, deleteStudent, getOrg, getOrgs, getMe, isAdmin, canEditSession, getMembers, getInvites, staffName, inviteMember, revokeInvite, setRole, removeMember, convertToBusiness, takesClasses, getHours, saveSettings, getLeaves, onLeave, addLeave, deleteLeave, timesheet, saveProfile, loadAll, clearAll, getProfile } from "./store.js";
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

let staffFilter = "all"; // business accounts can look at one staff member's calendar
const daySessions = (d) => sessionsOn(d).filter((s) => staffFilter === "all" || s.staffId === staffFilter);

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

// Shading: outside the viewed person's working hours, and the whole day when they are on leave.
function offBlocks(d) {
  const who = staffFilter === "all" ? getMe().id : staffFilter, h = getHours(who)[d.getDay()];
  if (onLeave(who, ymd(d))) return '<div class="off" style="top:0;bottom:0"></div><span class="leave">On leave</span>';
  if (!h) return '<div class="off" style="top:0;bottom:0"></div>';
  return `<div class="off" style="top:0;height:${(toH(h[0]) - START_H) * HOUR_PX}px"></div><div class="off" style="top:${(toH(h[1]) - START_H) * HOUR_PX}px;bottom:0"></div>`;
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
    const events = layout(daySessions(d)).map((s) => {
      const top = (toH(s.start) - START_H) * HOUR_PX, h = (toH(s.end) - toH(s.start)) * HOUR_PX;
      const pos = `left:calc(${(s.lane * 100) / s.lanes}% + 2px);width:calc(${100 / s.lanes}% - 4px)`;
      return `<button class="ev" data-id="${s.id}" style="top:${top}px;height:${h}px;${pos}"><span class="tm">${fmtT(s.start)} - ${fmtT(s.end)}<br></span>${s.marked ? "&#10003; " : ""}${esc(s.title)}<small>${esc(s.student)}${getOrg().type === "business" ? " · " + esc(staffName(s.staffId)) : ""}</small></button>`;
    }).join("");
    const nowLine = ymd(d) === todayKey && nowH >= START_H && nowH <= END_H
      ? `<div class="now" style="top:${(nowH - START_H) * HOUR_PX}px"></div>` : "";
    return `<div class="col" data-date="${ymd(d)}" style="height:${colH}px">
      ${offBlocks(d)}${events}${nowLine}</div>`;
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
    const d = addDays(first, i - lead), evs = daySessions(d);
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
  const editable = !s || canEditSession(s);
  form.elements.staffId.innerHTML = getMembers().filter((m) => takesClasses(m.userId) || m.userId === s?.staffId).map((m) => `<option value="${m.userId}">${esc(m.name)}</option>`).join("");
  v.staffId = s?.staffId ?? getMe().id;
  for (const [k, val] of Object.entries(v)) form.elements[k].value = val;
  $("staffWrap").hidden = !(getOrg().type === "business" && isAdmin());
  form.querySelectorAll("input,select").forEach((i) => { i.disabled = !editable; });
  form.querySelector("button[type=submit]").hidden = !editable;
  if (!editable) { $("dlgDelete").hidden = true; $("dlgError").textContent = "This session belongs to another staff member, so you can only view it."; }
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
const REAL = { cal: "calView", home: "homeView", people: "peopleView", profile: "profileView" };
const SOON = {
  resources: ["Resources", "Upload and share files and courses with your students."],
  gradebook: ["Gradebook", "Grade your students and track their progress over time."],
  chat: ["Chat", "Message students and parents."],
  reports: ["Reports", "Staff and student dashboards."],
};
function show(which) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
  $(REAL[which] || "soonView").classList.add("on");
  if (!REAL[which]) { $("soonTitle").textContent = SOON[which][0]; $("soonText").textContent = SOON[which][1] + " Coming in a later phase."; }
  document.querySelectorAll(".side [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === which));
  history.replaceState(null, "", "#" + which);
  if (which === "people") renderPeople();
  if (which === "profile") renderProfile();
}
document.querySelectorAll(".side [data-go]").forEach((b) => (b.onclick = () => { if (b.dataset.go === "profile") profileId = null; show(b.dataset.go); }));

// ---------- people: students ----------
let peopleTab = "students";
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
function renderPeople() {
  document.querySelectorAll("#peopleView [data-sub]").forEach((b) => b.classList.toggle("on", b.dataset.sub === peopleTab));
  const isStudents = peopleTab === "students", isTeam = peopleTab === "team";
  $("studentsPane").hidden = !isStudents;
  $("teamPane").hidden = !isTeam;
  $("peopleSoon").hidden = isStudents || isTeam;
  if (isTeam) return renderTeam();
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

// ---------- people: team (Solo accounts see what Business adds) ----------
const cap = (t) => t[0].toUpperCase() + t.slice(1);
function renderTeam() {
  const o = getOrg(), me = getMe(), admin = isAdmin(), body = $("teamBody");
  $("teamHint").textContent = o.type === "business" ? `${o.name} · you are ${me.role === "owner" ? "the owner" : "an " + me.role}` : "Account type: Solo";
  if (o.type === "solo") {
    body.innerHTML = `<div class="card"><h2>You're on a Solo account</h2><div class="pad"><p>Solo accounts are for one tutor: your own calendar, students and attendance.</p><p><b>Business accounts</b> let you invite staff, assign sessions to them, switch between everyone's calendars and share one student list across your team.</p>${me.role === "owner" ? '<button id="toBiz" class="add">Switch to a Business account</button>' : ""}</div></div>`;
    return;
  }
  const editable = (m) => admin && m.role !== "owner" && m.userId !== me.id;
  const rows = getMembers().map((m) => `<tr><td><span class="av">${esc(initials(m.name))}</span><button class="linkbtn" data-profile="${m.userId}">${esc(m.name)}</button>${m.userId === me.id ? " (you)" : ""}</td><td>${esc(m.email)}</td><td>${editable(m)
      ? `<select class="sel" data-role="${m.userId}"><option value="admin"${m.role === "admin" ? " selected" : ""}>Admin</option><option value="staff"${m.role === "staff" ? " selected" : ""}>Staff</option></select>`
      : `<span class="pill ${m.role === "staff" ? "inactive" : "active"}">${cap(m.role)}</span>`}</td><td>${editable(m) ? `<button class="undo" data-remove="${m.userId}">Remove</button>` : ""}</td></tr>`).join("");
  const pending = getInvites().map((i) => `<tr><td>${esc(i.email)}</td><td>${cap(i.role)}</td><td><button class="undo" data-revoke="${i.id}">Revoke</button></td></tr>`).join("");
  body.innerHTML = `<div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    + (admin
      ? `<h2 class="sect">Invite someone</h2><form id="inviteForm" class="toolbar"><input id="invEmail" type="email" required placeholder="Email address" aria-label="Email address"><select id="invRole" class="sel" aria-label="Role"><option value="staff">Staff</option><option value="admin">Admin</option></select><button class="add" type="submit">Send invite</button></form><p class="hint">Staff manage their own sessions and attendance. Admins manage everything and the team. They join automatically when they sign up or log in with this email. Invites aren't emailed yet, so send them the link yourself.</p>`
        + (pending ? `<h2 class="sect">Pending invites</h2><div class="tblwrap"><table class="tbl"><tbody>${pending}</tbody></table></div>` : "")
      : `<p class="hint">Only owners and admins can invite or remove people.</p>`)
    + `<p id="teamErr" class="err" role="alert"></p>`;
}
const teamErr = (m) => { $("teamErr").textContent = m; };
$("teamBody").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await inviteMember($("invEmail").value, $("invRole").value); renderTeam(); } catch (err) { teamErr(err.message); }
});
$("teamBody").addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-role]");
  if (!sel) return;
  try { await setRole(sel.dataset.role, sel.value); renderTeam(); } catch (err) { teamErr(err.message); }
});
$("teamBody").addEventListener("click", async (e) => {
  const rm = e.target.closest("[data-remove]"), rv = e.target.closest("[data-revoke]"), biz = e.target.closest("#toBiz"), pv = e.target.closest("[data-profile]");
  if (pv) return openProfile(pv.dataset.profile);
  try {
    if (rm) { if (!confirm("Remove this person? Their sessions will be reassigned to you.")) return; await removeMember(rm.dataset.remove); applyOrgUI(); renderAll(); }
    else if (rv) await revokeInvite(rv.dataset.revoke);
    else if (biz) { const n = prompt("What is your business called?"); if (!n || !n.trim()) return; await convertToBusiness(n.trim()); applyOrgUI(); renderAll(); }
    else return;
    renderTeam();
  } catch (err) { teamErr(err.message); }
});

// ---------- workspace switcher, staff filter, header ----------
let authUser = null;
const savedOrg = () => { try { return localStorage.getItem("tutordesk.org"); } catch { return null; } };
function applyOrgUI() {
  const o = getOrg(), me = getMe(), biz = o.type === "business";
  $("whoEmail").textContent = biz ? o.name : authUser.email;
  $("barName").hidden = biz;
  $("staffSel").hidden = !biz;
  if (!getMembers().some((m) => m.userId === staffFilter)) staffFilter = "all";
  $("staffSel").innerHTML = '<option value="all">Everyone</option>' + getMembers().map((m) => `<option value="${m.userId}">${esc(m.name)}${m.userId === me.id ? " (me)" : ""}</option>`).join("");
  $("staffSel").value = staffFilter;
  const list = getOrgs();
  $("orgSel").hidden = list.length < 2;
  $("orgSel").innerHTML = list.map((x) => `<option value="${x.id}">${esc(x.name)} (${x.type})</option>`).join("");
  $("orgSel").value = o.id;
}
$("staffSel").onchange = (e) => { staffFilter = e.target.value; renderWeek(); };
$("orgSel").onchange = async (e) => {
  try { localStorage.setItem("tutordesk.org", e.target.value); } catch { /* ignore */ }
  try { await loadAll(authUser.id, e.target.value); } catch (err) { return alert(err.message); }
  staffFilter = "all"; profileId = null; applyOrgUI(); renderAll(); renderPeople();
};

// ---------- profile: overview, working hours, leaves, timesheet ----------
let profileId = null, ptab = "overview", pMonth = new Date(), pDay = ymd(new Date());
const nowD = new Date();
let tsFrom = ymd(new Date(nowD.getFullYear(), nowD.getMonth(), 1)), tsTo = ymd(new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0));
const DAYS = [["Monday", 1], ["Tuesday", 2], ["Wednesday", 3], ["Thursday", 4], ["Friday", 5], ["Saturday", 6], ["Sunday", 0]];
const hrs = (h) => String(Math.round(h * 10) / 10);
const fmtD = (k) => parseYmd(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
function openProfile(id) { profileId = id; ptab = "overview"; show("profile"); }

function renderProfile() {
  const me = getMe();
  const m = getMembers().find((x) => x.userId === (profileId || me.id)) || getMembers().find((x) => x.userId === me.id);
  profileId = m.userId;
  const mine = profileId === me.id, canEdit = mine || isAdmin();
  $("pAvatar").textContent = initials(m.name); $("pName").textContent = m.name; $("pEmail").textContent = m.email;
  $("pSide").innerHTML = `<div class="sideblock"><label class="switch"><input type="checkbox" id="pTakes" ${takesClasses(profileId) ? "checked" : ""} ${canEdit ? "" : "disabled"}><span><b>Takes classes</b>Allow sessions to be assigned to this person.</span></label></div>
    <div class="sideblock"><div class="row2"><b>Personal information</b>${mine ? '<button class="undo" id="pEdit">Edit</button>' : ""}</div>
    <dl class="dl"><dt>Name</dt><dd>${esc(m.name)}</dd><dt>Email</dt><dd>${esc(m.email)}</dd><dt>Phone</dt><dd>${esc(m.phone || "Not set")}</dd><dt>Role</dt><dd>${cap(m.role)}</dd></dl></div>`;
  document.querySelectorAll("[data-ptab]").forEach((b) => b.classList.toggle("on", b.dataset.ptab === ptab));
  $("pBody").innerHTML = ({ overview: pOverview, calendar: pCalendar, hours: pHours, leaves: pLeaves, timesheet: pTimesheet })[ptab](canEdit, mine);
}

function pOverview() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const win = (a, b) => timesheet(profileId, ymd(addDays(today, a)), ymd(addDays(today, b)));
  const sum = (rows) => ({ c: rows.length, st: new Set(rows.map((r) => r.student.toLowerCase())).size, h: rows.reduce((t, r) => t + r.hours, 0) });
  const nx = sum(win(0, 6)), pv = sum(win(-7, -1));
  const stat = (label, a, b) => `<div class="stat">${label}<b>${a}</b><span class="pill2">${b}</span>Last 7 days</div>`;
  return `<div class="stats">${stat("Classes · next 7 days", nx.c, pv.c)}${stat("Students · next 7 days", nx.st, pv.st)}${stat("Hours booked · next 7 days", hrs(nx.h), hrs(pv.h))}</div>
    <h2 class="sect">Upcoming classes</h2><div class="cols2"><div>${miniCal()}</div><div><h2>Schedule for ${fmtD(pDay)}</h2><div class="card">${dayList()}</div></div></div>`;
}
function miniCal() {
  const y = pMonth.getFullYear(), mo = pMonth.getMonth(), first = new Date(y, mo, 1), lead = (first.getDay() + 6) % 7;
  const weeks = Math.ceil((lead + new Date(y, mo + 1, 0).getDate()) / 7);
  const cells = [...Array(weeks * 7)].map((_, i) => {
    const d = addDays(first, i - lead), k = ymd(d), has = sessionsOn(d).some((x) => x.staffId === profileId);
    return `<div class="d${d.getMonth() !== mo ? " out" : ""}${has ? " dot" : ""}${k === pDay ? " sel" : ""}" data-pday="${k}">${d.getDate()}</div>`;
  }).join("");
  return `<div class="row2"><b>${first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b><span><button class="undo" data-pmonth="-1" aria-label="Previous month">&lsaquo;</button> <button class="undo" data-pmonth="1" aria-label="Next month">&rsaquo;</button></span></div>
    <div class="minical">${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => `<div class="h">${d}</div>`).join("")}${cells}</div>`;
}
function dayList() {
  const rows = timesheet(profileId, pDay, pDay);
  return rows.length
    ? rows.map((r) => `<div class="row"><div>${fmtT(r.start)} - ${fmtT(r.end)}<br><span>${esc(r.title)} · ${esc(r.student)}</span></div></div>`).join("")
    : '<p class="empty">No sessions on this date.</p>';
}
function pCalendar(canEdit, mine) {
  return `<p class="hint">See ${mine ? "your" : "their"} sessions on the main calendar.</p><p><button class="add" data-gocal>Open ${mine ? "my" : "their"} calendar</button></p>`;
}
function pHours(canEdit) {
  const h = getHours(profileId), dis = canEdit ? "" : "disabled";
  return `<p class="hint">Outside these hours the calendar is shaded. You can still add sessions outside them.</p>
    <div class="tblwrap"><table class="tbl"><tbody>${DAYS.map(([n, d]) => `<tr style="cursor:default"><td>${n}</td><td><label class="switch"><input type="checkbox" data-open="${d}" ${h[d] ? "checked" : ""} ${dis}> Open</label></td><td><input type="time" data-from="${d}" value="${h[d]?.[0] ?? "09:00"}" ${dis} aria-label="${n} start"> – <input type="time" data-to="${d}" value="${h[d]?.[1] ?? "17:00"}" ${dis} aria-label="${n} end"></td></tr>`).join("")}</tbody></table></div>
    ${canEdit ? '<p><button class="add" id="saveHours">Save working hours</button></p>' : ""}<p id="pErr" class="err" role="alert"></p>`;
}
function pLeaves(canEdit) {
  const list = getLeaves(profileId).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const range = (l) => (l.start_date === l.end_date ? fmtD(l.start_date) : `${fmtD(l.start_date)} – ${fmtD(l.end_date)}`);
  return (canEdit ? '<form id="leaveForm" class="toolbar"><input type="date" name="from" required aria-label="From"><input type="date" name="to" required aria-label="To"><input name="reason" placeholder="Reason (optional)" maxlength="200" aria-label="Reason"><button class="add" type="submit">Add leave</button></form>' : "")
    + (list.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Dates</th><th>Reason</th><th></th></tr></thead><tbody>${list.map((l) => `<tr style="cursor:default"><td>${range(l)}</td><td>${esc(l.reason || "")}</td><td>${canEdit ? `<button class="undo" data-delleave="${l.id}">Remove</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty" style="padding:0">No leaves recorded.</p>')
    + '<p id="pErr" class="err" role="alert"></p>';
}
function pTimesheet() {
  const rows = timesheet(profileId, tsFrom, tsTo), tot = rows.reduce((t, r) => t + r.hours, 0), done = rows.filter((r) => r.marked).reduce((t, r) => t + r.hours, 0);
  return `<div class="toolbar"><input type="date" data-ts="from" value="${tsFrom}" aria-label="From"><input type="date" data-ts="to" value="${tsTo}" aria-label="To"><button class="add" id="csvBtn">Download CSV</button></div>
    <div class="stats"><div class="stat">Sessions<b>${rows.length}</b></div><div class="stat">Scheduled hours<b>${hrs(tot)}</b></div><div class="stat">Hours attended<b>${hrs(done)}</b></div></div>
    ${rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Time</th><th>Class</th><th>Student</th><th>Hours</th><th>Attendance</th></tr></thead><tbody>${rows.map((r) => `<tr style="cursor:default"><td>${fmtD(r.date)}</td><td>${fmtT(r.start)} - ${fmtT(r.end)}</td><td>${esc(r.title)}</td><td>${esc(r.student)}</td><td>${hrs(r.hours)}</td><td>${r.marked ? "Marked" : "&mdash;"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty" style="padding:0">No sessions in this range.</p>'}`;
}
function downloadCsv() {
  const rows = timesheet(profileId, tsFrom, tsTo);
  // a leading ' stops spreadsheets treating text like =SUM(...) as a formula
  const q = (v) => { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const csv = [["Date", "Start", "End", "Class", "Student", "Hours", "Attendance"], ...rows.map((r) => [r.date, r.start, r.end, r.title, r.student, hrs(r.hours), r.marked ? "Marked" : ""])]
    .map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `timesheet-${tsFrom}-to-${tsTo}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll("[data-ptab]").forEach((b) => (b.onclick = () => { ptab = b.dataset.ptab; renderProfile(); }));
$("pBody").addEventListener("click", async (e) => {
  const t = (sel) => e.target.closest(sel);
  try {
    if (t("[data-pmonth]")) pMonth = new Date(pMonth.getFullYear(), pMonth.getMonth() + Number(t("[data-pmonth]").dataset.pmonth), 1);
    else if (t("[data-pday]")) pDay = t("[data-pday]").dataset.pday;
    else if (t("[data-gocal]")) { staffFilter = profileId; applyOrgUI(); show("cal"); return renderWeek(); }
    else if (t("#csvBtn")) return downloadCsv();
    else if (t("[data-delleave]")) { await deleteLeave(t("[data-delleave]").dataset.delleave); renderWeek(); }
    else if (t("#saveHours")) {
      const wh = {};
      for (const [, d] of DAYS) {
        if (!document.querySelector(`[data-open="${d}"]`).checked) continue;
        const a = document.querySelector(`[data-from="${d}"]`).value, z = document.querySelector(`[data-to="${d}"]`).value;
        if (!a || !z || z <= a) throw new Error("Each open day needs a start time before its end time.");
        wh[d] = [a, z];
      }
      await saveSettings(profileId, { workingHours: wh });
      renderWeek(); renderProfile();
      $("pErr").className = "hint"; $("pErr").textContent = "Saved.";
      return;
    } else return;
    renderProfile();
  } catch (err) { const el = $("pErr"); if (el) el.textContent = err.message; else alert(err.message); }
});
$("pBody").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    if (f.get("to") < f.get("from")) throw new Error("The end date can't be before the start date.");
    await addLeave(profileId, f.get("from"), f.get("to"), f.get("reason"));
    renderWeek(); renderProfile();
  } catch (err) { $("pErr").textContent = err.message; }
});
$("pBody").addEventListener("change", (e) => {
  const el = e.target.closest("[data-ts]");
  if (!el || !el.value) return;
  if (el.dataset.ts === "from") tsFrom = el.value; else tsTo = el.value;
  renderProfile();
});
$("pSide").addEventListener("change", async (e) => {
  if (e.target.id !== "pTakes") return;
  try { await saveSettings(profileId, { takesClasses: e.target.checked }); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
});

const pDlg = $("profileDialog"), pForm = $("profileForm");
$("pSide").addEventListener("click", (e) => {
  if (e.target.id !== "pEdit") return;
  const m = getMembers().find((x) => x.userId === getMe().id);
  pForm.elements.name.value = m.name; pForm.elements.phone.value = m.phone || "";
  $("pfError").textContent = "";
  pDlg.showModal(); pForm.elements.name.focus();
});
pForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = pForm.elements.name.value.trim();
  try { await saveProfile({ fullName: name, phone: pForm.elements.phone.value.trim() }); } catch (err) { $("pfError").textContent = err.message; return; }
  pDlg.close();
  $("whoName").textContent = name; $("barName").textContent = name; $("helloName").textContent = name;
  renderProfile(); renderAll();
});
$("pfCancel").onclick = () => pDlg.close();
pDlg.addEventListener("click", (e) => { if (e.target === pDlg) pDlg.close(); });

function renderAll() { renderWeek(); renderDash(); }

// ---------- log in / sign up ----------
let mode = "login";
function syncBiz() {
  const biz = mode === "signup" && document.querySelector("[name=acct]:checked").value === "business";
  $("authBizWrap").hidden = !biz;
  $("authBiz").required = biz;
}
document.querySelectorAll("[name=acct]").forEach((r) => (r.onchange = syncBiz));
function setMode(m) {
  mode = m;
  const signup = m === "signup";
  $("authTitle").textContent = signup ? "Create your account" : "Log in";
  $("authSubmit").textContent = signup ? "Create account" : "Log in";
  $("authNameWrap").hidden = !signup;
  $("authType").hidden = !signup;
  syncBiz();
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
    else if (!(await auth.signUp(email, password, $("authName").value.trim(), document.querySelector("[name=acct]:checked").value, $("authBiz").value.trim()))) {
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
  if (!user) { clearAll(); profileId = null; $("authPassword").value = ""; return; }
  try {
    const [profile] = await Promise.all([getProfile(user.id), loadAll(user.id, savedOrg())]);
    const name = profile?.full_name || user.email.split("@")[0];
    $("whoName").textContent = name; $("barName").textContent = name; $("helloName").textContent = name;
    authUser = user;
    applyOrgUI();
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
