-- Combined reservations, service entitlements, resource claims, payments, QR passes, check-ins.

create type public.reservation_status as enum ('cart','pending','confirmed','cancelled','completed');
create type public.service_type as enum ('hotel','restaurant','spa','event');

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('HX-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  status public.reservation_status not null default 'cart',
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  notes text not null default '',
  currency char(3) not null default 'USD',
  subtotal numeric(10,2) not null default 0,
  tax numeric(10,2) not null default 0,
  fees numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  cancellation_fee numeric(10,2) not null default 0,
  cancel_reason text,
  placed_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_cart_per_customer on public.reservations (customer_id) where status = 'cart';
create index reservations_customer_idx on public.reservations (customer_id);
create index reservations_status_idx on public.reservations (status, created_at desc);

-- One entitlement per bookable service in a reservation. Each is checked in independently.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  service_type public.service_type not null,
  title text not null,
  detail text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  eligible_from timestamptz not null,
  eligible_until timestamptz not null,
  adults int not null default 1 check (adults >= 0),
  children int not null default 0 check (children >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  meta jsonb not null default '{}',
  status text not null default 'held' check (status in ('held','active','cancelled','refunded','expired')),
  hold_expires_at timestamptz,
  checked_in_at timestamptz,
  checked_in_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index entitlements_res_idx on public.entitlements (reservation_id);
create index entitlements_type_start_idx on public.entitlements (service_type, starts_at);

-- Resource claims. status 'released' frees the resource; exclusion constraints are the final guard
-- against double-booking even if application checks are bypassed.
create table public.room_stays (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.entitlements (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete restrict,
  stay daterange not null,
  status text not null default 'held' check (status in ('held','confirmed','released')),
  exclude using gist (room_id with =, stay with &&) where (status <> 'released')
);

create table public.table_reservations (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.entitlements (id) on delete cascade,
  table_id uuid not null references public.seating_tables (id) on delete restrict,
  seat_id uuid references public.seats (id) on delete restrict, -- null = whole table
  during tstzrange not null,
  party_size int not null check (party_size >= 1),
  status text not null default 'held' check (status in ('held','confirmed','released')),
  exclude using gist (table_id with =, during with &&) where (status <> 'released' and seat_id is null),
  exclude using gist (seat_id with =, during with &&) where (status <> 'released' and seat_id is not null)
);
create index table_res_ent_idx on public.table_reservations (entitlement_id);

create table public.spa_appointments (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.entitlements (id) on delete cascade,
  service_id uuid not null references public.spa_services (id) on delete restrict,
  resource_id uuid not null references public.spa_resources (id) on delete restrict,
  during tstzrange not null,
  status text not null default 'held' check (status in ('held','confirmed','released')),
  exclude using gist (resource_id with =, during with &&) where (status <> 'released')
);

create table public.event_bookings (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.entitlements (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete restrict,
  qty int not null check (qty >= 1),
  status text not null default 'held' check (status in ('held','confirmed','released'))
);

-- Restaurant menu orders are separate from table reservations.
create table public.menu_orders (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  entitlement_id uuid references public.entitlements (id) on delete cascade,
  status text not null default 'placed' check (status in ('placed','preparing','served','cancelled')),
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
create table public.menu_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.menu_orders (id) on delete cascade,
  product_id uuid references public.menu_products (id) on delete set null,
  name text not null,
  unit_price numeric(10,2) not null,
  qty int not null check (qty between 1 and 50)
);

-- Payments: status is deliberately independent of reservation status and check-in.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  method text not null check (method in ('bank_transfer','cash_on_arrival','card','dev_test')),
  status text not null default 'unpaid' check (status in
    ('unpaid','awaiting_receipt','pending_verification','paid','failed','partially_refunded','refunded')),
  amount numeric(10,2) not null check (amount >= 0),
  currency char(3) not null,
  receipt_path text,                 -- private storage object path (bucket: receipts)
  provider text,                     -- external provider name when a real provider is used
  provider_ref text,
  note text not null default '',
  verified_by uuid references public.profiles (id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_res_idx on public.payments (reservation_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  reason text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- One opaque token per combined reservation. Token is random; encodes no personal data.
create table public.qr_passes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  token text not null unique check (length(token) >= 48),
  status text not null default 'active' check (status in ('active','revoked')),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);
create unique index one_active_pass on public.qr_passes (reservation_id) where status = 'active';

-- A service can be checked in at most once: UNIQUE(entitlement_id) is the hard guarantee.
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.entitlements (id) on delete restrict,
  pass_id uuid references public.qr_passes (id),
  staff_id uuid not null references public.profiles (id),
  area text not null,
  at timestamptz not null default now()
);

-- ───────────── RLS ─────────────
do $$
declare t text;
begin
  foreach t in array array['reservations','entitlements','room_stays','table_reservations','spa_appointments',
    'event_bookings','menu_orders','menu_order_items','payments','refunds','qr_passes','checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_read', t);
  end loop;
  foreach t in array array['reservations','payments','refunds','qr_passes','checkins'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', 'audit_' || t, t);
  end loop;
end $$;
-- Writes happen only through SECURITY DEFINER functions; no insert/update/delete policies exist for clients.

create policy reservations_owner_read on public.reservations for select using (customer_id = auth.uid());
create policy entitlements_owner_read on public.entitlements for select
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = auth.uid()));
create policy payments_owner_read on public.payments for select
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = auth.uid()));
create policy qr_owner_read on public.qr_passes for select
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = auth.uid()));
create policy menu_orders_owner_read on public.menu_orders for select
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.customer_id = auth.uid()));
create policy menu_items_owner_read on public.menu_order_items for select
  using (exists (select 1 from public.menu_orders o join public.reservations r on r.id = o.reservation_id
                 where o.id = order_id and r.customer_id = auth.uid()));
