-- Phase 2: Solo and Business accounts. Run ONCE after migration-2, in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run twice. Every existing user becomes a Solo workspace that owns their current data.

-- ---------- tables ----------
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  type text not null default 'solo' check (type in ('solo', 'business')),
  created_at timestamptz not null default now()
);
create table if not exists public.memberships (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'staff' check (role in ('admin', 'staff')),
  invited_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

-- ---------- helper functions (security definer so policies can read memberships without looping) ----------
create or replace function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = org and user_id = auth.uid());
$$;
create or replace function public.is_admin(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = org and user_id = auth.uid() and role in ('owner', 'admin'));
$$;
create or replace function public.is_owner(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = org and user_id = auth.uid() and role = 'owner');
$$;
create or replace function public.shares_org(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships a join memberships b on a.org_id = b.org_id
                 where a.user_id = auth.uid() and b.user_id = uid);
$$;
revoke execute on function public.is_member(uuid), public.is_admin(uuid), public.is_owner(uuid), public.shares_org(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_admin(uuid), public.is_owner(uuid), public.shares_org(uuid) to authenticated;

-- ---------- give every existing user a Solo workspace, then stamp their data with it ----------
do $$
declare p record; o uuid;
begin
  for p in select id, coalesce(nullif(full_name, ''), email, 'My workspace') as nm from public.profiles
           where not exists (select 1 from public.memberships m where m.user_id = profiles.id) loop
    insert into public.organisations (name, type) values (left(p.nm, 80), 'solo') returning id into o;
    insert into public.memberships (org_id, user_id, role) values (o, p.id, 'owner');
  end loop;
end $$;

alter table public.sessions   add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.students   add column if not exists org_id uuid references public.organisations(id) on delete cascade;
alter table public.attendance add column if not exists org_id uuid references public.organisations(id) on delete cascade;

update public.sessions   x set org_id = m.org_id from public.memberships m where m.user_id = x.tutor_id and x.org_id is null;
update public.students   x set org_id = m.org_id from public.memberships m where m.user_id = x.tutor_id and x.org_id is null;
update public.attendance x set org_id = m.org_id from public.memberships m where m.user_id = x.tutor_id and x.org_id is null;

alter table public.sessions   alter column org_id set not null;
alter table public.students   alter column org_id set not null;
alter table public.attendance alter column org_id set not null;
create index if not exists sessions_org_idx   on public.sessions (org_id);
create index if not exists students_org_idx   on public.students (org_id);
create index if not exists attendance_org_idx on public.attendance (org_id);

-- ---------- sign-up: create a workspace (solo or business), unless the person was invited to a team ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare org uuid; kind text; bname text;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name', ''));
  if not exists (select 1 from public.invites where email = lower(new.email)) then
    kind := case when new.raw_user_meta_data->>'account_type' = 'business' then 'business' else 'solo' end;
    bname := coalesce(nullif(trim(new.raw_user_meta_data->>'business_name'), ''), nullif(new.raw_user_meta_data->>'full_name', ''), 'My workspace');
    insert into public.organisations (name, type) values (left(bname, 80), kind) returning id into org;
    insert into public.memberships (org_id, user_id, role) values (org, new.id, 'owner');
  end if;
  return new;
end $$;

-- Called by the app after login: join any team this (confirmed) email was invited to
create or replace function public.accept_invites() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
    return 0;
  end if;
  for r in select * from public.invites where email = lower(auth.jwt()->>'email') loop
    insert into public.memberships (org_id, user_id, role) values (r.org_id, auth.uid(), r.role) on conflict do nothing;
    delete from public.invites where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.accept_invites() from public, anon;
grant execute on function public.accept_invites() to authenticated;

-- ---------- privacy rules (Row Level Security) ----------
alter table public.organisations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invites       enable row level security;

drop policy if exists "read own org" on public.organisations;
create policy "read own org" on public.organisations for select using (is_member(id));
drop policy if exists "owner edits org" on public.organisations;
create policy "owner edits org" on public.organisations for update using (is_owner(id)) with check (is_owner(id));

drop policy if exists "read team" on public.memberships;
create policy "read team" on public.memberships for select using (is_member(org_id));
drop policy if exists "admins change roles" on public.memberships;
create policy "admins change roles" on public.memberships for update
  using (is_admin(org_id) and role <> 'owner') with check (role in ('admin', 'staff'));
drop policy if exists "remove or leave" on public.memberships;
create policy "remove or leave" on public.memberships for delete
  using (role <> 'owner' and (is_admin(org_id) or user_id = auth.uid()));

drop policy if exists "admins read invites" on public.invites;
create policy "admins read invites" on public.invites for select using (is_admin(org_id));
drop policy if exists "admins invite" on public.invites;
create policy "admins invite" on public.invites for insert with check (
  is_admin(org_id) and exists (select 1 from public.organisations o where o.id = invites.org_id and o.type = 'business'));
drop policy if exists "admins revoke invites" on public.invites;
create policy "admins revoke invites" on public.invites for delete using (is_admin(org_id));

-- people can see the name/email of colleagues in their workspace
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "read team profiles" on public.profiles;
create policy "read team profiles" on public.profiles for select using (id = auth.uid() or shares_org(id));

-- students: anyone on the team can see/add/edit; only admins delete
drop policy if exists "own students" on public.students;
drop policy if exists "team reads students" on public.students;
drop policy if exists "team adds students" on public.students;
drop policy if exists "team edits students" on public.students;
drop policy if exists "admins delete students" on public.students;
create policy "team reads students" on public.students for select using (is_member(org_id));
create policy "team adds students" on public.students for insert with check (is_member(org_id));
create policy "team edits students" on public.students for update using (is_member(org_id)) with check (is_member(org_id));
create policy "admins delete students" on public.students for delete using (is_admin(org_id));

-- sessions: everyone on the team can see them; admins manage all, staff manage their own
drop policy if exists "own sessions" on public.sessions;
drop policy if exists "team reads sessions" on public.sessions;
drop policy if exists "team adds sessions" on public.sessions;
drop policy if exists "team edits sessions" on public.sessions;
drop policy if exists "team deletes sessions" on public.sessions;
create policy "team reads sessions" on public.sessions for select using (is_member(org_id));
create policy "team adds sessions" on public.sessions for insert with check (
  is_member(org_id) and (is_admin(org_id) or tutor_id = auth.uid())
  and exists (select 1 from public.memberships m where m.org_id = sessions.org_id and m.user_id = sessions.tutor_id)
  and (student_id is null or exists (select 1 from public.students st where st.id = sessions.student_id and st.org_id = sessions.org_id)));
create policy "team edits sessions" on public.sessions for update
  using (is_member(org_id) and (is_admin(org_id) or tutor_id = auth.uid()))
  with check (
    is_member(org_id) and (is_admin(org_id) or tutor_id = auth.uid())
    and exists (select 1 from public.memberships m where m.org_id = sessions.org_id and m.user_id = sessions.tutor_id)
    and (student_id is null or exists (select 1 from public.students st where st.id = sessions.student_id and st.org_id = sessions.org_id)));
create policy "team deletes sessions" on public.sessions for delete
  using (is_member(org_id) and (is_admin(org_id) or tutor_id = auth.uid()));

-- attendance: marked/unmarked by an admin or the session's own staff member
drop policy if exists "own attendance" on public.attendance;
drop policy if exists "team reads attendance" on public.attendance;
drop policy if exists "team marks attendance" on public.attendance;
drop policy if exists "team unmarks attendance" on public.attendance;
create policy "team reads attendance" on public.attendance for select using (is_member(org_id));
create policy "team marks attendance" on public.attendance for insert with check (
  is_member(org_id) and exists (select 1 from public.sessions s
    where s.id = attendance.session_id and s.org_id = attendance.org_id and (is_admin(s.org_id) or s.tutor_id = auth.uid())));
create policy "team unmarks attendance" on public.attendance for delete using (
  is_member(org_id) and exists (select 1 from public.sessions s
    where s.id = attendance.session_id and s.org_id = attendance.org_id and (is_admin(s.org_id) or s.tutor_id = auth.uid())));
