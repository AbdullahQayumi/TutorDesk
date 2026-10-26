-- Phase 2b: profile page (working hours, leaves, phone). Run ONCE after migration-3. Safe to run twice.

alter table public.profiles add column if not exists phone text;

-- per-person settings (kept out of `memberships` so nobody can edit their own role by accident)
create table if not exists public.member_settings (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  working_hours jsonb,                       -- {"1":["09:00","17:00"],...}  0=Sunday..6=Saturday, missing day = closed, null = default
  takes_classes boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists leaves_org_idx on public.leaves (org_id, start_date);

create or replace function public.in_org(org uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where org_id = org and user_id = uid);
$$;
revoke execute on function public.in_org(uuid, uuid) from public, anon;
grant execute on function public.in_org(uuid, uuid) to authenticated;

alter table public.member_settings enable row level security;
alter table public.leaves enable row level security;

-- everyone on the team can read; you can change your own, and admins can change anyone's on the team
drop policy if exists "team reads settings" on public.member_settings;
drop policy if exists "write settings" on public.member_settings;
drop policy if exists "edit settings" on public.member_settings;
create policy "team reads settings" on public.member_settings for select using (is_member(org_id));
create policy "write settings" on public.member_settings for insert with check (
  is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))));
create policy "edit settings" on public.member_settings for update
  using (is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))))
  with check (is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))));

drop policy if exists "team reads leaves" on public.leaves;
drop policy if exists "add leaves" on public.leaves;
drop policy if exists "edit leaves" on public.leaves;
drop policy if exists "delete leaves" on public.leaves;
create policy "team reads leaves" on public.leaves for select using (is_member(org_id));
create policy "add leaves" on public.leaves for insert with check (
  is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))));
create policy "edit leaves" on public.leaves for update
  using (is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))))
  with check (is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))));
create policy "delete leaves" on public.leaves for delete using (
  is_member(org_id) and (user_id = auth.uid() or (is_admin(org_id) and in_org(org_id, user_id))));
