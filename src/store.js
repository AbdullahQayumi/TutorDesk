// Data layer. The screens only talk to the functions exported here.
// Everything is loaded once into memory (loadAll), reads are instant, and every change
// is written to Supabase first, then reflected in memory.
import { supabase } from "./supabase.js";

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const pad = (n) => String(n).padStart(2, "0");

let sessions = [];   // { id, title, staffId, studentIds[], date, dow, start, end, repeat }
let attendance = []; // { session_id, student_id, occurrence, marked_at }: one row per student who was present
let attIdx = new Map(); // "sessionId|date" -> Set(studentId), rebuilt from `attendance`
let students = [];   // { id, name, email, phone, status, created_at }
let org = null, myRole = null, myId = null; // the workspace being viewed, and who I am in it
let orgs = [], members = [], invites = [];
let settings = {}, leaves = []; // settings: userId -> { workingHours, takesClasses }
let batches = [], batchLinks = [], guardians = [], guardianLinks = [];

const fail = (error) => { if (error) throw new Error(error.message); };
const studentName = (id) => students.find((x) => x.id === id)?.name;
const attKey = (sid, occ) => `${sid}|${occ}`;
function reindexAtt() {
  attIdx = new Map();
  for (const a of attendance) {
    const k = attKey(a.session_id, a.occurrence);
    if (!attIdx.has(k)) attIdx.set(k, new Set());
    attIdx.get(k).add(a.student_id);
  }
}

// Database column names <-> app field names (Postgres returns time as "18:00:00")
const fromRow = (r) => ({ id: r.id, title: r.title, staffId: r.tutor_id, studentIds: [], date: r.session_date,
  dow: parseYmd(r.session_date).getDay(), start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), repeat: r.recurrence });
const labelOf = (ids) => {
  const names = ids.map(studentName).filter(Boolean);
  return (!names.length ? "No students" : names.length <= 2 ? names.join(", ") : `${names[0]} +${names.length - 1}`).slice(0, 80);
};
const toRow = (s, ids) => ({ title: s.title, student: labelOf(ids), tutor_id: s.staffId, session_date: s.date,
  start_time: s.start, end_time: s.end, recurrence: s.repeat });

export async function loadAll(userId, preferredOrg) {
  myId = userId;
  await supabase.rpc("accept_invites"); // joins any team this email was invited to (errors are ignored)
  const mine = await supabase.from("memberships").select("role, organisations(id, name, type)").eq("user_id", userId).order("created_at");
  fail(mine.error);
  orgs = mine.data.map((m) => ({ ...m.organisations, role: m.role }));
  if (!orgs.length) throw new Error("No workspace found for this account.");
  org = orgs.find((o) => o.id === preferredOrg) || orgs[0];
  myRole = org.role;
  const q = (t, cols = "*") => supabase.from(t).select(cols).eq("org_id", org.id);
  const [a, b, c, d, e, f, g, bt, bl, gd, gl, ss] = await Promise.all([
    q("sessions"),
    q("attendance", "session_id, student_id, occurrence, marked_at").order("marked_at", { ascending: false }),
    q("students"),
    supabase.from("memberships").select("user_id, role, profiles(full_name, email, phone)").eq("org_id", org.id),
    isAdmin() ? q("invites") : { data: [], error: null },
    q("member_settings"),
    q("leaves"),
    q("batches"),
    q("batch_students", "batch_id, student_id"),
    q("guardians"),
    q("student_guardians", "student_id, guardian_id"),
    q("session_students", "session_id, student_id"),
  ]);
  for (const r of [a, b, c, d, e, f, g, bt, bl, gd, gl, ss]) fail(r.error);
  members = d.data.map((m) => ({ userId: m.user_id, role: m.role, email: m.profiles?.email || "", phone: m.profiles?.phone || "",
    name: m.profiles?.full_name || m.profiles?.email || "Unnamed" }));
  invites = e.data;
  settings = Object.fromEntries(f.data.map((r) => [r.user_id, { workingHours: r.working_hours, takesClasses: r.takes_classes }]));
  leaves = g.data;
  batches = bt.data; batchLinks = bl.data; guardians = gd.data; guardianLinks = gl.data;
  students = c.data;
  const roster = new Map();
  for (const l of ss.data) { if (!roster.has(l.session_id)) roster.set(l.session_id, []); roster.get(l.session_id).push(l.student_id); }
  sessions = a.data.map((r) => ({ ...fromRow(r), studentIds: roster.get(r.id) || [] }));
  attendance = b.data;
  reindexAtt();
}
export function clearAll() {
  sessions = []; attendance = []; attIdx = new Map(); students = []; org = null; orgs = []; members = []; invites = [];
  settings = {}; leaves = []; batches = []; batchLinks = []; guardians = []; guardianLinks = [];
}

