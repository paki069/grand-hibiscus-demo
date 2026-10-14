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
  if exists (
    select 1 from public.entitlements e
    where e.parent_entitlement_id = p_hotel_entitlement
      and e.service_type = 'restaurant'
      and e.status = 'held'
      and (e.starts_at at time zone public.hotel_tz())::date = p_date
  ) then
    raise exception 'dining_already_set_up';
  end if;

  v_ent := public.add_restaurant_to_cart(p_table, p_seats, p_date, p_time, p_adults, p_children);
  update public.entitlements
  set parent_entitlement_id = p_hotel_entitlement
  where id = v_ent and reservation_id = v_res and service_type = 'restaurant';
  if not found then raise exception 'cart_item_not_found'; end if;
  perform public._refresh_room_early_checkin(p_hotel_entitlement);
  return v_ent;
end $$;

create function public.restaurant_room_availability(
  p_hotel_entitlement uuid,
  p_date date,
  p_time time
) returns table (table_id uuid, taken boolean, taken_seat_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  perform public._cart_hotel_reservation(p_hotel_entitlement);
  return query
    with w as (
      select public.local_ts(p_date, p_time) as s,
             public.local_ts(p_date, p_time) + make_interval(mins => (
               select dwell_minutes from public.restaurant_config where id = 1
             )) as e
    )
    select t.id, coalesce(bool_or(tr.seat_id is null) filter (where tr.id is not null), false),
           coalesce(array_agg(tr.seat_id) filter (where tr.seat_id is not null), '{}')
    from public.seating_tables t
    cross join w
    left join public.table_reservations tr
      on tr.table_id = t.id
      and tr.status <> 'released'
      and tr.during && tstzrange(w.s, w.e, '[)')
      and public._blocking(tr.entitlement_id)
      and not exists (
        select 1 from public.entitlements e
        where e.id = tr.entitlement_id and e.parent_entitlement_id = p_hotel_entitlement
      )
    where t.active
    group by t.id;
end $$;

create function public.update_restaurant_dates_for_room_cart(
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
  v_res uuid;
  v_room public.entitlements;
  v_ids uuid[] := '{}';
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
  if coalesce(cardinality(p_dates), 0) <> coalesce(cardinality(p_times), 0)
     or (select count(distinct d) from unnest(coalesce(p_dates, '{}')) as dates(d)) <> coalesce(cardinality(p_dates), 0) then
    raise exception 'invalid_dates';
  end if;
  if coalesce(cardinality(p_dates), 0) > 0 and p_table is null then
    raise exception 'table_unavailable';
  end if;

  delete from public.entitlements
  where reservation_id = v_res
    and parent_entitlement_id = p_hotel_entitlement
    and service_type = 'restaurant'
    and status = 'held';

  if coalesce(cardinality(p_dates), 0) = 0 then
    delete from public.cart_service_interests
    where reservation_id = v_res
      and hotel_entitlement_id = p_hotel_entitlement
      and service_type = 'restaurant';
  else
    v_ids := public.add_restaurant_dates_to_room_cart(
      p_hotel_entitlement, p_table, p_seats, p_dates, p_times, p_adults, p_children
    );
  end if;

  perform public._refresh_room_early_checkin(p_hotel_entitlement);
  return v_ids;
end $$;

revoke execute on function public.restaurant_room_availability(uuid, date, time),
  public.update_restaurant_dates_for_room_cart(uuid, uuid, uuid[], date[], time[], int, int)
  from public, anon;
grant execute on function public.restaurant_room_availability(uuid, date, time),
  public.update_restaurant_dates_for_room_cart(uuid, uuid, uuid[], date[], time[], int, int)
  to authenticated;
