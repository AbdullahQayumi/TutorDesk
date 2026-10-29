-- Hardening suggested by Supabase's security and performance advisors. Safe to run twice.

-- handle_new_user() is a trigger function; nobody should be able to call it through the API.
-- (Triggers keep working: Postgres does not check EXECUTE when a trigger fires.)
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- indexes on foreign keys the advisor flagged (additive and safe)
create index if not exists attendance_student_idx on public.attendance (student_id);
create index if not exists batch_students_student_idx on public.batch_students (student_id);
create index if not exists invoice_items_session_idx on public.invoice_items (session_id);
create index if not exists invoices_student_idx on public.invoices (student_id);
create index if not exists leaves_user_idx on public.leaves (user_id);
create index if not exists member_settings_user_idx on public.member_settings (user_id);
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists session_students_student_idx on public.session_students (student_id);
create index if not exists sessions_student_idx on public.sessions (student_id);
create index if not exists student_guardians_guardian_idx on public.student_guardians (guardian_id);
