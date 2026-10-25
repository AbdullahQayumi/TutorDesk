// Data layer. The screens only talk to the functions exported here.
// Data is loaded once into memory (loadAll), reads are instant, and every change
// is written to Supabase first, then reflected in memory.
import { supabase } from "./supabase.js";

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

let sessions = []; // { id, title, student, date, start, end, repeat, marked: ["YYYY-MM-DD", ...] }
let timeline = []; // newest first

const fail = (error) => { if (error) throw new Error(error.message); };
// Database column names <-> app field names (Postgres returns time as "18:00:00")
const fromRow = (r) => ({ id: r.id, title: r.title, student: r.student, date: r.session_date,
  start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5), repeat: r.recurrence, marked: [] });
const toRow = (s) => ({ title: s.title, student: s.student, session_date: s.date,
  start_time: s.start, end_time: s.end, recurrence: s.repeat });

export async function loadAll() {
  const [a, b] = await Promise.all([
    supabase.from("sessions").select("*"),
    supabase.from("attendance").select("session_id, occurrence, marked_at").order("marked_at", { ascending: false }),
  ]);
  fail(a.error); fail(b.error);
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
export function clearAll() { sessions = []; timeline = []; }

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
    const { data: row, error } = await supabase.from("sessions").insert(toRow(data)).select().single();
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
  const { error } = await supabase.from("attendance").insert({ session_id: id, occurrence });
  fail(error);
  s.marked.push(occurrence);
  timeline.unshift({ sessionId: id, title: s.title, occurrence, at: Date.now() });
}

export function recentOccurrences(limit) {
  const out = [], d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 120 && out.length < limit; i++, d.setDate(d.getDate() - 1)) out.push(...sessionsOn(d));
  return out.slice(0, limit);
}

export const getTimeline = () => timeline.slice(0, 30);
export const stats = () => ({
  classes: sessions.length,
  students: new Set(sessions.map((s) => s.student.trim().toLowerCase())).size,
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
