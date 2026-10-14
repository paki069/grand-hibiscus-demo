create table if not exists public.gym_packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('day-pass', 'monthly', 'three-month', 'yearly')),
  title text not null,
  description text not null default '',
  benefits text[] not null default '{}',
  price numeric(10,2) check (price is null or price >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles
  drop constraint profiles_staff_areas_check,
  add constraint profiles_staff_areas_check
    check (staff_areas <@ array['hotel', 'restaurant', 'spa', 'gym', 'events']::text[]);

alter table public.gym_packages enable row level security;
drop policy if exists gym_packages_public_read on public.gym_packages;
create policy gym_packages_public_read on public.gym_packages
  for select using (active or public.is_admin());
drop policy if exists gym_packages_admin_write on public.gym_packages;
create policy gym_packages_admin_write on public.gym_packages
  for all using (public.is_admin()) with check (public.is_admin());
grant select on public.gym_packages to anon, authenticated;
grant insert, update, delete on public.gym_packages to authenticated;

insert into public.gym_packages (slug, title, description, sort_order) values
  ('day-pass', 'Day pass', 'One day of gym access, valid for 24 hours from purchase.', 1),
  ('monthly', 'Monthly membership', 'A month of access to keep your routine moving.', 2),
  ('three-month', 'Three-month membership', 'Three months of access with room to build a rhythm.', 3),
  ('yearly', 'Annual membership', 'A full year of access to make wellness part of every day.', 4)
on conflict (slug) do nothing;

drop trigger if exists audit_gym_packages on public.gym_packages;
create trigger audit_gym_packages
  after insert or update or delete on public.gym_packages
  for each row execute function public.audit_row();

create or replace function public._area_service(p_area text) returns public.service_type
language sql immutable as $$
  select case p_area
    when 'hotel' then 'hotel'
    when 'restaurant' then 'restaurant'
    when 'spa' then 'spa'
    when 'gym' then 'gym'
    when 'events' then 'event'
  end::public.service_type
$$;

alter table public.cart_service_interests
  drop constraint if exists cart_service_interests_service_type_check;
alter table public.cart_service_interests
  add constraint cart_service_interests_service_type_check
    check (service_type in ('restaurant', 'spa', 'event', 'gym'));

create or replace function public.set_cart_service_interest(p_service_type text, p_enabled boolean, p_hotel_entitlement uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cart uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_service_type is null or p_service_type not in ('restaurant', 'spa', 'event', 'gym') then
    raise exception 'invalid_service_interest';
  end if;
  select id into v_cart from public.reservations where customer_id = auth.uid() and status = 'cart';
  if v_cart is null then raise exception 'cart_not_found'; end if;
  if p_hotel_entitlement is not null and not exists (
    select 1 from public.entitlements
    where id = p_hotel_entitlement and reservation_id = v_cart
      and service_type = 'hotel' and status = 'held' and hold_expires_at > now()
  ) then raise exception 'room_not_in_cart'; end if;

  if p_enabled then
    insert into public.cart_service_interests (reservation_id, hotel_entitlement_id, service_type)
    values (v_cart, p_hotel_entitlement, p_service_type)
    on conflict do nothing;
  else
    delete from public.cart_service_interests
    where reservation_id = v_cart and hotel_entitlement_id is not distinct from p_hotel_entitlement
      and service_type = p_service_type;
  end if;
end $$;

create or replace function public.add_room_booking_to_cart(
  p_room_type uuid,
  p_checkin date,
  p_checkout date,
  p_adults int,
  p_children int,
  p_addons uuid[],
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text,
  p_interests text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_ent uuid; v_res uuid; v_interests text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if nullif(btrim(p_first), '') is null or nullif(btrim(p_last), '') is null
     or length(btrim(p_first)) > 100 or length(btrim(p_last)) > 100
     or nullif(btrim(p_email), '') is null or length(btrim(p_email)) > 254
     or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or nullif(btrim(p_phone), '') is null or length(btrim(p_phone)) < 5 or length(btrim(p_phone)) > 40 then
    raise exception 'invalid_details';
  end if;

  v_interests := coalesce(p_interests, '{}');
  if exists (select 1 from unnest(v_interests) as interests(value)
    where value is null or value not in ('restaurant', 'spa', 'event', 'gym')) then
    raise exception 'invalid_service_interest';
  end if;

  v_ent := public.add_room_to_cart(p_room_type, p_checkin, p_checkout, p_adults, p_children, p_addons);
  select reservation_id into v_res from public.entitlements where id = v_ent;
  update public.reservations
    set first_name = btrim(p_first), last_name = btrim(p_last), email = btrim(p_email),
        phone = btrim(p_phone), notes = left(coalesce(p_notes, ''), 1000)
    where id = v_res and customer_id = auth.uid() and status = 'cart';
  if not found then raise exception 'cart_not_found'; end if;

  insert into public.cart_service_interests (reservation_id, hotel_entitlement_id, service_type)
    select v_res, v_ent, i from (select distinct unnest(v_interests) as i) selected
    on conflict do nothing;
  return v_ent;
end $$;

create or replace function public.gym_membership_status()
returns table (title text, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.title, e.ends_at
  from public.entitlements e
  join public.reservations r on r.id = e.reservation_id
  where auth.uid() is not null
    and r.customer_id = auth.uid()
    and r.status = 'confirmed'
    and e.service_type = 'gym'
    and e.status = 'active'
    and e.starts_at <= now()
    and e.ends_at > now()
  order by e.ends_at desc
  limit 1
$$;

create or replace function public.gym_access_covers_stay(p_checkin date, p_checkout date)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and p_checkin < p_checkout
    and exists (
      select 1
      from public.entitlements e
      join public.reservations r on r.id = e.reservation_id
      where r.customer_id = auth.uid()
        and r.status = 'confirmed'
        and e.service_type = 'gym'
        and e.status = 'active'
        and e.starts_at <= public.local_ts(p_checkin, (select checkin_time from public.settings where id = 1))
        and e.ends_at >= public.local_ts(p_checkout, (select checkout_time from public.settings where id = 1))
    )
$$;

create or replace function public.add_gym_package_to_cart(p_package uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_package public.gym_packages;
  v_settings public.settings;
  v_cart uuid;
  v_ent uuid;
  v_start timestamptz := now();
  v_end timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into v_settings from public.settings where id = 1;
  select * into v_package from public.gym_packages where id = p_package and active;
  if not found then raise exception 'gym_package_unavailable'; end if;
  if v_package.price is null then raise exception 'gym_price_unavailable'; end if;
  if exists (
    select 1 from public.entitlements e
    join public.reservations r on r.id = e.reservation_id
    where r.customer_id = auth.uid()
      and r.status = 'confirmed'
      and e.service_type = 'gym'
      and e.status = 'active'
      and e.starts_at <= now()
      and e.ends_at > now()
  ) then raise exception 'gym_membership_active'; end if;
  if exists (select 1 from public.entitlements where reservation_id = v_cart and service_type = 'gym' and status = 'held') then
    raise exception 'gym_item_in_cart';
  end if;

  v_end := case v_package.slug
    when 'day-pass' then v_start + interval '1 day'
    when 'monthly' then v_start + interval '1 month'
    when 'three-month' then v_start + interval '3 months'
    when 'yearly' then v_start + interval '1 year'
  end;
  insert into public.entitlements (
    reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
    adults, children, total, meta, status, hold_expires_at
  ) values (
    v_cart, 'gym', v_package.title, v_package.description, v_start, v_end, v_start, v_end,
    1, 0, v_package.price,
    jsonb_build_object('package_id', v_package.id, 'package_slug', v_package.slug, 'benefits', v_package.benefits),
    'held', now() + make_interval(mins => v_settings.hold_minutes)
  ) returning id into v_ent;
  return v_ent;
end $$;

create or replace function public.add_gym_access_to_room_cart(
  p_hotel_entitlement uuid,
  p_adults int,
  p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_res uuid;
  v_room public.entitlements;
  v_package public.gym_packages;
  v_settings public.settings;
  v_ent uuid;
  v_checkin date;
  v_checkout date;
  v_nights int;
  v_guests int;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  select * into v_room
  from public.entitlements
  where id = p_hotel_entitlement and reservation_id = v_res and service_type = 'hotel';
  if not found then raise exception 'room_not_in_cart'; end if;

  v_checkin := (v_room.meta ->> 'checkin')::date;
  v_checkout := (v_room.meta ->> 'checkout')::date;
  if v_checkin is null or v_checkout is null or v_checkout <= v_checkin then raise exception 'invalid_stay'; end if;
  v_nights := v_checkout - v_checkin;
  if p_children is null then raise exception 'invalid_party'; end if;
  if p_children <> 0 then raise exception 'gym_adults_only'; end if;
  v_guests := coalesce(p_adults, 0);
  if p_adults is null or p_adults < 0 or v_guests < 1 or p_adults > v_room.adults then
    raise exception 'invalid_party';
  end if;
  if public.gym_access_covers_stay(v_checkin, v_checkout) then raise exception 'gym_membership_active'; end if;
  if exists (
    select 1 from public.entitlements
    where parent_entitlement_id = p_hotel_entitlement and service_type = 'gym' and status = 'held'
  ) then raise exception 'gym_item_in_cart'; end if;

  select * into v_package from public.gym_packages where slug = 'day-pass' and active;
  if not found then raise exception 'gym_package_unavailable'; end if;
  if v_package.price is null then raise exception 'gym_price_unavailable'; end if;
  select * into v_settings from public.settings where id = 1;
  insert into public.entitlements (
    reservation_id, service_type, parent_entitlement_id, title, detail, starts_at, ends_at, eligible_from, eligible_until,
    adults, children, total, meta, status, hold_expires_at
  ) values (
    v_res, 'gym', p_hotel_entitlement, 'Gym access for your stay',
    v_guests || ' guest' || case when v_guests = 1 then '' else 's' end || ' · ' ||
      v_nights || ' night' || case when v_nights = 1 then '' else 's' end,
    v_room.starts_at, v_room.ends_at, v_room.starts_at, v_room.ends_at,
    p_adults, p_children, v_package.price * v_guests * v_nights,
    jsonb_build_object(
      'package_id', v_package.id,
      'package_slug', v_package.slug,
      'price_per_guest_per_day', v_package.price,
      'guests', v_guests,
      'nights', v_nights
    ),
    'held', now() + make_interval(mins => v_settings.hold_minutes)
  ) returning id into v_ent;
  return v_ent;
end $$;

revoke execute on function public.set_cart_service_interest(text, boolean, uuid),
  public.add_room_booking_to_cart(uuid, date, date, int, int, uuid[], text, text, text, text, text, text[]),
  public.gym_membership_status(),
  public.gym_access_covers_stay(date, date),
  public.add_gym_package_to_cart(uuid),
  public.add_gym_access_to_room_cart(uuid, int, int)
  from public, anon;
grant execute on function public.set_cart_service_interest(text, boolean, uuid),
  public.add_room_booking_to_cart(uuid, date, date, int, int, uuid[], text, text, text, text, text, text[]),
  public.gym_membership_status(),
  public.gym_access_covers_stay(date, date),
  public.add_gym_package_to_cart(uuid),
  public.add_gym_access_to_room_cart(uuid, int, int)
  to authenticated;
