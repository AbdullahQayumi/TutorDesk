import "./style.css";
import { ymd, parseYmd, sessionsOn, getSession, saveSession, deleteSession, markAttendance, unmarkAttendance, recentOccurrences, getTimeline, stats, monthStats, listStudents, getStudent, saveStudent, deleteStudent, getOrg, getOrgs, getMe, isAdmin, canEditSession, getMembers, getInvites, staffName, inviteMember, revokeInvite, setRole, removeMember, convertToBusiness, takesClasses, getHours, saveSettings, getLeaves, onLeave, addLeave, deleteLeave, timesheet, saveProfile, listBatches, getBatch, batchStudentIds, studentBatches, saveBatch, deleteBatch, listGuardians, getGuardian, guardianStudentIds, studentGuardians, saveGuardian, deleteGuardian, studentHistory, markAllAttendance, studentLabel, todayOccurrences, invoiceTotals, listInvoices, getInvoice, billableLines, createInvoice, addPayment, deletePayment, voidInvoice, saveBilling, money, studentInvoices, staffReport, studentReport, revenueReport, listResources, studentResources, uploadResource, updateResource, deleteResource, resourceUrls, resourceLink, RES_ACCEPT, loadAll, clearAll, getProfile } from "./store.js";
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

// Each class gets a colour from its name, so the calendar is easy to scan.
const colorOf = (t) => "c" + ([...t].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6);
// "✓ " when everyone was present, "2/3 " when only some were
const attMark = (s) => (s.total && s.presentCount === s.total ? "&#10003; " : s.presentCount ? `${s.presentCount}/${s.total} ` : "");

// Shading: outside the viewed person's working hours, and the whole day when they are on leave.
function offBlocks(d) {
  const who = staffFilter === "all" ? getMe().id : staffFilter, h = getHours(who)[d.getDay()];
  if (onLeave(who, ymd(d))) return '<div class="off lv" style="top:0;bottom:0"></div><span class="leave">On leave</span>';
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
      return `<button class="ev ${colorOf(s.title)}" data-id="${s.id}" data-occ="${s.occurrence}" style="top:${top}px;height:${h}px;${pos}"><span class="tm">${fmtT(s.start)} - ${fmtT(s.end)}<br></span>${attMark(s)}${esc(s.title)}<small>${esc(studentLabel(s))}${getOrg().type === "business" ? " · " + esc(staffName(s.staffId)) : ""}</small></button>`;
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
    const chips = evs.slice(0, max).map((s) => `<button class="chip ${colorOf(s.title)}" data-id="${s.id}" data-occ="${s.occurrence}">${attMark(s)}${esc(s.title)}</button>`).join("");
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
  if (chip) return openOcc(chip.dataset.id, chip.dataset.occ);
  const cell = e.target.closest(".mcell");
  if (cell) { anchor = parseYmd(cell.dataset.date); return setView("day"); } // click a date to zoom into that day
  const ev = e.target.closest(".ev");
  if (ev) return openOcc(ev.dataset.id, ev.dataset.occ);
  const col = e.target.closest(".col");
  if (!col) return;
  const y = e.clientY - col.getBoundingClientRect().top;
  openDialog({ date: col.dataset.date, start: hourStr(Math.min(END_H - 1, Math.floor(START_H + y / HOUR_PX))) });
});

// ---------- add / edit dialog ----------
const dlg = $("sessionDialog"), form = $("sessionForm");

// The "Students" part of the session form: tick students, add a whole batch, or type a new name.
const updateCount = () => { $("sCount").textContent = `(${checked($("sStudents")).length} selected)`; };
function sessionStudentsInit(selected) {
  checklist($("sStudents"), selected);
  $("sStuFilter").value = ""; $("sNewStudent").value = "";
  $("sBatchPick").innerHTML = '<option value="">Add a whole batch…</option>' + listBatches().map((b) => `<option value="${b.id}">${esc(b.name)} (${batchStudentIds(b.id).length})</option>`).join("");
  updateCount();
}
$("sBatchPick").onchange = (e) => {
  const ids = e.target.value ? batchStudentIds(e.target.value) : [];
  $("sStudents").querySelectorAll("input").forEach((i) => { if (ids.includes(i.value)) i.checked = true; });
  e.target.value = ""; updateCount();
};
$("sStuFilter").oninput = (e) => {
  const q = e.target.value.trim().toLowerCase();
  $("sStudents").querySelectorAll(".chk").forEach((l) => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); });
};
$("sStudents").addEventListener("change", updateCount);

