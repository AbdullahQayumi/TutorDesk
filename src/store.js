// Data layer. The UI only talks to the functions exported here.
// In Step 3 we replace the bodies with Supabase calls and the UI stays the same.
// For now data lives in this browser's localStorage.

const KEY = "tutordesk.v1";

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? { sessions: [], timeline: [] }; }
  catch { return { sessions: [], timeline: [] }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ } }

let db = load();

// First run only: two sample weekly sessions so the screens aren't empty. Delete them freely.
if (!db.seeded) {
  const monday = new Date(); monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - 28);
  const on = (offset) => { const x = new Date(monday); x.setDate(x.getDate() + offset); return ymd(x); };
  const base = { title: "11+ Online One-One Sessions", student: "Student name", start: "18:00", end: "19:00", repeat: "weekly", marked: [] };
  db.sessions = [{ ...base, id: crypto.randomUUID(), date: on(1) }, { ...base, id: crypto.randomUUID(), date: on(4) }];
  db.seeded = true;
  save();
}

// Every session that happens on a given calendar day (handles weekly repeats).
export function sessionsOn(date) {
  const key = ymd(date);
  return db.sessions
    .filter((s) => s.date === key || (s.repeat === "weekly" && s.date < key && parseYmd(s.date).getDay() === date.getDay()))
    .map((s) => ({ ...s, occurrence: key, marked: s.marked.includes(key) }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const getSession = (id) => db.sessions.find((s) => s.id === id);

export function saveSession(data) {
  if (data.id) Object.assign(getSession(data.id), data);
  else db.sessions.push({ ...data, id: crypto.randomUUID(), marked: [] });
  save();
}

export function deleteSession(id) { db.sessions = db.sessions.filter((s) => s.id !== id); save(); }

export function markAttendance(id, occurrence) {
  const s = getSession(id);
  if (!s || s.marked.includes(occurrence)) return;
  s.marked.push(occurrence);
  db.timeline.unshift({ title: s.title, occurrence, at: Date.now() });
  save();
}

export function recentOccurrences(limit) {
  const out = [], d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 120 && out.length < limit; i++, d.setDate(d.getDate() - 1)) out.push(...sessionsOn(d));
  return out.slice(0, limit);
}

export const getTimeline = () => db.timeline.slice(0, 30);
export const stats = () => ({
  classes: db.sessions.length,
  students: new Set(db.sessions.map((s) => s.student.trim().toLowerCase())).size,
});
