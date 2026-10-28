-- Phase 4: invoices, payments and session prices. Run ONCE after migration-6. Safe to run twice.
-- Money is visible to owners and admins only. Staff cannot see invoices or payments.

alter table public.organisations add column if not exists currency text not null default 'GBP' check (char_length(currency) = 3);
alter table public.organisations add column if not exists billing_details text check (billing_details is null or char_length(billing_details) <= 1000);
alter table public.sessions add column if not exists price numeric(10,2) check (price is null or price >= 0);  -- per student, per session

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,                       -- kept so an invoice stays readable if the student is deleted
  number text not null,
  issue_date date not null default current_date,
  due_date date not null,
  period_start date,
  period_end date,
  status text not null default 'open' check (status in ('open', 'void')),
  notes text check (notes is null or char_length(notes) <= 1000),
  total numeric(10,2) not null check (total > 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (org_id, number)
);
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  org_id uuid not null references public.organisations(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  occurrence date,
  description text not null check (char_length(description) between 1 and 200),
  quantity numeric(8,2) not null default 1 check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  amount numeric(10,2) not null check (amount >= 0)
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text check (method is null or char_length(method) <= 40),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists invoices_org_idx on public.invoices (org_id, issue_date);
create index if not exists invoice_items_org_idx on public.invoice_items (org_id);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index if not exists payments_org_idx on public.payments (org_id, paid_on);
-- a session date can only be billed to the same student once (voiding an invoice frees its sessions)
create unique index if not exists invoice_items_once on public.invoice_items (student_id, session_id, occurrence)
  where session_id is not null and student_id is not null;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;

drop policy if exists "admins manage invoices" on public.invoices;
create policy "admins manage invoices" on public.invoices for all
  using (is_admin(org_id))
  with check (is_admin(org_id) and (student_id is null or exists (
    select 1 from public.students st where st.id = invoices.student_id and st.org_id = invoices.org_id)));

drop policy if exists "admins manage invoice items" on public.invoice_items;
create policy "admins manage invoice items" on public.invoice_items for all
  using (is_admin(org_id))
  with check (is_admin(org_id)
    and exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and i.org_id = invoice_items.org_id)
    and (session_id is null or exists (select 1 from public.sessions s where s.id = invoice_items.session_id and s.org_id = invoice_items.org_id)));

drop policy if exists "admins manage payments" on public.payments;
create policy "admins manage payments" on public.payments for all
  using (is_admin(org_id))
  with check (is_admin(org_id)
    and exists (select 1 from public.invoices i where i.id = payments.invoice_id and i.org_id = payments.org_id));
