alter table public.entitlements
  add column parent_entitlement_id uuid references public.entitlements (id) on delete cascade,
  add constraint entitlements_parent_not_self check (parent_entitlement_id is null or parent_entitlement_id <> id);

update public.entitlements child
set parent_entitlement_id = (
  select room.id
  from public.entitlements room
  where room.reservation_id = child.reservation_id
    and room.service_type = 'hotel'
  order by room.created_at, room.id
  limit 1
)
where child.service_type <> 'hotel'
  and (select count(*) from public.entitlements room
       where room.reservation_id = child.reservation_id and room.service_type = 'hotel') = 1;

alter table public.cart_service_interests
  add column hotel_entitlement_id uuid references public.entitlements (id) on delete cascade;

update public.cart_service_interests interest
set hotel_entitlement_id = (
  select room.id
  from public.entitlements room
  where room.reservation_id = interest.reservation_id
    and room.service_type = 'hotel'
  order by room.created_at, room.id
  limit 1
)
where (select count(*) from public.entitlements room
       where room.reservation_id = interest.reservation_id and room.service_type = 'hotel') = 1;

alter table public.cart_service_interests drop constraint cart_service_interests_pkey;
create unique index cart_service_interests_room_unique
  on public.cart_service_interests (reservation_id, hotel_entitlement_id, service_type)
  where hotel_entitlement_id is not null;
create unique index cart_service_interests_general_unique
  on public.cart_service_interests (reservation_id, service_type)
  where hotel_entitlement_id is null;

drop function public.set_cart_service_interest(text, boolean);
create function public.set_cart_service_interest(p_service_type text, p_enabled boolean, p_hotel_entitlement uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cart uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_service_type is null or p_service_type not in ('restaurant', 'spa', 'event') then
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
  if exists (select 1 from unnest(v_interests) as interests(value) where value is null or value not in ('restaurant', 'spa', 'event')) then
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

create function public._cart_hotel_reservation(p_hotel_entitlement uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_res uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select e.reservation_id into v_res
  from public.entitlements e
  join public.reservations r on r.id = e.reservation_id
  where e.id = p_hotel_entitlement and e.service_type = 'hotel'
    and e.status = 'held' and e.hold_expires_at > now()
    and r.customer_id = auth.uid() and r.status = 'cart';
  if v_res is null then raise exception 'room_not_in_cart'; end if;
  return v_res;
end $$;

create function public.add_restaurant_to_room_cart(
  p_hotel_entitlement uuid, p_table uuid, p_seats uuid[], p_date date, p_time time, p_adults int, p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_res uuid; v_ent uuid;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  v_ent := public.add_restaurant_to_cart(p_table, p_seats, p_date, p_time, p_adults, p_children);
  update public.entitlements set parent_entitlement_id = p_hotel_entitlement
  where id = v_ent and reservation_id = v_res and service_type = 'restaurant';
  if not found then raise exception 'cart_item_not_found'; end if;
  return v_ent;
end $$;

create function public.add_spa_to_room_cart(
  p_hotel_entitlement uuid, p_service uuid, p_start timestamptz, p_adults int, p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_res uuid; v_ent uuid;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  v_ent := public.add_spa_to_cart(p_service, p_start, p_adults, p_children);
  update public.entitlements set parent_entitlement_id = p_hotel_entitlement
  where id = v_ent and reservation_id = v_res and service_type = 'spa';
  if not found then raise exception 'cart_item_not_found'; end if;
  return v_ent;
end $$;

create function public.add_event_to_room_cart(
  p_hotel_entitlement uuid, p_event uuid, p_adults int, p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_res uuid; v_ent uuid;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  v_ent := public.add_event_to_cart(p_event, p_adults, p_children);
  update public.entitlements set parent_entitlement_id = p_hotel_entitlement
  where id = v_ent and reservation_id = v_res and service_type = 'event';
  if not found then raise exception 'cart_item_not_found'; end if;
  return v_ent;
end $$;

revoke execute on function public.set_cart_service_interest(text, boolean, uuid),
  public._cart_hotel_reservation(uuid),
  public.add_restaurant_to_room_cart(uuid, uuid, uuid[], date, time, int, int),
  public.add_spa_to_room_cart(uuid, uuid, timestamptz, int, int),
  public.add_event_to_room_cart(uuid, uuid, int, int)
  from public, anon;
grant execute on function public.set_cart_service_interest(text, boolean, uuid),
  public.add_restaurant_to_room_cart(uuid, uuid, uuid[], date, time, int, int),
  public.add_spa_to_room_cart(uuid, uuid, timestamptz, int, int),
  public.add_event_to_room_cart(uuid, uuid, int, int)
  to authenticated;
