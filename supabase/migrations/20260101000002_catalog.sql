-- Catalog + inventory tables: hotel, restaurant (menu + seating), spa, events/leads.

create function public.hotel_tz() returns text language sql stable security definer set search_path = public as
$$ select timezone from public.settings where id = 1 $$;

-- Convert hotel-local date+time to timestamptz using the configured timezone.
create function public.local_ts(p_date date, p_time time) returns timestamptz
language sql stable security definer set search_path = public as
$$ select (p_date + p_time) at time zone public.hotel_tz() $$;

-- ───────────── HOTEL ─────────────
create table public.room_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.room_categories (id) on delete set null,
  name text not null,
  description text not null default '',
  photos text[] not null default '{}',
  amenities text[] not null default '{}',
  max_adults int not null default 2 check (max_adults >= 1),
  max_children int not null default 0 check (max_children >= 0),
  max_occupancy int not null default 2 check (max_occupancy >= 1),
  base_rate numeric(10,2) not null check (base_rate >= 0),
  min_nights int not null default 1 check (min_nights >= 1),
  max_nights int not null default 30 check (max_nights >= min_nights),
  policies text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (max_occupancy <= max_adults + max_children)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references public.room_types (id) on delete restrict,
  number text not null unique,
  notes text not null default '',
  active boolean not null default true
);

create table public.room_rate_overrides (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid not null references public.room_types (id) on delete cascade,
  label text not null default '',
  start_date date not null,
  end_date date not null,
  rate numeric(10,2) not null check (rate >= 0),
  during daterange generated always as (daterange(start_date, end_date, '[]')) stored,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  exclude using gist (room_type_id with =, during with &&)
);

create table public.room_blocks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null default 'Maintenance',
  during daterange generated always as (daterange(start_date, end_date, '[)')) stored,
  check (end_date > start_date),
  exclude using gist (room_id with =, during with &&)
);

create table public.room_addons (
  id uuid primary key default gen_random_uuid(),
  room_type_id uuid references public.room_types (id) on delete cascade, -- null = all room types
  name text not null,
  description text not null default '',
  kind text not null default 'addon' check (kind in ('addon','upgrade')),
  price numeric(10,2) not null check (price >= 0),
  pricing text not null default 'per_stay' check (pricing in ('per_stay','per_night','per_guest')),
  active boolean not null default true
);

-- ───────────── RESTAURANT ─────────────
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.menu_products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.menu_categories (id) on delete set null,
  name text not null,
  description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  photo_url text,
  available boolean not null default true,
  active boolean not null default true
);

create table public.restaurant_config (
  id int primary key default 1 check (id = 1),
  open_time time not null default '12:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  dwell_minutes int not null default 90 check (dwell_minutes between 15 and 480),
  deposit_per_guest numeric(10,2) not null default 0 check (deposit_per_guest >= 0),
  closed_weekdays int[] not null default '{}'
);
insert into public.restaurant_config (id) values (1);

create table public.seating_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  width int not null default 800 check (width between 200 and 4000),
  height int not null default 500 check (height between 200 and 4000),
  active boolean not null default true
);

create table public.seating_tables (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.seating_areas (id) on delete cascade,
  label text not null,
  shape text not null default 'round' check (shape in ('round','rect')),
  x numeric not null default 20,
  y numeric not null default 20,
  w numeric not null default 80 check (w > 10),
  h numeric not null default 80 check (h > 10),
  capacity int not null default 4 check (capacity >= 1),
  min_party int not null default 1 check (min_party >= 1),
  seat_selectable boolean not null default false, -- guests pick individual seats (bar/communal)
  active boolean not null default true,
  unique (area_id, label)
);

create table public.seats (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.seating_tables (id) on delete cascade,
  label text not null,
  x numeric not null default 0, -- offset relative to table origin
  y numeric not null default 0,
  active boolean not null default true,
  unique (table_id, label)
);