export async function getProfile(userId) {
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data;
}

// ---------- sessions ----------
export function studentLabel(s) {
  const names = (s.studentIds || []).map(studentName).filter(Boolean);
  return !names.length ? "No students" : names.length <= 2 ? names.join(", ") : `${names[0]}, ${names[1]} +${names.length - 2}`;
}

// One session on one date, with who was present.
function occurrence(s, key) {
  const have = attIdx.get(attKey(s.id, key));
  const present = have ? s.studentIds.filter((id) => have.has(id)) : [];
  return { ...s, occurrence: key, present, presentCount: present.length, total: s.studentIds.length,
    marked: s.studentIds.length > 0 && present.length === s.studentIds.length };
}

// Every session that happens on a given calendar day (handles weekly repeats).
export function sessionsOn(date) {
  const key = ymd(date), dow = date.getDay();
  return sessions
    .filter((s) => s.date === key || (s.repeat === "weekly" && s.date < key && s.dow === dow))
    .map((s) => occurrence(s, key))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const getSession = (id) => sessions.find((s) => s.id === id);

export async function saveSession(data) {
  const ids = [...new Set(data.studentIds || [])];
  const editing = !!data.id;
  const res = editing
    ? await supabase.from("sessions").update(toRow(data, ids)).eq("id", data.id).select().single()
    : await supabase.from("sessions").insert({ ...toRow(data, ids), org_id: org.id }).select().single();
  fail(res.error);
  const row = res.data;
  const cur = editing ? getSession(data.id).studentIds : [];
  const add = ids.filter((x) => !cur.includes(x)), del = cur.filter((x) => !ids.includes(x));
  try {
    if (del.length) { const r = await supabase.from("session_students").delete().eq("session_id", row.id).in("student_id", del); fail(r.error); }
    if (add.length) { const r = await supabase.from("session_students").insert(add.map((x) => ({ session_id: row.id, student_id: x, org_id: org.id }))); fail(r.error); }
  } catch (err) {
    if (!editing) await supabase.from("sessions").delete().eq("id", row.id); // don't leave a half-saved session behind
    throw err;
  }
  const s = { ...fromRow(row), studentIds: ids };
  const i = sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) sessions[i] = s; else sessions.push(s);
}

export async function deleteSession(id) {
  const { error } = await supabase.from("sessions").delete().eq("id", id); // students and attendance go with it
  fail(error);
  sessions = sessions.filter((s) => s.id !== id);
  attendance = attendance.filter((a) => a.session_id !== id);
  reindexAtt();
}

// ---------- attendance (per student, per date) ----------
export async function markAttendance(sessionId, occurrenceDate, studentId) {
  const s = getSession(sessionId);
  if (!s || !s.studentIds.includes(studentId) || attIdx.get(attKey(sessionId, occurrenceDate))?.has(studentId)) return;
  const { error } = await supabase.from("attendance").insert({ session_id: sessionId, org_id: org.id, occurrence: occurrenceDate, student_id: studentId });
  fail(error);
  attendance.push({ session_id: sessionId, student_id: studentId, occurrence: occurrenceDate, marked_at: new Date().toISOString() });
  reindexAtt();
}
export async function markAllAttendance(sessionId, occurrenceDate) {
  const s = getSession(sessionId);
  if (!s) return;
  const have = attIdx.get(attKey(sessionId, occurrenceDate)) || new Set();
  const todo = s.studentIds.filter((id) => !have.has(id));
  if (!todo.length) return;
  const { error } = await supabase.from("attendance").insert(todo.map((id) => ({ session_id: sessionId, org_id: org.id, occurrence: occurrenceDate, student_id: id })));
  fail(error);
  const at = new Date().toISOString();
  todo.forEach((id) => attendance.push({ session_id: sessionId, student_id: id, occurrence: occurrenceDate, marked_at: at }));
  reindexAtt();
}
export async function unmarkAttendance(sessionId, occurrenceDate, studentId) {
  const { error } = await supabase.from("attendance").delete()
    .eq("session_id", sessionId).eq("occurrence", occurrenceDate).eq("student_id", studentId);
  fail(error);
  attendance = attendance.filter((a) => !(a.session_id === sessionId && a.occurrence === occurrenceDate && a.student_id === studentId));
  reindexAtt();
}

