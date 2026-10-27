-- Phase 3: group sessions (several students per session) and attendance per student.
-- Run ONCE after migration-5. Safe to run twice.

create table if not exists public.session_students (
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  primary key (session_id, student_id)
);
create index if not exists session_students_org_idx on public.session_students (org_id);
alter table public.session_students enable row level security;

drop policy if exists "team reads session students" on public.session_students;
drop policy if exists "team adds session students" on public.session_students;
drop policy if exists "team removes session students" on public.session_students;
create policy "team reads session students" on public.session_students for select using (is_member(org_id));
create policy "team adds session students" on public.session_students for insert with check (
  is_member(org_id)
  and exists (select 1 from public.sessions s where s.id = session_students.session_id and s.org_id = session_students.org_id
              and (is_admin(s.org_id) or s.tutor_id = auth.uid()))
  and exists (select 1 from public.students st where st.id = session_students.student_id and st.org_id = session_students.org_id));
create policy "team removes session students" on public.session_students for delete using (
  is_member(org_id)
  and exists (select 1 from public.sessions s where s.id = session_students.session_id and s.org_id = session_students.org_id
              and (is_admin(s.org_id) or s.tutor_id = auth.uid())));

-- every existing session keeps the one student it already had
insert into public.session_students (session_id, student_id, org_id)
select s.id, s.student_id, s.org_id from public.sessions s where s.student_id is not null
on conflict do nothing;

-- attendance becomes one row per student per session date
alter table public.attendance add column if not exists student_id uuid references public.students(id) on delete cascade;
update public.attendance a set student_id = s.student_id from public.sessions s where a.session_id = s.id and a.student_id is null;
delete from public.attendance where student_id is null;   -- only rows for sessions that never had a student
alter table public.attendance alter column student_id set not null;
alter table public.attendance drop constraint if exists attendance_session_id_occurrence_key;
create unique index if not exists attendance_unique_idx on public.attendance (session_id, occurrence, student_id);

-- marking attendance now also requires the student to be in that session
drop policy if exists "team marks attendance" on public.attendance;
create policy "team marks attendance" on public.attendance for insert with check (
  is_member(org_id)
  and exists (select 1 from public.sessions s where s.id = attendance.session_id and s.org_id = attendance.org_id
              and (is_admin(s.org_id) or s.tutor_id = auth.uid()))
  and exists (select 1 from public.session_students ss where ss.session_id = attendance.session_id and ss.student_id = attendance.student_id));
