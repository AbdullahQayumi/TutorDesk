-- Phase 5: Resources (file uploads). Run ONCE after migration-7 (migration-8 is optional). Safe to run twice.
-- Files live in a PRIVATE storage bucket, in a folder per workspace. Nobody outside the workspace can open them,
-- and a shared link is a temporary signed link.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resources', 'resources', false, 20971520, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'audio/mpeg', 'video/mp4'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  path text not null unique,                      -- where the file is in the 'resources' bucket: <org id>/<random>-<name>
  size bigint not null check (size >= 0),
  mime text,
  tags text[] not null default '{}',
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists resources_org_idx on public.resources (org_id, created_at);
create index if not exists resources_student_idx on public.resources (student_id);
alter table public.resources enable row level security;

drop policy if exists "team reads resources" on public.resources;
drop policy if exists "team adds resources" on public.resources;
drop policy if exists "uploader or admin edits resources" on public.resources;
drop policy if exists "uploader or admin deletes resources" on public.resources;
create policy "team reads resources" on public.resources for select using (is_member(org_id));
create policy "team adds resources" on public.resources for insert with check (
  is_member(org_id) and uploaded_by = auth.uid() and path like (org_id::text || '/%')
  and (student_id is null or exists (select 1 from public.students st where st.id = resources.student_id and st.org_id = resources.org_id)));
create policy "uploader or admin edits resources" on public.resources for update
  using (is_member(org_id) and (uploaded_by = auth.uid() or is_admin(org_id)))
  with check (is_member(org_id) and (uploaded_by = auth.uid() or is_admin(org_id)) and path like (org_id::text || '/%')
    and (student_id is null or exists (select 1 from public.students st where st.id = resources.student_id and st.org_id = resources.org_id)));
create policy "uploader or admin deletes resources" on public.resources for delete
  using (is_member(org_id) and (uploaded_by = auth.uid() or is_admin(org_id)));

-- the files themselves: the first folder in the path must be a workspace you belong to
drop policy if exists "team reads resource files" on storage.objects;
drop policy if exists "team uploads resource files" on storage.objects;
drop policy if exists "uploader or admin deletes resource files" on storage.objects;
create policy "team reads resource files" on storage.objects for select to authenticated
  using (bucket_id = 'resources' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "team uploads resource files" on storage.objects for insert to authenticated
  with check (bucket_id = 'resources' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "uploader or admin deletes resource files" on storage.objects for delete to authenticated
  using (bucket_id = 'resources' and public.is_member(((storage.foldername(name))[1])::uuid)
         and (owner_id = (select auth.uid())::text or public.is_admin(((storage.foldername(name))[1])::uuid)));