function openDialog({ id, date, start } = {}) {
  const s = id ? getSession(id) : null;
  const startH = start ?? "18:00";
  $("dlgTitle").textContent = s ? "Edit session" : "Add session";
  $("dlgDelete").hidden = !s;
  $("dlgHint").hidden = !(s && s.repeat === "weekly");
  $("dlgError").textContent = "";
  form.reset();
  sessionStudentsInit(s ? s.studentIds : []);
  const v = {
    id: s?.id ?? "", title: s?.title ?? "", price: s?.price ?? "",
    date: s?.date ?? date ?? ymd(new Date()), start: s?.start ?? startH,
    end: s?.end ?? (parseInt(startH, 10) >= 23 ? "23:59" : hourStr(parseInt(startH, 10) + 1)), repeat: s?.repeat ?? "none",
  };
  const editable = !s || canEditSession(s);
  form.elements.staffId.innerHTML = getMembers().filter((m) => takesClasses(m.userId) || m.userId === s?.staffId).map((m) => `<option value="${m.userId}">${esc(m.name)}</option>`).join("");
  v.staffId = s?.staffId ?? getMe().id;
  for (const [k, val] of Object.entries(v)) form.elements[k].value = val;
  $("staffWrap").hidden = !(getOrg().type === "business" && isAdmin());
  $("priceWrap").hidden = !isAdmin();
  form.querySelectorAll("input,select").forEach((i) => { i.disabled = !editable; });
  form.querySelector("button[type=submit]").hidden = !editable;
  if (!editable) { $("dlgDelete").hidden = true; $("dlgError").textContent = "This session belongs to another staff member, so you can only view it."; }
  dlg.showModal();
  form.elements.title.focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  f.title = f.title.trim();
  if (!isAdmin()) delete f.price; // only owners and admins set prices
  if (f.end <= f.start) { $("dlgError").textContent = "End time must be after the start time."; return; }
  if (!f.id) delete f.id;
  try {
    const ids = checked($("sStudents")), newName = $("sNewStudent").value.trim();
    if (newName) { // a typed name matches an existing student, or creates a new one
      const known = listStudents().find((x) => x.name.toLowerCase() === newName.toLowerCase());
      ids.push((known || await saveStudent({ name: newName, status: "active" })).id);
    }
    if (!ids.length) throw new Error("Add at least one student to this session.");
    f.studentIds = ids;
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

function attRow(o, showDate) {
  const biz = getOrg().type === "business";
  const sub = `${showDate ? fmtDay(parseYmd(o.occurrence)) + " · " : ""}${fmtT(o.start)} - ${fmtT(o.end)} · ${esc(studentLabel(o))}${biz ? " · " + esc(staffName(o.staffId)) : ""}`;
  const at = `data-id="${o.id}" data-occ="${o.occurrence}"`;
  let act;
  if (o.total === 1 && canEditSession(o)) { // one student: mark with a single tap
    const sid = o.studentIds[0];
    act = o.presentCount
      ? `<span class="act"><span class="mark done">Marked</span><button class="undo" data-act="unmark" ${at} data-sid="${sid}">Unmark</button></span>`
      : `<button class="mark" data-act="mark" ${at} data-sid="${sid}">Mark attendance</button>`;
  } else { // a group: open the attendance list
    act = `<button class="mark${o.total && o.presentCount === o.total ? " done" : ""}" data-act="open" ${at}>${o.total ? `${o.presentCount}/${o.total} present` : "Add students"}</button>`;
  }
  return `<div class="row"><div><b class="dot ${colorOf(o.title)}"></b>${esc(o.title)}<br><span>${sub}</span></div>${act}</div>`;
}

function renderDash() {
  $("todayLine").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const today = todayOccurrences();
  $("todayList").innerHTML = today.length ? today.map((o) => attRow(o, false)).join("") : '<p class="empty">Nothing scheduled today.</p>';
  const rows = recentOccurrences(6);
  $("att").innerHTML = rows.length ? rows.map((o) => attRow(o, true)).join("") : '<p class="empty">No past sessions yet.</p>';
  const tl = getTimeline();
  $("tl").innerHTML = tl.length ? tl.map((t) => `<div class="tl"><i></i><p>Attendance for <b>${esc(t.title)}</b> on ${fmtDay(parseYmd(t.occurrence))}: ${t.count} of ${t.total} present<em>${new Date(t.at).toLocaleString("en-GB")}</em></p></div>`).join("")
    : '<p class="empty">Activity will appear here.</p>';
  const st = stats();
  $("sToday").textContent = today.length; $("sWeek").textContent = st.week; $("sActive").textContent = st.students;
  $("sRate").textContent = st.rate == null ? "–" : st.rate + "%";
  $("moneyStats").hidden = !isAdmin();
  if (isAdmin()) {
    const t = invoiceTotals();
    $("sColl").textContent = money(t.collectedThisMonth); $("sOut").textContent = money(t.outstanding);
    $("sOver").textContent = t.overdue > 0 ? `${money(t.overdue)} overdue` : "Nothing overdue";
  }
  renderInsights();
}

const attClick = async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  if (b.dataset.act === "open") return openOcc(b.dataset.id, b.dataset.occ);
  const change = b.dataset.act === "unmark" ? unmarkAttendance : markAttendance;
  b.disabled = true; // stops double-clicks
  try { await change(b.dataset.id, b.dataset.occ, b.dataset.sid); } catch (err) { b.disabled = false; return alert(err.message); }
  renderAll();
};
$("att").addEventListener("click", attClick);
$("todayList").addEventListener("click", attClick);
$("homeAdd").onclick = () => openDialog();

// The attendance popup: click a session on the calendar (or "x/y present") to tick who was there.
const occDlg = $("occDialog");
let occ = null;
function openOcc(id, occurrence) { occ = { id, occurrence }; renderOcc(); occDlg.showModal(); }
function renderOcc() {
  const o = sessionsOn(parseYmd(occ.occurrence)).find((x) => x.id === occ.id);
  if (!o) { occDlg.close(); return; }
  const can = canEditSession(o), biz = getOrg().type === "business";
  $("occTitle").textContent = o.title;
  $("occWhen").textContent = `${fmtD(o.occurrence)} · ${fmtT(o.start)} - ${fmtT(o.end)}${biz ? " · " + staffName(o.staffId) : ""}`;
  $("occList").innerHTML = o.studentIds.length
    ? o.studentIds.map((sid) => `<label class="chk"><input type="checkbox" data-sid="${sid}" ${o.present.includes(sid) ? "checked" : ""} ${can ? "" : "disabled"}> ${esc(getStudent(sid)?.name ?? "Student")}</label>`).join("")
    : '<p class="hint" style="padding:8px 0">No students in this session yet. Use Edit session to add some.</p>';
  $("occAll").hidden = !can || !o.studentIds.length;
  $("occEdit").hidden = !can;
  $("occErr").textContent = can ? "" : "This session belongs to another staff member, so you can only view it.";
}
$("occList").addEventListener("change", async (e) => {
  const box = e.target.closest("[data-sid]");
  if (!box) return;
  try { await (box.checked ? markAttendance : unmarkAttendance)(occ.id, occ.occurrence, box.dataset.sid); }
  catch (err) { box.checked = !box.checked; $("occErr").textContent = err.message; return; }
  renderAll();
});
$("occAll").onclick = async () => {
  try { await markAllAttendance(occ.id, occ.occurrence); } catch (err) { $("occErr").textContent = err.message; return; }
  renderAll(); renderOcc();
};
$("occEdit").onclick = () => { occDlg.close(); openDialog({ id: occ.id }); };
$("occClose").onclick = () => occDlg.close();
occDlg.addEventListener("click", (e) => { if (e.target === occDlg) occDlg.close(); });

// ---------- navigation ----------
const SECTIONS = ["home", "cal", "people", "invoices", "resources", "gradebook", "chat", "reports", "profile"];
const REAL = { cal: "calView", home: "homeView", people: "peopleView", profile: "profileView", invoices: "invoicesView", reports: "reportsView", resources: "resourcesView" };
const TITLES = { home: "Home", cal: "Calendar", people: "People", invoices: "Invoices", resources: "Resources", gradebook: "Gradebook", chat: "Chat", reports: "Reports", profile: "Profile" };
const SOON = {
  gradebook: ["Gradebook", "Grade your students and track their progress over time."],
  chat: ["Chat", "Message students and parents."],
};
function show(which) {
  if ((which === "invoices" || which === "reports") && !isAdmin()) which = "home"; // money and reports are for owners and admins
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
  $(REAL[which] || "soonView").classList.add("on");
  if (!REAL[which]) { $("soonTitle").textContent = SOON[which][0]; $("soonText").textContent = SOON[which][1] + " Coming in a later phase."; }
  document.querySelectorAll(".side [data-go]").forEach((b) => b.classList.toggle("on", b.dataset.go === which));
  history.replaceState(null, "", "#" + which);
  $("pageTitle").textContent = TITLES[which];
  if (which === "people") renderPeople();
  if (which === "profile") renderProfile();
  if (which === "invoices") renderInvoices();
  if (which === "reports") renderReports();
  if (which === "resources") renderResources();
}
document.querySelectorAll(".side [data-go]").forEach((b) => (b.onclick = () => { if (b.dataset.go === "profile") profileId = null; show(b.dataset.go); }));

// ---------- people: students ----------
let peopleTab = "students", studentOpenId = null; // studentOpenId: the student whose page is showing
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
function renderPeople() {
  document.querySelectorAll("#peopleView [data-sub]").forEach((b) => b.classList.toggle("on", b.dataset.sub === peopleTab));
  const tab = peopleTab;
  $("studentsPane").hidden = !(tab === "students" && !studentOpenId);
  $("studentPage").hidden = !(tab === "students" && studentOpenId);
  $("teamPane").hidden = tab !== "team";
  $("batchesPane").hidden = tab !== "batches";
  $("guardiansPane").hidden = tab !== "guardians";
  $("peopleSoon").hidden = true;
  if (tab === "team") return renderTeam();
  if (tab === "batches") return renderBatches();
  if (tab === "guardians") return renderGuardians();
  if (studentOpenId) return renderStudentPage();
  const keepBatch = $("stBatch").value || "all";
  $("stBatch").innerHTML = '<option value="all">All batches</option>' + listBatches().map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("stBatch").value = keepBatch;
  const bf = $("stBatch").value || "all";
  const all = listStudents(), q = $("stSearch").value.trim().toLowerCase(), f = $("stFilter").value;
  const rows = all.filter((s) => (f === "all" || s.status === f) && (bf === "all" || batchStudentIds(bf).includes(s.id)) && `${s.name} ${s.email || ""} ${s.phone || ""}`.toLowerCase().includes(q));
  $("stActive").textContent = all.filter((s) => s.status === "active").length;
  $("stNew").textContent = all.filter((s) => Date.now() - new Date(s.created_at) < 30 * 864e5).length;
  $("stTotal").textContent = all.length;
  $("studentTable").innerHTML = rows.length
    ? `<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Email</th><th>Phone</th><th>Created</th></tr></thead><tbody>${rows.map((s) =>
        `<tr data-id="${s.id}" tabindex="0"><td><span class="av">${esc(initials(s.name))}</span>${esc(s.name)}</td><td><span class="pill ${s.status}">${s.status === "active" ? "Active" : "Inactive"}</span></td><td>${esc(s.email || "")}</td><td>${esc(s.phone || "")}</td><td>${new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td></tr>`).join("")}</tbody></table>`
    : `<p class="empty">${all.length ? "No students match your search." : "No students yet. Click Add student to create the first one."}</p>`;
}
document.querySelectorAll("#peopleView [data-sub]").forEach((b) => (b.onclick = () => { peopleTab = b.dataset.sub; studentOpenId = null; renderPeople(); }));
$("stSearch").oninput = renderPeople;
$("stFilter").onchange = renderPeople;
$("stBatch").onchange = renderPeople;

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
const rowOpen = (e) => { const r = e.target.closest("tr[data-id]"); if (r) { studentOpenId = r.dataset.id; renderPeople(); } }; // opens the student page
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

// ---------- people: student page, batches, guardians ----------
const checklist = (el, selected) => {
  const all = listStudents();
  el.innerHTML = all.length
    ? all.map((s) => `<label class="chk"><input type="checkbox" value="${s.id}" ${selected.includes(s.id) ? "checked" : ""}> ${esc(s.name)}</label>`).join("")
    : '<p class="hint">Add some students first.</p>';
};
const checked = (el) => [...el.querySelectorAll("input:checked")].map((i) => i.value);
const onRow = (fn) => (e) => {
  if (e.type === "keydown" && e.key !== "Enter") return;
  const r = e.target.closest("tr[data-id]");
  if (r) fn(r.dataset.id);
};

function renderStudentPage() {
  const s = getStudent(studentOpenId);
  if (!s) { studentOpenId = null; return renderPeople(); }
  const { past, upcoming } = studentHistory(s.id), attended = past.filter((r) => r.marked).length;
  const rate = past.length ? Math.round((100 * attended) / past.length) + "%" : "n/a";
  const gs = studentGuardians(s.id), bs = studentBatches(s.id), biz = getOrg().type === "business";
  const staffTxt = (r) => (biz ? " · " + esc(staffName(r.staffId)) : "");
  $("studentPage").innerHTML = `<button class="linkbtn" id="spBack">&larr; All students</button>
    <div class="phead" style="margin-top:12px"><div><h1><span class="av">${esc(initials(s.name))}</span>${esc(s.name)} <span class="pill ${s.status}">${s.status === "active" ? "Active" : "Inactive"}</span></h1>
    <p class="hint">${esc(s.email || "No email")} · ${esc(s.phone || "No phone")}</p></div><button class="add" id="spEdit">Edit student</button></div>
    <div class="stats"><div class="stat">Attended<b>${attended}</b></div><div class="stat">Past sessions<b>${past.length}</b></div><div class="stat">Attendance rate<b>${rate}</b></div></div>
    <h2 class="sect">Guardians <button class="undo" id="spAddGuardian">Add guardian</button></h2>
    ${gs.length ? `<div class="card">${gs.map((g) => `<div class="row"><div>${esc(g.name)}${g.relationship ? ` (${esc(g.relationship)})` : ""}<br><span>${[g.email, g.phone].filter(Boolean).map(esc).join(" · ") || "No contact details"}</span></div></div>`).join("")}</div>` : '<p class="hint">No guardians linked yet.</p>'}
    <h2 class="sect">Batches</h2>${bs.length ? bs.map((b) => `<span class="pill2">${esc(b.name)}</span>`).join("") : '<p class="hint">Not in any batch.</p>'}
    ${invSection(s)}${resSection(s)}<h2 class="sect">Upcoming sessions</h2>${upcoming.length ? `<div class="card">${upcoming.slice(0, 5).map((r) => `<div class="row"><div>${esc(r.title)}<br><span>${fmtD(r.date)} · ${fmtT(r.start)} - ${fmtT(r.end)}${staffTxt(r)}</span></div></div>`).join("")}</div>` : '<p class="hint">Nothing scheduled in the next four weeks.</p>'}
    <h2 class="sect">Attendance history</h2>${past.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Time</th><th>Class</th>${biz ? "<th>Staff</th>" : ""}<th>Attendance</th></tr></thead><tbody>${past.slice(0, 100).map((r) => `<tr style="cursor:default"><td>${fmtD(r.date)}</td><td>${fmtT(r.start)} - ${fmtT(r.end)}</td><td>${esc(r.title)}</td>${biz ? `<td>${esc(staffName(r.staffId))}</td>` : ""}<td><span class="pill ${r.marked ? "active" : "inactive"}">${r.marked ? "Marked" : "Not marked"}</span></td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">No past sessions yet.</p>'}`;
}
$("studentPage").addEventListener("click", (e) => {
  if (e.target.closest("#spBack")) { studentOpenId = null; renderPeople(); }
  else if (e.target.closest("#spEdit")) openStudent(studentOpenId);
  else if (e.target.closest("#spAddGuardian")) openGuardian(null, studentOpenId);
  else if (e.target.closest("#spNewInv")) openNewInvoice(studentOpenId);
  else if (e.target.closest("#spUpload")) openUpload(studentOpenId);
  else if (e.target.closest("[data-inv]")) openInvoice(e.target.closest("[data-inv]").dataset.inv);
});

// batches
const bDlg = $("batchDialog"), bForm = $("batchForm");
function renderBatches() {
  const list = listBatches();
  $("batchTable").innerHTML = list.length
    ? `<table class="tbl"><thead><tr><th>Batch</th><th>Students</th><th>Description</th></tr></thead><tbody>${list.map((b) => {
        const names = batchStudentIds(b.id).map((i) => getStudent(i)?.name).filter(Boolean);
        return `<tr data-id="${b.id}" tabindex="0"><td>${esc(b.name)}</td><td>${names.length}${names.length ? " · " + esc(names.slice(0, 3).join(", ")) + (names.length > 3 ? "…" : "") : ""}</td><td>${esc(b.description || "")}</td></tr>`;
      }).join("")}</tbody></table>`
    : '<p class="empty">No batches yet. A batch is a group of students, like "Year 5 Maths".</p>';
}
function openBatch(id) {
  const b = id ? getBatch(id) : null;
  $("bTitle").textContent = b ? "Edit batch" : "Add batch";
  $("bDelete").hidden = !(b && isAdmin());
  $("bError").textContent = "";
  bForm.reset();
  bForm.elements.id.value = b?.id ?? ""; bForm.elements.name.value = b?.name ?? ""; bForm.elements.description.value = b?.description ?? "";
  checklist($("bStudents"), b ? batchStudentIds(b.id) : []);
  bDlg.showModal(); bForm.elements.name.focus();
}
$("addBatchBtn").onclick = () => openBatch();
$("batchTable").addEventListener("click", onRow(openBatch));
$("batchTable").addEventListener("keydown", onRow(openBatch));
bForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(bForm));
  try { await saveBatch({ id: f.id || undefined, name: f.name.trim(), description: f.description.trim(), studentIds: checked($("bStudents")) }); }
  catch (err) { $("bError").textContent = err.message; return; }
  bDlg.close(); renderPeople();
});
$("bCancel").onclick = () => bDlg.close();
$("bDelete").onclick = async () => {
  if (!confirm("Delete this batch? The students stay.")) return;
  try { await deleteBatch(bForm.elements.id.value); } catch (err) { $("bError").textContent = err.message; return; }
  bDlg.close(); renderPeople();
};
bDlg.addEventListener("click", (e) => { if (e.target === bDlg) bDlg.close(); });

