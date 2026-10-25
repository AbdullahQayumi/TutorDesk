-- TutorDesk database. In Supabase: SQL Editor -> New query -> paste all of this -> Run.

-- One profile per tutor (created automatically at sign-up, see trigger below)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  student text not null check (char_length(student) between 1 and 80),
  session_date date not null,
  start_time time not null,
  end_time time not null,
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly')),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index on public.sessions (tutor_id);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  occurrence date not null,
  marked_at timestamptz not null default now(),
  unique (session_id, occurrence)
);
create index on public.attendance (tutor_id);

-- Row Level Security: every tutor can only read and change their OWN rows.
-- This is what keeps one tutor's students private from another tutor.
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;

create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "update own profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "own sessions" on public.sessions for all
  using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());

create policy "own attendance" on public.attendance for all
  using (tutor_id = auth.uid())
  with check (
    tutor_id = auth.uid()
    and exists (select 1 from public.sessions s where s.id = session_id and s.tutor_id = auth.uid())
  );

-- Create the profile row when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