-- ───────────── SPA ─────────────
create table public.spa_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  sort_order int not null default 0,
  active boolean not null default true
);

create table public.spa_services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.spa_categories (id) on delete set null,
  name text not null,
  description text not null default '',
  photos text[] not null default '{}',
  duration_min int not null check (duration_min between 5 and 600),
  buffer_min int not null default 0 check (buffer_min >= 0),
  price numeric(10,2) check (price >= 0),            -- null = no price configured (pay at spa)
  max_guests int not null default 1 check (max_guests between 1 and 10),
  active boolean not null default true
);

create table public.spa_resources ( -- therapist, room, or both
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table public.spa_service_resources (
  service_id uuid not null references public.spa_services (id) on delete cascade,
  resource_id uuid not null references public.spa_resources (id) on delete cascade,
  primary key (service_id, resource_id)
);

create table public.spa_schedules (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.spa_resources (id) on delete cascade,
  weekday int not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  slot_minutes int not null default 30 check (slot_minutes between 5 and 240),
  check (end_time > start_time)
);

-- ───────────── EVENTS & LEADS ─────────────
create table public.event_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  notes text not null default '',
  active boolean not null default true
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.event_providers (id) on delete set null,
  title text not null,
  description text not null default '',
  photo_url text,
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int check (capacity is null or capacity >= 1),
  price numeric(10,2) not null default 0 check (price >= 0),
  child_price numeric(10,2) check (child_price >= 0),
  booking_enabled boolean not null default true,
  active boolean not null default true,
  check (ends_at > starts_at)
);

create table public.event_leads (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete set null,
  provider_id uuid references public.event_providers (id) on delete set null,
  name text not null,
  email text not null,
  phone text not null default '',
  message text not null default '',
  status text not null default 'new' check (status in ('new','contacted','qualified','won','lost')),
  notes text not null default '',
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Public view: event listings with the provider's name only (contact details stay private).
create view public.public_events as
  select e.id, e.title, e.description, e.photo_url, e.location, e.starts_at, e.ends_at, e.capacity,
         e.price, coalesce(e.child_price, e.price) as child_price, e.booking_enabled,
         p.name as provider_name
  from public.events e left join public.event_providers p on p.id = e.provider_id
  where e.active and e.ends_at > now();
grant select on public.public_events to anon, authenticated;

create function public.submit_event_lead(p_event uuid, p_name text, p_email text, p_phone text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_name,''))) < 1 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_input';
  end if;
  insert into public.event_leads (event_id, provider_id, name, email, phone, message)
  values (p_event, (select provider_id from public.events where id = p_event),
          left(trim(p_name), 200), left(p_email, 200), left(coalesce(p_phone,''), 50), left(coalesce(p_message,''), 2000));
end $$;
grant execute on function public.submit_event_lead(uuid, text, text, text, text) to anon, authenticated;

-- ───────────── RLS for catalog ─────────────
do $$
declare t text;
begin
  -- Admin full control on every catalog table.
  foreach t in array array[
    'room_categories','room_types','rooms','room_rate_overrides','room_blocks','room_addons',
    'menu_categories','menu_products','restaurant_config','seating_areas','seating_tables','seats',
    'spa_categories','spa_services','spa_resources','spa_service_resources','spa_schedules',
    'event_providers','events','event_leads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', 'audit_' || t, t);
  end loop;
  -- Public read of active guest-facing catalog rows.
  foreach t in array array[
    'room_categories','room_types','menu_categories','menu_products','seating_areas','seating_tables','seats',
    'spa_categories','spa_services'] loop
    execute format('create policy %I on public.%I for select using (active)', t || '_public', t);
  end loop;
  foreach t in array array['room_addons'] loop
    execute format('create policy %I on public.%I for select using (active)', t || '_public', t);
  end loop;
  foreach t in array array['room_rate_overrides','restaurant_config'] loop
    execute format('create policy %I on public.%I for select using (true)', t || '_public', t);
  end loop;
end $$;