// guardians
const gDlg = $("guardianDialog"), gForm = $("guardianForm");
function renderGuardians() {
  const list = listGuardians();
  $("guardianTable").innerHTML = list.length
    ? `<table class="tbl"><thead><tr><th>Name</th><th>Relationship</th><th>Email</th><th>Phone</th><th>Children</th></tr></thead><tbody>${list.map((g) =>
        `<tr data-id="${g.id}" tabindex="0"><td>${esc(g.name)}</td><td>${esc(g.relationship || "")}</td><td>${esc(g.email || "")}</td><td>${esc(g.phone || "")}</td><td>${esc(guardianStudentIds(g.id).map((i) => getStudent(i)?.name).filter(Boolean).join(", "))}</td></tr>`).join("")}</tbody></table>`
    : '<p class="empty">No guardians yet. Add a parent or guardian and link them to their children.</p>';
}
function openGuardian(id, presetStudentId) {
  const g = id ? getGuardian(id) : null;
  $("gTitle").textContent = g ? "Edit guardian" : "Add guardian";
  $("gDelete").hidden = !(g && isAdmin());
  $("gError").textContent = "";
  gForm.reset();
  for (const k of ["id", "name", "relationship", "email", "phone"]) gForm.elements[k].value = g?.[k] ?? "";
  checklist($("gStudents"), g ? guardianStudentIds(g.id) : presetStudentId ? [presetStudentId] : []);
  gDlg.showModal(); gForm.elements.name.focus();
}
$("addGuardianBtn").onclick = () => openGuardian();
$("guardianTable").addEventListener("click", onRow((id) => openGuardian(id)));
$("guardianTable").addEventListener("keydown", onRow((id) => openGuardian(id)));
gForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(gForm));
  try { await saveGuardian({ id: f.id || undefined, name: f.name.trim(), relationship: f.relationship.trim(), email: f.email.trim(), phone: f.phone.trim(), studentIds: checked($("gStudents")) }); }
  catch (err) { $("gError").textContent = err.message; return; }
  gDlg.close(); renderPeople();
});
$("gCancel").onclick = () => gDlg.close();
$("gDelete").onclick = async () => {
  if (!confirm("Delete this guardian?")) return;
  try { await deleteGuardian(gForm.elements.id.value); } catch (err) { $("gError").textContent = err.message; return; }
  gDlg.close(); renderPeople();
};
gDlg.addEventListener("click", (e) => { if (e.target === gDlg) gDlg.close(); });

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

