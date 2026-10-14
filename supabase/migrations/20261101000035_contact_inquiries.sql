create table if not exists public.contact_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  email text not null check (
    char_length(btrim(email)) between 3 and 254
    and btrim(email) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  subject text not null check (char_length(btrim(subject)) between 3 and 140),
  message text not null check (char_length(btrim(message)) between 10 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists contact_inquiries_created_idx
  on public.contact_inquiries (created_at desc);

alter table public.contact_inquiries enable row level security;

drop policy if exists contact_inquiries_public_submit on public.contact_inquiries;
create policy contact_inquiries_public_submit on public.contact_inquiries
  for insert to anon, authenticated with check (true);

drop policy if exists contact_inquiries_admin_read on public.contact_inquiries;
create policy contact_inquiries_admin_read on public.contact_inquiries
  for select to authenticated using (public.is_admin());

revoke all on public.contact_inquiries from public, anon, authenticated;
grant insert on public.contact_inquiries to anon, authenticated;
grant select on public.contact_inquiries to authenticated;