const nowParts = () => { const n = new Date(); return { todayK: ymd(n), nowT: `${pad(n.getHours())}:${pad(n.getMinutes())}` }; };
const isPast = (o, t) => o.occurrence < t.todayK || (o.occurrence === t.todayK && o.end <= t.nowT);

export function recentOccurrences(limit) {
  const t = nowParts(), out = [], d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 120 && out.length < limit; i++, d.setDate(d.getDate() - 1)) {
    out.push(...sessionsOn(d).filter(canEditSession).filter((o) => isPast(o, t)).sort((a, b) => b.start.localeCompare(a.start)));
  }
  return out.slice(0, limit);
}
export const todayOccurrences = () => sessionsOn(new Date());

// Grouped by session and date, so a class of 20 is one line, not twenty.
export function getTimeline() {
  const groups = new Map();
  for (const a of attendance) {
    const k = attKey(a.session_id, a.occurrence);
    const g = groups.get(k) || { sessionId: a.session_id, occurrence: a.occurrence, count: 0, at: 0 };
    g.count++; g.at = Math.max(g.at, new Date(a.marked_at).getTime());
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => { const s = getSession(g.sessionId); return s ? { title: s.title, occurrence: g.occurrence, at: g.at, count: g.count, total: s.studentIds.length } : null; })
    .filter(Boolean).sort((a, b) => b.at - a.at).slice(0, 30);
}

function attendanceRate(days) {
  const t = nowParts(), d = new Date(); d.setHours(0, 0, 0, 0);
  let total = 0, present = 0;
  for (let i = 0; i < days; i++, d.setDate(d.getDate() - 1)) {
    for (const o of sessionsOn(d)) if (isPast(o, t)) { total += o.total; present += o.presentCount; }
  }
  return total ? Math.round((100 * present) / total) : null;
}
export function stats() {
  const n = new Date(), mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7));
  let week = 0;
  for (let i = 0; i < 7; i++) week += sessionsOn(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)).length;
  return { classes: sessions.length, students: students.filter((s) => s.status === "active").length, week, rate: attendanceRate(30) };
}

// Scheduled sessions in one month (month is 0-11): total, distinct students, and per class title.
export function monthStats(year, month) {
  const byTitle = {}, ids = new Set();
  let classes = 0;
  for (const d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
    for (const s of sessionsOn(d)) {
      classes++;
      byTitle[s.title] = (byTitle[s.title] || 0) + 1;
      s.studentIds.forEach((id) => ids.add(id));
    }
  }
  return { classes, students: ids.size, byTitle };
}

// ---------- students ----------
export const listStudents = () => [...students].sort((a, b) => a.name.localeCompare(b.name));
export const getStudent = (id) => students.find((s) => s.id === id);

export async function saveStudent(d) {
  const row = { name: d.name, email: d.email || null, phone: d.phone || null, status: d.status || "active" };
  if (d.id) {
    const { data, error } = await supabase.from("students").update(row).eq("id", d.id).select().single();
    fail(error);
    Object.assign(getStudent(d.id), data);
    return getStudent(d.id);
  }
  const { data, error } = await supabase.from("students").insert({ ...row, org_id: org.id }).select().single();
  fail(error);
  students.push(data);
  return data;
}

export async function deleteStudent(id) {
  const { error } = await supabase.from("students").delete().eq("id", id);
  fail(error);
  students = students.filter((s) => s.id !== id);
  sessions.forEach((s) => { s.studentIds = s.studentIds.filter((x) => x !== id); });
  attendance = attendance.filter((a) => a.student_id !== id); reindexAtt();
  batchLinks = batchLinks.filter((l) => l.student_id !== id);
  guardianLinks = guardianLinks.filter((l) => l.student_id !== id);
}

// ---------- workspace / team ----------
export const getOrg = () => org;
export const getOrgs = () => orgs;
export const getMe = () => ({ id: myId, role: myRole });
export const isAdmin = () => myRole === "owner" || myRole === "admin";
export const canEditSession = (s) => isAdmin() || s.staffId === myId; // admins manage all; staff manage their own
export const getMembers = () => members;
export const getInvites = () => invites;
export const staffName = (id) => members.find((m) => m.userId === id)?.name ?? "Former staff";