// ---------- invoices ----------
const STATE = { open: ["Unpaid", "inactive"], partial: ["Part paid", "inactive"], overdue: ["Overdue", "bad"], paid: ["Paid", "active"], void: ["Void", "inactive"] };
const pillFor = (st) => `<span class="pill ${STATE[st][1]}">${STATE[st][0]}</span>`;
const dShort = (k) => parseYmd(k).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const afterMoney = () => { renderInvoices(); renderDash(); if (studentOpenId) renderPeople(); };

const invSection = (st) => {
  if (!isAdmin()) return "";
  const list = studentInvoices(st.id);
  return `<h2 class="sect">Invoices <button class="undo" id="spNewInv">New invoice</button></h2>` + (list.length
    ? `<div class="card">${list.map((i) => `<div class="row" data-inv="${i.id}" style="cursor:pointer"><div>${esc(i.number)} · ${dShort(i.issue_date)}<br><span>${money(i.total)}${i.state !== "void" && i.balance > 0 ? " · balance " + money(i.balance) : ""}</span></div>${pillFor(i.state)}</div>`).join("")}</div>`
    : '<p class="hint">No invoices yet.</p>');
};

function renderInvoices() {
  const t = invoiceTotals();
  $("iOut").textContent = money(t.outstanding); $("iOver").textContent = money(t.overdue);
  $("iMonth").textContent = money(t.invoicedThisMonth); $("iColl").textContent = money(t.collectedThisMonth);
  $("invSettingsBtn").hidden = getMe().role !== "owner";
  const keep = $("invStudent").value || "all";
  $("invStudent").innerHTML = '<option value="all">All students</option>' + listStudents().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  $("invStudent").value = keep;
  const sf = $("invStudent").value || "all", f = $("invFilter").value;
  const all = listInvoices();
  const rows = all.filter((i) => (sf === "all" || i.student_id === sf) && (f === "all" || (f === "unpaid" ? ["open", "partial", "overdue"].includes(i.state) : i.state === f)));
  $("invTable").innerHTML = rows.length
    ? `<table class="tbl"><thead><tr><th>Number</th><th>Student</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead><tbody>${rows.map((i) =>
        `<tr data-id="${i.id}" tabindex="0"><td>${esc(i.number)}</td><td>${esc(i.student_name)}</td><td>${dShort(i.issue_date)}</td><td>${dShort(i.due_date)}</td><td>${money(i.total)}</td><td>${i.state === "void" ? "–" : money(i.balance)}</td><td>${pillFor(i.state)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="empty">${all.length ? "No invoices match." : "No invoices yet. Create one to bill a student for their sessions."}</p>`;
}
$("invFilter").onchange = renderInvoices;
$("invStudent").onchange = renderInvoices;
const openInvRow = (e) => { if (e.type === "keydown" && e.key !== "Enter") return; const r = e.target.closest("tr[data-id]"); if (r) openInvoice(r.dataset.id); };
$("invTable").addEventListener("click", openInvRow);
$("invTable").addEventListener("keydown", openInvRow);

// new invoice
const inDlg = $("invNewDialog"), inForm = $("invNewForm");
let newLines = []; // { sessionId?, occurrence?, description, quantity, unitPrice, include, custom? }
const newTotal = () => { $("invTotal").textContent = money(newLines.filter((l) => l.include).reduce((t, l) => t + l.quantity * Number(l.unitPrice || 0), 0)); };
function renderNewLines() {
  $("invLines").innerHTML = newLines.length
    ? newLines.map((l, i) => `<div class="lrow"><label class="chk"><input type="checkbox" data-line="${i}" ${l.include ? "checked" : ""}><span>${esc(l.description)}</span></label><input type="number" min="0" step="0.01" data-price="${i}" value="${l.unitPrice}" aria-label="Price">${l.custom ? `<button type="button" class="undo" data-rmline="${i}" aria-label="Remove line">&times;</button>` : ""}</div>`).join("")
    : '<p class="hint">Find sessions to bill, or add a custom line.</p>';
  newTotal();
}
function openNewInvoice(studentId) {
  inForm.reset();
  $("inStudent").innerHTML = '<option value="">Choose a student</option>' + listStudents().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  const now = new Date(), f = inForm.elements;
  f.student.value = studentId || "";
  f.from.value = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); f.to.value = ymd(now);
  f.issue.value = ymd(now); f.due.value = ymd(addDays(now, 14));
  newLines = []; renderNewLines(); $("invNewErr").textContent = "";
  inDlg.showModal();
}
$("newInvBtn").onclick = () => openNewInvoice();
$("invFind").onclick = () => {
  const f = inForm.elements, err = $("invNewErr");
  if (!f.student.value) { err.textContent = "Choose a student first."; return; }
  const { lines, unpriced } = billableLines(f.student.value, f.from.value, f.to.value, f.mode.value);
  newLines = [...lines.map((l) => ({ ...l, include: true })), ...newLines.filter((l) => l.custom)];
  err.textContent = unpriced ? `${unpriced} session${unpriced > 1 ? "s have" : " has"} no price, so ${unpriced > 1 ? "they were" : "it was"} left out. Set a price on the session to bill it.`
    : !lines.length ? "No billable sessions found in this period. Anything already invoiced is left out. You can still add a custom line." : "";
  renderNewLines();
};
$("custAdd").onclick = () => {
  const d = $("custDesc").value.trim(), a = Number($("custAmt").value);
  if (!d || !(a > 0)) { $("invNewErr").textContent = "A custom line needs a description and an amount."; return; }
  newLines.push({ description: d, quantity: 1, unitPrice: a, include: true, custom: true });
  $("custDesc").value = ""; $("custAmt").value = ""; $("invNewErr").textContent = ""; renderNewLines();
};
$("invLines").addEventListener("change", (e) => { const c = e.target.closest("[data-line]"); if (c) { newLines[c.dataset.line].include = c.checked; newTotal(); } });
$("invLines").addEventListener("input", (e) => { const p = e.target.closest("[data-price]"); if (p) { newLines[p.dataset.price].unitPrice = p.value; newTotal(); } });
$("invLines").addEventListener("click", (e) => { const r = e.target.closest("[data-rmline]"); if (r) { newLines.splice(Number(r.dataset.rmline), 1); renderNewLines(); } });
inForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = inForm.elements;
  try {
    const inv = await createInvoice({ studentId: f.student.value, issueDate: f.issue.value, dueDate: f.due.value, periodStart: f.from.value, periodEnd: f.to.value, notes: f.notes.value.trim(), lines: newLines.filter((l) => l.include) });
    inDlg.close(); afterMoney(); openInvoice(inv.id);
  } catch (err) { $("invNewErr").textContent = err.message; }
});
$("invNewCancel").onclick = () => inDlg.close();
inDlg.addEventListener("click", (e) => { if (e.target === inDlg) inDlg.close(); });

// invoice detail: payments, void, print
const invDlg = $("invDialog");
let curInv = null;
function openInvoice(id) { curInv = id; renderInvoiceDetail(); invDlg.showModal(); }
function renderInvoiceDetail() {
  const v = getInvoice(curInv);
  if (!v) { invDlg.close(); return; }
  const canPay = v.state !== "void" && v.balance > 0.004;
  $("invDetail").innerHTML = `<div class="occ">
    <h2>${esc(v.number)} ${pillFor(v.state)}</h2>
    <p class="hint">${esc(v.student_name)} · Issued ${dShort(v.issue_date)} · Due ${dShort(v.due_date)}${v.period_start ? ` · Covers ${dShort(v.period_start)} – ${dShort(v.period_end)}` : ""}</p>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>${v.items.map((l) => `<tr style="cursor:default"><td style="white-space:normal">${esc(l.description)}</td><td>${l.quantity}</td><td>${money(l.unit_price)}</td><td>${money(l.amount)}</td></tr>`).join("")}</tbody></table></div>
    <div class="totals"><span>Total</span><b>${money(v.total)}</b><span>Paid</span><b>${money(v.paid)}</b><span>Balance due</span><b>${money(v.balance)}</b></div>
    ${v.payments.length ? `<b>Payments</b><div class="card">${v.payments.map((p) => `<div class="row"><div>${money(p.amount)} · ${dShort(p.paid_on)}${p.method ? " · " + esc(p.method) : ""}${p.note ? `<br><span>${esc(p.note)}</span>` : ""}</div><button class="undo" data-delpay="${p.id}">Remove</button></div>`).join("")}</div>` : ""}
    ${canPay ? `<form id="payForm" class="payform"><input name="amount" type="number" min="0.01" step="0.01" required value="${v.balance.toFixed(2)}" aria-label="Amount paid"><input name="paidOn" type="date" required value="${ymd(new Date())}" aria-label="Date paid"><select name="method" aria-label="Method"><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Other</option></select><input name="note" placeholder="Note (optional)" maxlength="200" aria-label="Note"><button class="add" type="submit">Record payment</button></form>` : ""}
    ${v.notes ? `<p class="hint">Notes: ${esc(v.notes)}</p>` : ""}
    <p id="invErr" class="err" role="alert"></p>
    <div class="actions">${v.state !== "void" && !v.payments.length ? '<button type="button" id="invVoid" class="danger">Void invoice</button>' : ""}<button type="button" id="invPrint">Print / save as PDF</button><button type="button" id="invClose" class="add">Done</button></div>
  </div>`;
}
$("invDetail").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try { await addPayment(curInv, { amount: f.amount, paidOn: f.paidOn, method: f.method, note: f.note.trim() }); renderInvoiceDetail(); afterMoney(); }
  catch (err) { $("invErr").textContent = err.message; }
});
$("invDetail").addEventListener("click", async (e) => {
  const t = (sel) => e.target.closest(sel);
  try {
    if (t("#invClose")) return invDlg.close();
    if (t("#invPrint")) return printInvoice(curInv);
    if (t("[data-delpay]")) { if (!confirm("Remove this payment?")) return; await deletePayment(t("[data-delpay]").dataset.delpay); }
    else if (t("#invVoid")) { if (!confirm("Void this invoice? Its sessions can then be billed again.")) return; await voidInvoice(curInv); }
    else return;
    renderInvoiceDetail(); afterMoney();
  } catch (err) { const el = $("invErr"); if (el) el.textContent = err.message; }
});
invDlg.addEventListener("click", (e) => { if (e.target === invDlg) invDlg.close(); });

// Print / save as PDF: the browser's print dialog lets you choose "Save as PDF".
function printInvoice(id) {
  const v = getInvoice(id), o = getOrg(), gs = studentGuardians(v.student_id);
  const bill = [esc(v.student_name), ...gs.map((g) => esc(g.name) + (g.email ? " · " + esc(g.email) : ""))].join("<br>");
  $("printArea").innerHTML = `<div class="pi">
    <div class="pi-top"><div><h1>${esc(o.name)}</h1></div><div class="r"><h2>INVOICE</h2><div>${esc(v.number)}</div><div>Issued ${dShort(v.issue_date)}</div><div>Due ${dShort(v.due_date)}</div></div></div>
    <p><b>Bill to</b><br>${bill}</p>
    <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${v.items.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${money(l.unit_price)}</td><td class="r">${money(l.amount)}</td></tr>`).join("")}</tbody></table>
    <table class="pi-tot"><tr><td>Total</td><td class="r">${money(v.total)}</td></tr><tr><td>Paid</td><td class="r">${money(v.paid)}</td></tr><tr><td><b>Balance due</b></td><td class="r"><b>${money(v.balance)}</b></td></tr></table>
    ${v.state === "paid" ? '<p class="pi-paid">PAID IN FULL</p>' : ""}
    ${v.notes ? `<p>${esc(v.notes)}</p>` : ""}
    ${o.billing_details ? `<p><b>How to pay</b></p><div class="pre">${esc(o.billing_details)}</div>` : ""}
  </div>`;
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

// billing settings (owner)
const isDlg = $("invSettingsDialog"), isForm = $("invSettingsForm");
$("invSettingsBtn").onclick = () => {
  isForm.elements.currency.value = getOrg().currency || "GBP"; isForm.elements.details.value = getOrg().billing_details || "";
  $("invSetErr").textContent = ""; isDlg.showModal();
};
isForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await saveBilling({ currency: isForm.elements.currency.value, billingDetails: isForm.elements.details.value.trim() }); } catch (err) { $("invSetErr").textContent = err.message; return; }
  isDlg.close(); renderInvoices(); renderDash();
});
$("invSetCancel").onclick = () => isDlg.close();

