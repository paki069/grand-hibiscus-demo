alter table public.events
  add column if not exists available_from date,
  add column if not exists available_until date,
  add column if not exists departure_start time,
  add column if not exists departure_end time;

alter table public.events
  drop constraint if exists events_bookable_requires_schedule,
  drop constraint if exists events_availability_window_check,
  drop constraint if exists events_departure_time_check;

alter table public.events
  add constraint events_availability_window_check
    check (
      (available_from is null and available_until is null)
      or (available_from is not null and available_until is not null and available_until >= available_from)
    ),
  add constraint events_departure_time_check
    check (
      (departure_start is null and departure_end is null)
      or (departure_start is not null and departure_end is not null and departure_end > departure_start)
    ),
  add constraint events_bookable_requires_schedule
    check (
      not booking_enabled
      or (starts_at is not null and ends_at is not null and ends_at > starts_at)
      or (available_from is not null and available_until is not null
        and departure_start is not null and departure_end is not null and departure_end > departure_start)
    );

alter table public.event_bookings
  add column if not exists booking_date date;

create index if not exists event_bookings_event_date_status_idx
  on public.event_bookings (event_id, booking_date, status);

create or replace view public.public_events as
  select e.id, e.title, e.description, e.photo_url, e.location, e.starts_at, e.ends_at, e.capacity,
         e.price, coalesce(e.child_price, e.price) as child_price, e.booking_enabled,
         p.name as provider_name, e.includes, e.sort_order,
         e.available_from, e.available_until, e.departure_start, e.departure_end
  from public.events e left join public.event_providers p on p.id = e.provider_id
  where e.active;

create or replace function public.add_event_to_cart(p_event uuid, p_adults int, p_children int)
returns uuid language plpgsql security definer set search_path = public as $$
declare ev public.events; s public.settings; v_cart uuid; v_qty int; v_ent uuid; v_taken int;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select * into ev from public.events where id = p_event and active and booking_enabled for update;
  if not found then raise exception 'event_unavailable'; end if;
  if ev.available_from is not null then raise exception 'event_date_required'; end if;
  if ev.starts_at <= now() then raise exception 'event_past'; end if;
  v_qty := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or v_qty > 20 then raise exception 'invalid_party'; end if;
  select coalesce(sum(qty), 0) into v_taken from public.event_bookings b where b.event_id = p_event and b.status <> 'released';
  if ev.capacity is not null and v_taken + v_qty > ev.capacity then raise exception 'event_full'; end if;
  insert into public.entitlements (reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
      adults, children, total, meta, status, hold_expires_at)
  values (v_cart, 'event', ev.title, v_qty || ' guest' || case when v_qty > 1 then 's' else '' end,
      ev.starts_at, ev.ends_at, ev.starts_at - interval '1 hour', ev.ends_at, p_adults, p_children,
      ev.price * p_adults + coalesce(ev.child_price, ev.price) * p_children,
      jsonb_build_object('event_id', ev.id, 'location', ev.location), 'held', now() + make_interval(mins => s.hold_minutes))
  returning id into v_ent;
  insert into public.event_bookings (entitlement_id, event_id, qty) values (v_ent, p_event, v_qty);
  return v_ent;
end $$;

create function public.add_event_to_room_cart(
  p_hotel_entitlement uuid, p_event uuid, p_tour_date date, p_adults int, p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_res uuid;
  v_room public.entitlements;
  v_event public.events;
  v_settings public.settings;
  v_checkin date;
  v_checkout date;
  v_qty int;
  v_taken int;
  v_start timestamptz;
  v_end timestamptz;
  v_ent uuid;
begin
  perform public.release_expired_holds();
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  select * into v_room from public.entitlements
    where id = p_hotel_entitlement and reservation_id = v_res and service_type = 'hotel';
  if not found then raise exception 'room_not_in_cart'; end if;

  v_checkin := (v_room.meta ->> 'checkin')::date;
  v_checkout := (v_room.meta ->> 'checkout')::date;
  if p_tour_date is null or p_tour_date < v_checkin or p_tour_date >= v_checkout then
    raise exception 'event_date_outside_stay';
  end if;

  select * into v_settings from public.settings where id = 1;
  select * into v_event from public.events
    where id = p_event and active and booking_enabled for update;
  if not found then raise exception 'event_unavailable'; end if;
  if v_event.available_from is null or v_event.available_until is null
     or v_event.departure_start is null or v_event.departure_end is null
     or p_tour_date < v_event.available_from or p_tour_date > v_event.available_until then
    raise exception 'event_date_unavailable';
  end if;

  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0
     or p_adults + p_children > 20 then
    raise exception 'invalid_party';
  end if;
  if p_adults > v_room.adults or p_children > v_room.children then
    raise exception 'event_guest_count_exceeds_room';
  end if;

  v_start := (p_tour_date + v_event.departure_start) at time zone v_settings.timezone;
  v_end := (p_tour_date + v_event.departure_end) at time zone v_settings.timezone;
  if v_start <= now() then raise exception 'event_past'; end if;

  select coalesce(sum(qty), 0)::int into v_taken
    from public.event_bookings
    where event_id = p_event and booking_date = p_tour_date and status <> 'released';
  v_qty := p_adults + p_children;
  if v_event.capacity is not null and v_taken + v_qty > v_event.capacity then
    raise exception 'event_full';
  end if;

  insert into public.entitlements (
    reservation_id, parent_entitlement_id, service_type, title, detail, starts_at, ends_at,
    eligible_from, eligible_until, adults, children, total, meta, status, hold_expires_at
  ) values (
    v_res, p_hotel_entitlement, 'event', v_event.title,
    v_qty || ' guest' || case when v_qty > 1 then 's' else '' end
      || case when v_event.location = '' then '' else ' · ' || v_event.location end,
    v_start, v_end, v_start - interval '1 hour', v_end, p_adults, p_children,
    v_event.price * p_adults + coalesce(v_event.child_price, v_event.price) * p_children,
    jsonb_build_object('event_id', v_event.id, 'location', v_event.location, 'tour_date', p_tour_date),
    'held', now() + make_interval(mins => v_settings.hold_minutes)
  ) returning id into v_ent;

  insert into public.event_bookings (entitlement_id, event_id, qty, booking_date)
    values (v_ent, p_event, v_qty, p_tour_date);
  return v_ent;
end $$;

revoke all on function public.add_event_to_room_cart(uuid, uuid, date, int, int) from public, anon;
grant execute on function public.add_event_to_room_cart(uuid, uuid, date, int, int) to authenticated;