export async function inviteMember(email, role) {
  email = email.trim().toLowerCase();
  if (members.some((m) => m.email.toLowerCase() === email)) throw new Error("That person is already on your team.");
  const { data, error } = await supabase.from("invites").insert({ org_id: org.id, email, role }).select().single();
  fail(error);
  invites.push(data);
}
export async function revokeInvite(id) {
  const { error } = await supabase.from("invites").delete().eq("id", id);
  fail(error);
  invites = invites.filter((i) => i.id !== id);
}
export async function setRole(userId, role) {
  const { error } = await supabase.from("memberships").update({ role }).eq("org_id", org.id).eq("user_id", userId);
  fail(error);
  members.find((m) => m.userId === userId).role = role;
}
export async function removeMember(userId) {
  // hand their sessions to you first, so nothing is left without an owner
  let r = await supabase.from("sessions").update({ tutor_id: myId }).eq("org_id", org.id).eq("tutor_id", userId);
  fail(r.error);
  r = await supabase.from("memberships").delete().eq("org_id", org.id).eq("user_id", userId);
  fail(r.error);
  members = members.filter((m) => m.userId !== userId);
  sessions.forEach((s) => { if (s.staffId === userId) s.staffId = myId; });
}
export async function convertToBusiness(name) {
  const { data, error } = await supabase.from("organisations").update({ type: "business", name }).eq("id", org.id).select().single();
  fail(error);
  org.type = data.type; org.name = data.name;
}

// ---------- profile: working hours, leaves, timesheet ----------
const DEFAULT_HOURS = () => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ["11:00", "19:00"]]));
export const getHours = (userId) => settings[userId]?.workingHours ?? DEFAULT_HOURS(); // weekday (0=Sun) -> ["09:00","17:00"]; missing = closed
export const takesClasses = (userId) => settings[userId]?.takesClasses ?? true;

export async function saveSettings(userId, patch) {
  const next = { workingHours: null, takesClasses: true, ...settings[userId], ...patch };
  const { error } = await supabase.from("member_settings").upsert(
    { org_id: org.id, user_id: userId, working_hours: next.workingHours, takes_classes: next.takesClasses, updated_at: new Date().toISOString() },
    { onConflict: "org_id,user_id" });
  fail(error);
  settings[userId] = next;
}

export const getLeaves = (userId) => leaves.filter((l) => l.user_id === userId);
export const onLeave = (userId, k) => leaves.some((l) => l.user_id === userId && l.start_date <= k && k <= l.end_date);
export async function addLeave(userId, from, to, reason) {
  const { data, error } = await supabase.from("leaves")
    .insert({ org_id: org.id, user_id: userId, start_date: from, end_date: to, reason: reason || null }).select().single();
  fail(error);
  leaves.push(data);
}
export async function deleteLeave(id) {
  const { error } = await supabase.from("leaves").delete().eq("id", id);
  fail(error);
  leaves = leaves.filter((l) => l.id !== id);
}

export async function saveProfile({ fullName, phone }) {
  const { data, error } = await supabase.from("profiles").update({ full_name: fullName, phone: phone || null }).eq("id", myId).select().single();
  fail(error);
  const m = members.find((x) => x.userId === myId);
  if (m) { m.name = data.full_name || m.email; m.phone = data.phone || ""; }
}

const hoursBetween = (a, b) => { const h = (t) => { const [x, y] = t.split(":").map(Number); return x + y / 60; }; return h(b) - h(a); };
// One person's sessions between two dates (YYYY-MM-DD). `marked` means at least one student was marked present.
export function timesheet(userId, fromYmd, toYmd) {
  const rows = [], d = parseYmd(fromYmd), end = parseYmd(toYmd);
  for (let i = 0; d <= end && i < 800; i++, d.setDate(d.getDate() + 1)) {
    for (const s of sessionsOn(d)) {
      if (s.staffId === userId) rows.push({ date: ymd(d), title: s.title, student: studentLabel(s), studentIds: s.studentIds, start: s.start, end: s.end, hours: hoursBetween(s.start, s.end), marked: s.presentCount > 0 });
    }
  }
  return rows;
}