// ---------- reports ----------
let rpTab = "staff", rpCsv = null;
const RP = {
  staff: ["Staff report", "A session counts as held once a student is marked present. Earned is the session price times the students present."],
  students: ["Student report", "Attendance only counts sessions that have already happened."],
  revenue: ["Revenue report", "Money invoiced and collected, month by month."],
};
function rpDates() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), today = new Date(y, m, now.getDate());
  const mon = addDays(today, -((today.getDay() + 6) % 7));
  switch ($("rpRange").value) {
    case "today": return [today, today];
    case "week": return [mon, addDays(mon, 6)];
    case "last30": return [addDays(today, -29), today];
    case "lastmonth": return [new Date(y, m - 1, 1), new Date(y, m, 0)];
    case "year": return [new Date(y, 0, 1), today];
    case "custom": { const a = $("rpFrom").value, b = $("rpTo").value; if (a && b && a <= b) return [parseYmd(a), parseYmd(b)]; }
    // an unfinished custom range falls back to this month
    default: return [new Date(y, m, 1), new Date(y, m + 1, 0)];
  }
}
const ratePill = (r) => (r == null ? "–" : `<span class="pill ${r >= 80 ? "active" : r >= 50 ? "warn" : "bad"}">${r}%</span>`);
const rpCard = (label, value) => `<div class="stat">${label}<b>${value}</b></div>`;

