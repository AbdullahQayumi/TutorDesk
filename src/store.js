// Data layer. The screens only talk to the functions exported here.
// Data is loaded once into memory (loadAll), reads are instant, and every change
// is written to Supabase first, then reflected in memory.
import { supabase } from "./supabase.js";

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

let sessions = []; // { id, title, student, date, start, end, repeat, marked: ["YYYY-MM-DD", ...] }
let timeline = []; // newest first
let students = []; // { id, name, email, phone, status, created_at }
let org = null, myRole = null, myId = null; // the workspace being viewed, and who I am in it
let orgs = [], members = [], invites = [];

const fail = (error) => { if (error) throw new Error(error.message); };
// Database column names <-> app field names (Postgres returns time as "18:00:00")
const fromRow = (r) => ({ id: r.id, title: r.title, staffId: r.tutor_id, studentId: r.student_id ?? null,
  student: students.find((x) => x.id === r.student_id)?.name ?? r.student, date: r.session_date,
  start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), repeat: r.recurrence, marked: [] });
const toRow = (s) => ({ title: s.title, student: s.student, student_id: s.studentId ?? null, tutor_id: s.staffId, session_date: s.date,
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
  const [a, b, c, d, e] = await Promise.all([
    supabase.from("sessions").select("*").eq("org_id", org.id),
    supabase.from("attendance").select("session_id, occurrence, marked_at").eq("org_id", org.id).order("marked_at", { ascending: false }),
    supabase.from("students").select("*").eq("org_id", org.id),
    supabase.from("memberships").select("user_id, role, profiles(full_name, email)").eq("org_id", org.id),
    isAdmin() ? supabase.from("invites").select("*").eq("org_id", org.id) : { data: [], error: null },
  ]);
  fail(a.error); fail(b.error); fail(c.error); fail(d.error); fail(e.error);
  members = d.data.map((m) => ({ userId: m.user_id, role: m.role, email: m.profiles?.email || "",
    name: m.profiles?.full_name || m.profiles?.email || "Unnamed" }));
  invites = e.data;
  students = c.data;
  sessions = a.data.map(fromRow);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  timeline = [];
  for (const m of b.data) {
    const s = byId.get(m.session_id);
    if (!s) continue;
    s.marked.push(m.occurrence);
    timeline.push({ sessionId: s.id, title: s.title, occurrence: m.occurrence, at: new Date(m.marked_at).getTime() });
  }
}
export function clearAll() { sessions = []; timeline = []; students = []; org = null; orgs = []; members = []; invites = []; }

export async function getProfile(userId) {
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data;
}

// Every session that happens on a given calendar day (handles weekly repeats).
export function sessionsOn(date) {
  const key = ymd(date);
  return sessions
    .filter((s) => s.date === key || (s.repeat === "weekly" && s.date < key && parseYmd(s.date).getDay() === date.getDay()))
    .map((s) => ({ ...s, occurrence: key, marked: s.marked.includes(key) }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const getSession = (id) => sessions.find((s) => s.id === id);

export async function saveSession(data) {
  if (data.id) {
    const { data: row, error } = await supabase.from("sessions").update(toRow(data)).eq("id", data.id).select().single();
    fail(error);
    const s = getSession(data.id);
    Object.assign(s, { ...fromRow(row), marked: s.marked });
  } else {
    const { data: row, error } = await supabase.from("sessions").insert({ ...toRow(data), org_id: org.id }).select().single();
    fail(error);
    sessions.push(fromRow(row));
  }
}

export async function deleteSession(id) {
  const { error } = await supabase.from("sessions").delete().eq("id", id); // attendance rows go with it
  fail(error);
  sessions = sessions.filter((s) => s.id !== id);
  timeline = timeline.filter((t) => t.sessionId !== id);
}

export async function markAttendance(id, occurrence) {
  const s = getSession(id);
  if (!s || s.marked.includes(occurrence)) return;
  const { error } = await supabase.from("attendance").insert({ session_id: id, org_id: org.id, occurrence });
  fail(error);
  s.marked.push(occurrence);
  timeline.unshift({ sessionId: id, title: s.title, occurrence, at: Date.now() });
}

export function recentOccurrences(limit) {
  const out = [], d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 120 && out.length < limit; i++, d.setDate(d.getDate() - 1)) out.push(...sessionsOn(d).filter(canEditSession));
  return out.slice(0, limit);
}

export const getTimeline = () => timeline.slice(0, 30);
export const stats = () => ({
  classes: sessions.length,
  students: students.filter((s) => s.status === "active").length,
});

// Undo a mistaken "Mark attendance"
export async function unmarkAttendance(id, occurrence) {
  const s = getSession(id);
  if (!s || !s.marked.includes(occurrence)) return;
  const { error } = await supabase.from("attendance").delete().eq("session_id", id).eq("occurrence", occurrence);
  fail(error);
  s.marked = s.marked.filter((o) => o !== occurrence);
  timeline = timeline.filter((t) => !(t.sessionId === id && t.occurrence === occurrence));
}

// Scheduled sessions in one month (month is 0-11): total, distinct students, and per class title.
export function monthStats(year, month) {
  const byTitle = {}, students = new Set();
  let classes = 0;
  for (const d = new Date(year, month, 1); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
    for (const s of sessionsOn(d)) {
      classes++;
      byTitle[s.title] = (byTitle[s.title] || 0) + 1;
      students.add(s.student.trim().toLowerCase());
    }
  }
  return { classes, students: students.size, byTitle };
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
    sessions.forEach((s) => { if (s.studentId === d.id) s.student = data.name; }); // renames show on the calendar too
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
  sessions.forEach((s) => { if (s.studentId === id) s.studentId = null; }); // their past sessions stay, just unlinked
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