// ---------- batches & guardians ----------
const byName = (a, b) => a.name.localeCompare(b.name);
export const listBatches = () => [...batches].sort(byName);
export const getBatch = (id) => batches.find((b) => b.id === id);
export const batchStudentIds = (id) => batchLinks.filter((l) => l.batch_id === id).map((l) => l.student_id);
export const studentBatches = (studentId) => batchLinks.filter((l) => l.student_id === studentId).map((l) => getBatch(l.batch_id)).filter(Boolean);
export const listGuardians = () => [...guardians].sort(byName);
export const getGuardian = (id) => guardians.find((g) => g.id === id);
export const guardianStudentIds = (id) => guardianLinks.filter((l) => l.guardian_id === id).map((l) => l.student_id);
export const studentGuardians = (studentId) => guardianLinks.filter((l) => l.student_id === studentId).map((l) => getGuardian(l.guardian_id)).filter(Boolean);

// Make the links for one batch/guardian match the wanted list: delete the removed ones, insert the new ones.
async function syncLinks(table, ownCol, ownId, otherCol, wanted, links) {
  const have = links.filter((l) => l[ownCol] === ownId).map((l) => l[otherCol]);
  const add = wanted.filter((x) => !have.includes(x)), del = have.filter((x) => !wanted.includes(x));
  if (del.length) { const { error } = await supabase.from(table).delete().eq(ownCol, ownId).in(otherCol, del); fail(error); }
  if (add.length) { const { error } = await supabase.from(table).insert(add.map((x) => ({ [ownCol]: ownId, [otherCol]: x, org_id: org.id }))); fail(error); }
  return links.filter((l) => !(l[ownCol] === ownId && del.includes(l[otherCol]))).concat(add.map((x) => ({ [ownCol]: ownId, [otherCol]: x })));
}

export async function saveBatch({ id, name, description, studentIds }) {
  const row = { name, description: description || null };
  let b;
  if (id) {
    const { data, error } = await supabase.from("batches").update(row).eq("id", id).select().single();
    fail(error); b = Object.assign(getBatch(id), data);
  } else {
    const { data, error } = await supabase.from("batches").insert({ ...row, org_id: org.id }).select().single();
    fail(error); batches.push(data); b = data;
  }
  batchLinks = await syncLinks("batch_students", "batch_id", b.id, "student_id", studentIds, batchLinks);
  return b;
}
export async function deleteBatch(id) {
  const { error } = await supabase.from("batches").delete().eq("id", id);
  fail(error);
  batches = batches.filter((b) => b.id !== id);
  batchLinks = batchLinks.filter((l) => l.batch_id !== id);
}

export async function saveGuardian({ id, name, email, phone, relationship, studentIds }) {
  const row = { name, email: email || null, phone: phone || null, relationship: relationship || null };
  let g;
  if (id) {
    const { data, error } = await supabase.from("guardians").update(row).eq("id", id).select().single();
    fail(error); g = Object.assign(getGuardian(id), data);
  } else {
    const { data, error } = await supabase.from("guardians").insert({ ...row, org_id: org.id }).select().single();
    fail(error); guardians.push(data); g = data;
  }
  guardianLinks = await syncLinks("student_guardians", "guardian_id", g.id, "student_id", studentIds, guardianLinks);
  return g;
}
export async function deleteGuardian(id) {
  const { error } = await supabase.from("guardians").delete().eq("id", id);
  fail(error);
  guardians = guardians.filter((g) => g.id !== id);
  guardianLinks = guardianLinks.filter((l) => l.guardian_id !== id);
}

// A student's past sessions (with whether they were marked present) and their next four weeks.
export function studentHistory(studentId) {
  const t = nowParts(), horizon = new Date(); horizon.setDate(horizon.getDate() + 28);
  const upTo = ymd(horizon), past = [], upcoming = [];
  for (const s of sessions) {
    if (!s.studentIds.includes(studentId)) continue;
    const dates = [];
    if (s.repeat === "weekly") { for (let d = parseYmd(s.date), i = 0; i < 520 && ymd(d) <= upTo; i++, d.setDate(d.getDate() + 7)) dates.push(ymd(d)); }
    else if (s.date <= upTo) dates.push(s.date);
    for (const date of dates) {
      const row = { date, occurrence: date, id: s.id, title: s.title, start: s.start, end: s.end, staffId: s.staffId, marked: !!attIdx.get(attKey(s.id, date))?.has(studentId) };
      (isPast(row, t) ? past : upcoming).push(row);
    }
  }
  past.sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return { past, upcoming };
}
