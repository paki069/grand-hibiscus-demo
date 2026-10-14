alter table public.restaurant_config
  drop constraint if exists restaurant_config_slot_minutes_check;

update public.restaurant_config
set slot_minutes = 60
where id = 1;

alter table public.restaurant_config
  add constraint restaurant_config_slot_minutes_check check (slot_minutes = 60);

alter table public.restaurant_config
  alter column slot_minutes set default 60;

create or replace function public.add_restaurant_to_room_cart(
  p_hotel_entitlement uuid,
  p_table uuid,
  p_seats uuid[],
  p_date date,
  p_time time,
  p_adults int,
  p_children int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_room public.entitlements;
  v_res uuid;
  v_ent uuid;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  perform public.release_expired_holds();
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  select * into v_room
  from public.entitlements
  where id = p_hotel_entitlement and service_type = 'hotel'
  for update;
  if not found then raise exception 'room_not_in_cart'; end if;

  if p_adults is distinct from v_room.adults or p_children is distinct from v_room.children then
    raise exception 'guest_count_mismatch';
  end if;
  if p_date is null or p_date < (v_room.meta ->> 'checkin')::date
     or p_date >= (v_room.meta ->> 'checkout')::date then
    raise exception 'date_outside_room_stay';
  end if;

  v_ent := public.add_restaurant_to_cart(p_table, p_seats, p_date, p_time, p_adults, p_children);
  update public.entitlements
  set parent_entitlement_id = p_hotel_entitlement
  where id = v_ent and reservation_id = v_res and service_type = 'restaurant';
  if not found then raise exception 'cart_item_not_found'; end if;
  perform public._refresh_room_early_checkin(p_hotel_entitlement);
  return v_ent;
end $$;

create function public.add_restaurant_dates_to_room_cart(
  p_hotel_entitlement uuid,
  p_table uuid,
  p_seats uuid[],
  p_dates date[],
  p_times time[],
  p_adults int,
  p_children int
) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  v_room public.entitlements;
  v_ids uuid[] := '{}';
  v_ent uuid;
  i int;
begin
  if coalesce(cardinality(p_dates), 0) = 0
     or cardinality(p_dates) <> cardinality(p_times)
     or (select count(distinct d) from unnest(p_dates) as dates(d)) <> cardinality(p_dates) then
    raise exception 'invalid_dates';
  end if;

  perform public._cart_hotel_reservation(p_hotel_entitlement);
  select * into v_room
  from public.entitlements
  where id = p_hotel_entitlement and service_type = 'hotel'
  for update;
  if not found then raise exception 'room_not_in_cart'; end if;

  if p_adults is distinct from v_room.adults or p_children is distinct from v_room.children then
    raise exception 'guest_count_mismatch';
  end if;

  for i in 1..cardinality(p_dates) loop
    if p_dates[i] < (v_room.meta ->> 'checkin')::date
       or p_dates[i] >= (v_room.meta ->> 'checkout')::date then
      raise exception 'date_outside_room_stay';
    end if;
    if p_times[i] is null then raise exception 'invalid_time'; end if;

    v_ent := public.add_restaurant_to_room_cart(
      p_hotel_entitlement, p_table, p_seats, p_dates[i], p_times[i], p_adults, p_children
    );
    v_ids := array_append(v_ids, v_ent);
  end loop;

  return v_ids;
end $$;

revoke execute on function public.add_restaurant_dates_to_room_cart(uuid, uuid, uuid[], date[], time[], int, int)
  from public, anon;
grant execute on function public.add_restaurant_dates_to_room_cart(uuid, uuid, uuid[], date[], time[], int, int)
  to authenticated;