function csvDownload(name, matrix) {
  // a leading ' stops spreadsheets treating text like =SUM(...) as a formula
  const q = (v) => { v = String(v ?? ""); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([matrix.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// sessions per day (or per week for long ranges): held on the bottom, the rest stacked above
function stackedChart(series) {
  let cols = series.map((s) => ({ label: String(parseYmd(s.k).getDate()), title: dShort(s.k), sched: s.sched, held: s.held }));
  if (series.length > 31) {
    const w = new Map();
    for (const s of series) {
      const k = ymd(mondayOf(parseYmd(s.k))), c = w.get(k) || { label: dShort(k).replace(/ \d{4}$/, ""), title: "Week of " + dShort(k), sched: 0, held: 0 };
      c.sched += s.sched; c.held += s.held; w.set(k, c);
    }
    cols = [...w.values()];
  }
  const step = Math.ceil(cols.length / 14);
  cols.forEach((c, i) => { if (i % step) c.label = ""; });
  const max = Math.max(1, ...cols.map((c) => c.sched));
  return `<div class="chart">${cols.map((c) => `<div class="col2" title="${esc(c.title)}: ${c.held} held, ${c.sched} scheduled"><div class="stack"><i class="s" style="height:${(100 * (c.sched - c.held)) / max}%"></i><i class="h" style="height:${(100 * c.held) / max}%"></i></div><span>${esc(c.label)}</span></div>`).join("")}</div>
    <p class="hint legend"><b class="lg h"></b>Held <b class="lg s"></b>Scheduled, not held</p>`;
}

function staffView(from, to) {
  const { rows, series } = staffReport(ymd(from), ymd(to));
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0), slots = sum("slots");
  rows.sort((a, b) => b.hours - a.hours);
  rpCsv = { name: `staff-report-${ymd(from)}-to-${ymd(to)}.csv`, rows: [["Staff", "Scheduled", "Held", "Hours taught", "Students", "Attendance %", "Earned"],
    ...rows.map((r) => [staffName(r.staffId), r.scheduled, r.held, hrs(r.hours), r.students, r.rate ?? "", r.earned.toFixed(2)])] };
  $("rpBody").innerHTML = `<div class="stats four">${rpCard("Sessions scheduled", sum("scheduled"))}${rpCard("Sessions held", sum("held"))}${rpCard("Hours taught", hrs(sum("hours")))}${rpCard("Attendance", slots ? ratePill(Math.round((100 * sum("present")) / slots)) : "–")}</div>
    ${stackedChart(series)}
    ${rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Staff</th><th>Scheduled</th><th>Held</th><th>Hours taught</th><th>Students</th><th>Attendance</th><th>Earned</th></tr></thead><tbody>${rows.map((r) =>
      `<tr style="cursor:default"><td>${esc(staffName(r.staffId))}</td><td>${r.scheduled}</td><td>${r.held}</td><td>${hrs(r.hours)}</td><td>${r.students}</td><td>${ratePill(r.rate)}</td><td>${money(r.earned)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">No sessions in this period.</p>'}`;
}

function studentsView(from, to) {
  const { rows, outstanding } = studentReport(ymd(from), ymd(to)), sort = $("rpSort").value;
  rows.sort(sort === "rate" ? (a, b) => (a.rate ?? 101) - (b.rate ?? 101) : sort === "missed" ? (a, b) => b.missed - a.missed
    : sort === "owes" ? (a, b) => b.owes - a.owes : (a, b) => a.name.localeCompare(b.name));
  const past = rows.reduce((t, r) => t + r.past, 0), att = rows.reduce((t, r) => t + r.attended, 0);
  const none = rows.filter((r) => r.past > 0 && r.attended === 0).length;
  rpCsv = { name: `student-report-${ymd(from)}-to-${ymd(to)}.csv`, rows: [["Student", "Scheduled", "Attended", "Missed", "Attendance %", "Last attended", "Owes"],
    ...rows.map((r) => [r.name, r.scheduled, r.attended, r.missed, r.rate ?? "", r.last ?? "", r.owes.toFixed(2)])] };
  $("rpBody").innerHTML = `<div class="stats four">${rpCard("Students", rows.length)}${rpCard("Average attendance", past ? ratePill(Math.round((100 * att) / past)) : "–")}${rpCard("Not attended at all", none)}${rpCard("Outstanding", money(outstanding))}</div>
    ${rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Student</th><th>Scheduled</th><th>Attended</th><th>Missed</th><th>Attendance</th><th>Last attended</th><th>Owes</th></tr></thead><tbody>${rows.map((r) =>
      `<tr style="cursor:default"><td><button class="linkbtn" data-student="${r.id}">${esc(r.name)}</button></td><td>${r.scheduled}</td><td>${r.attended}</td><td>${r.missed}</td><td>${ratePill(r.rate)}</td><td>${r.last ? dShort(r.last) : "–"}</td><td>${r.owes ? money(r.owes) : "–"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="empty">No students yet.</p>'}`;
}

function revenueView() {
  const { rows, age } = revenueReport(12), t = invoiceTotals();
  const sumI = rows.reduce((a, r) => a + r.invoiced, 0), sumC = rows.reduce((a, r) => a + r.collected, 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiced, r.collected]));
  rpCsv = { name: "revenue-report.csv", rows: [["Month", "Invoiced", "Collected"], ...rows.map((r) => [r.label, r.invoiced.toFixed(2), r.collected.toFixed(2)])] };
  $("rpBody").innerHTML = `<div class="stats four">${rpCard("Invoiced, 12 months", money(sumI))}${rpCard("Collected, 12 months", money(sumC))}${rpCard("Outstanding now", money(t.outstanding))}${rpCard("Overdue now", money(t.overdue))}</div>
    <div class="chart chart2">${rows.map((r) => `<div class="col2" title="${esc(r.label)}: invoiced ${money(r.invoiced)}, collected ${money(r.collected)}"><div class="stack"><i class="h" style="height:${(100 * r.invoiced) / max}%"></i><i class="s2" style="height:${(100 * r.collected) / max}%"></i></div><span>${esc(r.label)}</span></div>`).join("")}</div>
    <p class="hint legend"><b class="lg h"></b>Invoiced <b class="lg s2"></b>Collected</p>
    <h2 class="sect">Unpaid balances by how late they are</h2>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Not yet due</th><th>1–30 days late</th><th>31–60 days late</th><th>Over 60 days late</th></tr></thead><tbody><tr style="cursor:default"><td>${money(age.current)}</td><td>${money(age.d30)}</td><td>${money(age.d60)}</td><td>${money(age.older)}</td></tr></tbody></table></div>
    <h2 class="sect">Month by month</h2>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Month</th><th>Invoiced</th><th>Collected</th></tr></thead><tbody>${[...rows].reverse().map((r) => `<tr style="cursor:default"><td>${esc(r.label)}</td><td>${money(r.invoiced)}</td><td>${money(r.collected)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderReports() {
  document.querySelectorAll("[data-rp]").forEach((b) => b.classList.toggle("on", b.dataset.rp === rpTab));
  const rev = rpTab === "revenue", custom = $("rpRange").value === "custom";
  $("rpRange").hidden = rev; $("rpFrom").hidden = rev || !custom; $("rpTo").hidden = rev || !custom; $("rpSort").hidden = rpTab !== "students";
  $("rpTitle").textContent = RP[rpTab][0];
  const [from, to] = rpDates();
  $("rpHint").textContent = (rev ? "" : `${dShort(ymd(from))} – ${dShort(ymd(to))}. `) + RP[rpTab][1];
  ({ staff: staffView, students: studentsView, revenue: revenueView })[rpTab](from, to);
}
document.querySelectorAll("[data-rp]").forEach((b) => (b.onclick = () => { rpTab = b.dataset.rp; renderReports(); }));
["rpRange", "rpFrom", "rpTo", "rpSort"].forEach((id) => ($(id).onchange = renderReports));
$("rpCsv").onclick = () => rpCsv && csvDownload(rpCsv.name, rpCsv.rows);
$("rpBody").addEventListener("click", (e) => {
  const l = e.target.closest("[data-student]");
  if (l) { studentOpenId = l.dataset.student; peopleTab = "students"; show("people"); }
});
{ const n = new Date(); $("rpFrom").value = ymd(new Date(n.getFullYear(), n.getMonth(), 1)); $("rpTo").value = ymd(n); }

// ---------- resources (files) ----------
const fmtSize = (b) => (b < 1024 ? b + " B" : b < 1048576 ? Math.round(b / 1024) + " KB" : (b / 1048576).toFixed(1) + " MB");
const kindOf = (m = "") => (m.startsWith("image/") ? "img" : m.includes("pdf") ? "pdf" : m.includes("word") ? "doc" : /sheet|excel|csv/.test(m) ? "xls"
  : /presentation|powerpoint/.test(m) ? "ppt" : /^(audio|video)\//.test(m) ? "av" : "other");
const parseTags = (txt) => { // keeps the first spelling of each tag, ignoring repeats like "Maths, maths"
  const seen = new Map();
  for (const t of txt.split(",").map((x) => x.trim().slice(0, 30))) if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].slice(0, 10);
};
const findRes = (id) => listResources().find((r) => r.id === id);
const canManageRes = (r) => isAdmin() || r.uploaded_by === getMe().id;
let resUrls = {}, resRender = 0; // resUrls: file path -> temporary picture link for thumbnails

const resCard = (r) => {
  const kind = kindOf(r.mime), stu = r.student_id ? getStudent(r.student_id)?.name : "";
  const thumb = kind === "img" && resUrls[r.path] ? `<img src="${esc(resUrls[r.path])}" alt="" loading="lazy">` : `<span>${esc((r.name.split(".").pop() || "file").toUpperCase().slice(0, 4))}</span>`;
  return `<div class="fcard"><div class="thumb ft-${kind}"${kind === "img" ? ` data-path="${esc(r.path)}"` : ""}>${thumb}</div>
    <div class="fmeta"><b title="${esc(r.name)}">${esc(r.name)}</b><span>${fmtSize(r.size)} · ${dShort(r.created_at.slice(0, 10))}${stu ? " · " + esc(stu) : ""}</span>${r.tags.length ? `<span>${r.tags.map((t) => `<span class="pill2">${esc(t)}</span>`).join("")}</span>` : ""}</div>
    <div class="fact"><button class="undo" data-ropen="${r.id}">Open</button><button class="undo" data-rlink="${r.id}">Copy link</button><button class="undo" data-redit="${r.id}">${canManageRes(r) ? "Edit" : "Details"}</button></div></div>`;
};

async function renderResources() {
  const all = listResources(), q = $("resSearch").value.trim().toLowerCase();
  const keepTag = $("resTag").value || "all", keepStu = $("resStudent").value || "all";
  $("resTag").innerHTML = '<option value="all">All tags</option>' + [...new Set(all.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b)).map((t) => `<option>${esc(t)}</option>`).join("");
  $("resTag").value = keepTag;
  $("resStudent").innerHTML = '<option value="all">All students</option>' + listStudents().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  $("resStudent").value = keepStu;
  const tag = $("resTag").value || "all", sf = $("resStudent").value || "all", sort = $("resSort").value;
  const rows = all.filter((r) => (tag === "all" || r.tags.includes(tag)) && (sf === "all" || r.student_id === sf) && (!q || `${r.name} ${r.tags.join(" ")}`.toLowerCase().includes(q)));
  rows.sort(sort === "old" ? (a, b) => a.created_at.localeCompare(b.created_at) : sort === "name" ? (a, b) => a.name.localeCompare(b.name)
    : sort === "big" ? (a, b) => b.size - a.size : (a, b) => b.created_at.localeCompare(a.created_at));
  const mine = ++resRender;
  $("resGrid").innerHTML = rows.length ? rows.map(resCard).join("") : `<p class="empty">${all.length ? "No files match." : "No files yet. Upload worksheets, past papers or anything you want to share."}</p>`;
  const need = rows.filter((r) => kindOf(r.mime) === "img" && !resUrls[r.path]).map((r) => r.path);
  if (need.length) { try { Object.assign(resUrls, await resourceUrls(need, 3600)); } catch { return; } }
  if (mine !== resRender) return; // a newer draw replaced this one
  $("resGrid").querySelectorAll(".thumb[data-path]").forEach((t) => { const u = resUrls[t.dataset.path]; if (u && !t.querySelector("img")) t.innerHTML = `<img src="${esc(u)}" alt="" loading="lazy">`; });
}
["resSearch", "resTag", "resStudent", "resSort"].forEach((id) => ($(id).oninput = renderResources));

// shown on a student's page
const resSection = (st) => {
  const list = studentResources(st.id);
  return `<h2 class="sect">Files <button class="undo" id="spUpload">Upload</button></h2>` + (list.length
    ? `<div class="card">${list.map((r) => `<div class="row"><div>${esc(r.name)}<br><span>${fmtSize(r.size)} · ${dShort(r.created_at.slice(0, 10))}</span></div><button class="undo" data-ropen="${r.id}">Open</button></div>`).join("")}</div>`
    : '<p class="hint">No files attached yet.</p>');
};

// Open / Copy link / Edit, from the grid and from a student's page
const resAction = async (e) => {
  const o = e.target.closest("[data-ropen]"), l = e.target.closest("[data-rlink]"), ed = e.target.closest("[data-redit]");
  if (!o && !l && !ed) return;
  try {
    if (o) {
      const w = window.open("about:blank", "_blank"); // opened first so pop-up blockers allow it
      try { const url = await resourceLink(findRes(o.dataset.ropen).path, 120); if (w) { w.opener = null; w.location.href = url; } else alert("Allow pop-ups to open files."); }
      catch (err) { if (w) w.close(); throw err; }
    } else if (l) {
      const url = await resourceLink(findRes(l.dataset.rlink).path, 7 * 86400);
      try { await navigator.clipboard.writeText(url); const t = l.textContent; l.textContent = "Copied!"; setTimeout(() => { l.textContent = t; }, 1500); }
      catch { prompt("Copy this link (it works for 7 days):", url); }
    } else openResEdit(ed.dataset.redit);
  } catch (err) { alert(err.message); }
};
$("resGrid").addEventListener("click", resAction);
$("studentPage").addEventListener("click", resAction);

// edit / delete
const rDlg = $("resDialog"), rForm = $("resForm");
function openResEdit(id) {
  const r = findRes(id), can = canManageRes(r);
  rForm.reset();
  rForm.elements.id.value = id; rForm.elements.name.value = r.name; rForm.elements.tags.value = r.tags.join(", ");
  $("resEditStudent").innerHTML = '<option value="">Not attached to a student</option>' + listStudents().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  rForm.elements.student.value = r.student_id || "";
  rForm.querySelectorAll("input:not([type=hidden]),select").forEach((i) => { i.disabled = !can; });
  $("resSave").hidden = !can; $("resDelete").hidden = !can;
  $("resEditErr").textContent = can ? "" : "Only the person who uploaded this file, or an admin, can change it.";
  rDlg.showModal();
}
rForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = rForm.elements;
  try { await updateResource(f.id.value, { name: f.name.value.trim(), tags: parseTags(f.tags.value), studentId: f.student.value }); }
  catch (err) { $("resEditErr").textContent = err.message; return; }
  rDlg.close(); renderResources(); if (studentOpenId) renderPeople();
});
$("resDelete").onclick = async () => {
  if (!confirm("Delete this file? Any links you shared will stop working.")) return;
  try { await deleteResource(rForm.elements.id.value); } catch (err) { $("resEditErr").textContent = err.message; return; }
  rDlg.close(); renderResources(); if (studentOpenId) renderPeople();
};
$("resCancel").onclick = () => rDlg.close();
rDlg.addEventListener("click", (e) => { if (e.target === rDlg) rDlg.close(); });

// upload
const ruDlg = $("resUpDialog"), ruForm = $("resUpForm");
$("resFile").accept = RES_ACCEPT;
function openUpload(studentId, keepFiles) {
  if (!keepFiles) ruForm.reset();
  $("resUpStudent").innerHTML = '<option value="">No student</option>' + listStudents().map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  $("resUpStudent").value = studentId || "";
  $("resUpErr").textContent = ""; $("resUpErr").className = "err";
  showPicked();
  ruDlg.showModal();
}
function showPicked() {
  const f = [...$("resFile").files];
  $("resPicked").textContent = f.length ? f.map((x) => x.name).join(", ") : "PDF, images, Word, Excel, PowerPoint, text, CSV, MP3 or MP4, up to 20 MB each";
}
$("resFile").onchange = showPicked;
$("resNewBtn").onclick = () => openUpload();
ruForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const files = [...$("resFile").files], err = $("resUpErr");
  if (!files.length) { err.className = "err"; err.textContent = "Choose at least one file."; return; }
  const tags = parseTags($("resUpTags").value), studentId = $("resUpStudent").value || null, failed = [];
  $("resUpGo").disabled = true;
  for (const [i, f] of files.entries()) {
    err.className = "hint"; err.textContent = `Uploading ${i + 1} of ${files.length}: ${f.name}…`;
    try { await uploadResource(f, { studentId, tags }); } catch (x) { failed.push(`${f.name}: ${x.message}`); }
  }
  $("resUpGo").disabled = false;
  renderResources(); if (studentOpenId) renderPeople();
  if (failed.length) { err.className = "err"; err.textContent = failed.join(" · "); } else ruDlg.close();
});
$("resUpCancel").onclick = () => ruDlg.close();
ruDlg.addEventListener("click", (e) => { if (e.target === ruDlg) ruDlg.close(); });
// drop files anywhere on the Files page
const resPane = $("resPane");
resPane.addEventListener("dragover", (e) => { e.preventDefault(); resPane.classList.add("dragging"); });
resPane.addEventListener("dragleave", (e) => { if (e.target === resPane) resPane.classList.remove("dragging"); });
resPane.addEventListener("drop", (e) => {
  e.preventDefault(); resPane.classList.remove("dragging");
  if (!e.dataTransfer?.files?.length) return;
  $("resFile").files = e.dataTransfer.files;
  openUpload(null, true);
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
  document.querySelector(".side [data-go=invoices]").hidden = !isAdmin();
  document.querySelector(".side [data-go=reports]").hidden = !isAdmin();
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
  const sum = (rows) => ({ c: rows.length, st: new Set(rows.flatMap((r) => r.studentIds)).size, h: rows.reduce((t, r) => t + r.hours, 0) });
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
  $("whoName").textContent = name; $("barName").textContent = name; $("helloName").textContent = name; $("whoAv").textContent = initials(name);
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
    $("whoName").textContent = name; $("barName").textContent = name; $("helloName").textContent = name; $("whoAv").textContent = initials(name);
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
