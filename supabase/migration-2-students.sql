-- Phase 1: real student records. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run twice (it won't duplicate your students).

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
create index if not exists students_tutor_idx on public.students (tutor_id);

alter table public.students enable row level security;
drop policy if exists "own students" on public.students;
create policy "own students" on public.students for all
  using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());

-- Sessions can now point at a student record
alter table public.sessions add column if not exists student_id uuid references public.students(id) on delete set null;

-- A session may only point at one of the tutor's OWN students
drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all
  using (tutor_id = auth.uid())
  with check (
    tutor_id = auth.uid()
    and (student_id is null or exists (select 1 from public.students st where st.id = student_id and st.tutor_id = auth.uid()))
  );

-- Turn the student names already typed into sessions into real student records
insert into public.students (tutor_id, name)
select distinct s.tutor_id, s.student from public.sessions s
where not exists (select 1 from public.students st where st.tutor_id = s.tutor_id and st.name = s.student);

update public.sessions s set student_id = st.id
from public.students st
where st.tutor_id = s.tutor_id and st.name = s.student and s.student_id is null;
