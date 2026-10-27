-- Phase 2c: batches (groups of students) and guardians (parents). Run ONCE after migration-4. Safe to run twice.

create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 200),
  created_at timestamptz not null default now()
);
create table if not exists public.batch_students (
  batch_id uuid not null references public.batches(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  primary key (batch_id, student_id)
);
create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  email text,
  phone text,
  relationship text check (relationship is null or char_length(relationship) <= 40),
  created_at timestamptz not null default now()
);
create table if not exists public.student_guardians (
  student_id uuid not null references public.students(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  primary key (student_id, guardian_id)
);
create index if not exists batches_org_idx on public.batches (org_id);
create index if not exists batch_students_org_idx on public.batch_students (org_id);
create index if not exists guardians_org_idx on public.guardians (org_id);
create index if not exists student_guardians_org_idx on public.student_guardians (org_id);

alter table public.batches enable row level security;
alter table public.batch_students enable row level security;
alter table public.guardians enable row level security;
alter table public.student_guardians enable row level security;

-- batches and guardians: the whole team can see, add and edit; only admins delete
drop policy if exists "team reads batches" on public.batches;
drop policy if exists "team adds batches" on public.batches;
drop policy if exists "team edits batches" on public.batches;
drop policy if exists "admins delete batches" on public.batches;
create policy "team reads batches" on public.batches for select using (is_member(org_id));
create policy "team adds batches" on public.batches for insert with check (is_member(org_id));
create policy "team edits batches" on public.batches for update using (is_member(org_id)) with check (is_member(org_id));
create policy "admins delete batches" on public.batches for delete using (is_admin(org_id));

drop policy if exists "team reads guardians" on public.guardians;
drop policy if exists "team adds guardians" on public.guardians;
drop policy if exists "team edits guardians" on public.guardians;
drop policy if exists "admins delete guardians" on public.guardians;
create policy "team reads guardians" on public.guardians for select using (is_member(org_id));
create policy "team adds guardians" on public.guardians for insert with check (is_member(org_id));
create policy "team edits guardians" on public.guardians for update using (is_member(org_id)) with check (is_member(org_id));
create policy "admins delete guardians" on public.guardians for delete using (is_admin(org_id));

-- links: both sides must belong to the same workspace
drop policy if exists "team reads batch links" on public.batch_students;
drop policy if exists "team adds batch links" on public.batch_students;
drop policy if exists "team removes batch links" on public.batch_students;
create policy "team reads batch links" on public.batch_students for select using (is_member(org_id));
create policy "team adds batch links" on public.batch_students for insert with check (
  is_member(org_id)
  and exists (select 1 from public.batches b where b.id = batch_students.batch_id and b.org_id = batch_students.org_id)
  and exists (select 1 from public.students s where s.id = batch_students.student_id and s.org_id = batch_students.org_id));
create policy "team removes batch links" on public.batch_students for delete using (is_member(org_id));

drop policy if exists "team reads guardian links" on public.student_guardians;
drop policy if exists "team adds guardian links" on public.student_guardians;
drop policy if exists "team removes guardian links" on public.student_guardians;
create policy "team reads guardian links" on public.student_guardians for select using (is_member(org_id));
create policy "team adds guardian links" on public.student_guardians for insert with check (
  is_member(org_id)
  and exists (select 1 from public.guardians g where g.id = student_guardians.guardian_id and g.org_id = student_guardians.org_id)
  and exists (select 1 from public.students s where s.id = student_guardians.student_id and s.org_id = student_guardians.org_id));
create policy "team removes guardian links" on public.student_guardians for delete using (is_member(org_id));
