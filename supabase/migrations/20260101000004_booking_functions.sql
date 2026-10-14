-- Booking logic. All writes are transactional SECURITY DEFINER functions; exclusion constraints
-- and row locks guarantee that two concurrent callers can never claim the same room/seat/slot.

-- Hold semantics: an entitlement blocks inventory when 'active', or when 'held' and not yet expired.
create function public._blocking(p_ent uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.entitlements e where e.id = p_ent
    and (e.status = 'active' or (e.status = 'held' and e.hold_expires_at > now())))
$$;

-- Releases abandoned holds (checkout never completed) and frees the underlying resources.
create function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  with ex as (
    update public.entitlements set status = 'expired'
    where status = 'held' and hold_expires_at < now() returning id)
  select coalesce(array_agg(id), '{}') into ids from ex;
  if cardinality(ids) = 0 then return 0; end if;
  update public.room_stays set status = 'released' where entitlement_id = any (ids);
  update public.table_reservations set status = 'released' where entitlement_id = any (ids);
  update public.spa_appointments set status = 'released' where entitlement_id = any (ids);
  update public.event_bookings set status = 'released' where entitlement_id = any (ids);
  return cardinality(ids);
end $$;

create function public._release_resources(p_res uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into ids from public.entitlements
   where reservation_id = p_res and status in ('cancelled','refunded','expired');
  update public.room_stays set status = 'released' where entitlement_id = any (ids);
  update public.table_reservations set status = 'released' where entitlement_id = any (ids);
  update public.spa_appointments set status = 'released' where entitlement_id = any (ids);
  update public.event_bookings set status = 'released' where entitlement_id = any (ids);
end $$;

create function public._cart_id() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; p public.profiles; s public.settings;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = auth.uid() and active;
  if not found then raise exception 'not_authenticated'; end if;
  select id into v from public.reservations where customer_id = auth.uid() and status = 'cart';
  if v is null then
    select * into s from public.settings where id = 1;
    insert into public.reservations (customer_id, first_name, last_name, email, phone, currency)
    values (auth.uid(), p.first_name, p.last_name, coalesce(p.email, ''), p.phone, s.currency)
    on conflict do nothing returning id into v;
    if v is null then select id into v from public.reservations where customer_id = auth.uid() and status = 'cart'; end if;
  end if;
  return v;
end $$;

-- ───────────── HOTEL ─────────────
create function public._room_total(p_type uuid, p_in date, p_out date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(
    (select o.rate from public.room_rate_overrides o where o.room_type_id = rt.id and d::date <@ o.during limit 1),
    rt.base_rate)), 0)
  from public.room_types rt, generate_series(p_in::timestamp, (p_out - 1)::timestamp, interval '1 day') d
  where rt.id = p_type
$$;

create function public._free_room(p_type uuid, p_in date, p_out date) returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.rooms r
  where r.room_type_id = p_type and r.active
    and not exists (select 1 from public.room_stays rs
                    where rs.room_id = r.id and rs.status <> 'released' and rs.stay && daterange(p_in, p_out, '[)')
                      and public._blocking(rs.entitlement_id))
    and not exists (select 1 from public.room_blocks b where b.room_id = r.id and b.during && daterange(p_in, p_out, '[)'))
  order by r.number limit 1
$$;

create function public.room_type_availability(p_in date, p_out date)
returns table (room_type_id uuid, rooms_available int, total numeric)
language sql stable security definer set search_path = public as $$
  select rt.id,
    (select count(*)::int from public.rooms r where r.room_type_id = rt.id and r.active
       and not exists (select 1 from public.room_stays rs where rs.room_id = r.id and rs.status <> 'released'
                       and rs.stay && daterange(p_in, p_out, '[)') and public._blocking(rs.entitlement_id))
       and not exists (select 1 from public.room_blocks b where b.room_id = r.id and b.during && daterange(p_in, p_out, '[)'))),
    public._room_total(rt.id, p_in, p_out)
  from public.room_types rt where rt.active and p_out > p_in
$$;

create function public.add_room_to_cart(p_room_type uuid, p_checkin date, p_checkout date,
  p_adults int, p_children int, p_addons uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare rt public.room_types; s public.settings; v_cart uuid; v_room uuid; v_nights int; v_rate numeric;
  v_addons numeric := 0; v_meta jsonb := '[]'; v_ent uuid; a public.room_addons; v_line numeric; n int := 0;
  v_room_no text;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  -- Serialize bookings per room type so concurrent callers cannot be handed the same room.
  select * into rt from public.room_types where id = p_room_type and active for update;
  if not found then raise exception 'room_type_unavailable'; end if;
  if p_checkin is null or p_checkout is null or p_checkin < (now() at time zone s.timezone)::date or p_checkout <= p_checkin then
    raise exception 'invalid_dates'; end if;
  v_nights := p_checkout - p_checkin;
  if v_nights < rt.min_nights or v_nights > rt.max_nights then raise exception 'stay_length_not_allowed'; end if;
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or p_adults > rt.max_adults
     or p_children > rt.max_children or p_adults + p_children > rt.max_occupancy then
    raise exception 'occupancy_exceeded'; end if;
  v_room := public._free_room(rt.id, p_checkin, p_checkout);
  if v_room is null then raise exception 'sold_out'; end if;
  v_rate := public._room_total(rt.id, p_checkin, p_checkout);

  p_addons := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_addons, '{}')) x);
  for a in select * from public.room_addons where id = any (p_addons) loop
    if not a.active or (a.room_type_id is not null and a.room_type_id <> rt.id) then raise exception 'addon_unavailable'; end if;
    v_line := case a.pricing when 'per_night' then a.price * v_nights
                             when 'per_guest' then a.price * (p_adults + p_children) else a.price end;
    v_addons := v_addons + v_line; n := n + 1;
    v_meta := v_meta || jsonb_build_array(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'price', v_line));
  end loop;
  if n <> cardinality(p_addons) then raise exception 'addon_unavailable'; end if;
  select number into v_room_no from public.rooms where id = v_room;

  insert into public.entitlements (reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
      adults, children, total, meta, status, hold_expires_at)
  values (v_cart, 'hotel', rt.name, v_nights || ' night' || case when v_nights > 1 then 's' else '' end,
      public.local_ts(p_checkin, s.checkin_time), public.local_ts(p_checkout, s.checkout_time),
      public.local_ts(p_checkin, '00:00'), public.local_ts(p_checkout, s.checkout_time),
      p_adults, p_children, v_rate + v_addons,
      jsonb_build_object('room_type_id', rt.id, 'room_number', v_room_no, 'checkin', p_checkin, 'checkout', p_checkout,
                         'nights', v_nights, 'room_total', v_rate, 'addons', v_meta),
      'held', now() + make_interval(mins => s.hold_minutes))
  returning id into v_ent;
  begin
    insert into public.room_stays (entitlement_id, room_id, stay) values (v_ent, v_room, daterange(p_checkin, p_checkout, '[)'));
  exception when exclusion_violation then raise exception 'sold_out';
  end;
  return v_ent;
end $$;

-- ───────────── RESTAURANT ─────────────
create function public.restaurant_availability(p_date date, p_time time)
returns table (table_id uuid, taken boolean, taken_seat_ids uuid[])
language sql stable security definer set search_path = public as $$
  with w as (select public.local_ts(p_date, p_time) as s,
                    public.local_ts(p_date, p_time) + make_interval(mins => (select dwell_minutes from public.restaurant_config where id = 1)) as e)
  select t.id, coalesce(bool_or(tr.seat_id is null), false),
         coalesce(array_agg(tr.seat_id) filter (where tr.seat_id is not null), '{}')
  from public.seating_tables t cross join w
  left join public.table_reservations tr on tr.table_id = t.id and tr.status <> 'released'
       and tr.during && tstzrange(w.s, w.e, '[)') and public._blocking(tr.entitlement_id)
  where t.active group by t.id
$$;

create function public.add_restaurant_to_cart(p_table uuid, p_seats uuid[], p_date date, p_time time,
  p_adults int, p_children int, p_preorder jsonb default '[]')
returns uuid language plpgsql security definer set search_path = public as $$
declare cfg public.restaurant_config; s public.settings; t public.seating_tables; ar public.seating_areas;
  v_cart uuid; v_start timestamptz; v_end timestamptz; v_during tstzrange; v_party int; v_ent uuid;
  m numeric; seat_labels text[]; v_order uuid; v_total numeric := 0; it record; prod public.menu_products; qty int; seat uuid;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into cfg from public.restaurant_config where id = 1;
  select * into s from public.settings where id = 1;
  v_party := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 then raise exception 'invalid_party'; end if;
  if p_date is null or p_time is null or p_date < (now() at time zone s.timezone)::date
     or extract(dow from p_date)::int = any (cfg.closed_weekdays) then raise exception 'invalid_date'; end if;
  m := extract(epoch from p_time) / 60;
  if m < extract(epoch from cfg.open_time) / 60 or m + cfg.dwell_minutes > extract(epoch from cfg.close_time) / 60
     or mod((m - extract(epoch from cfg.open_time) / 60)::int, cfg.slot_minutes) <> 0 then raise exception 'invalid_time'; end if;
  v_start := public.local_ts(p_date, p_time);
  if v_start <= now() then raise exception 'invalid_time'; end if;
  v_end := v_start + make_interval(mins => cfg.dwell_minutes);
  v_during := tstzrange(v_start, v_end, '[)');

  -- Lock the table row: all bookings of this table are serialized from here.
  select * into t from public.seating_tables where id = p_table and active for update;
  if not found then raise exception 'table_unavailable'; end if;
  select * into ar from public.seating_areas where id = t.area_id and active;
  if not found then raise exception 'table_unavailable'; end if;

  if p_seats is not null and cardinality(p_seats) > 0 then
    if not t.seat_selectable then raise exception 'seats_not_selectable'; end if;
    if cardinality(p_seats) <> v_party or (select count(distinct x) from unnest(p_seats) x) <> v_party
       or (select count(*) from public.seats where id = any (p_seats) and table_id = t.id and active) <> v_party then
      raise exception 'invalid_seats'; end if;
    select array_agg(label order by label) into seat_labels from public.seats where id = any (p_seats);
  else
    if t.seat_selectable then raise exception 'seats_required'; end if;
    if v_party > t.capacity or v_party < t.min_party then raise exception 'party_size_not_allowed'; end if;
    p_seats := null;
  end if;

  if exists (select 1 from public.table_reservations tr
             where tr.table_id = t.id and tr.status <> 'released' and tr.during && v_during and public._blocking(tr.entitlement_id)
               and (p_seats is null or tr.seat_id is null or tr.seat_id = any (p_seats))) then
    raise exception 'slot_taken'; end if;

  insert into public.entitlements (reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
      adults, children, total, meta, status, hold_expires_at)
  values (v_cart, 'restaurant', 'Table ' || t.label || ' · ' || ar.name,
      'Party of ' || v_party || case when seat_labels is not null then ' · seats ' || array_to_string(seat_labels, ', ') else '' end,
      v_start, v_end, v_start - interval '30 minutes', v_end, p_adults, p_children, cfg.deposit_per_guest * v_party,
      jsonb_build_object('table_id', t.id, 'table_label', t.label, 'area', ar.name, 'party_size', v_party,
                         'seats', coalesce(to_jsonb(seat_labels), '[]'::jsonb)),
      'held', now() + make_interval(mins => s.hold_minutes))
  returning id into v_ent;
  begin
    if p_seats is null then
      insert into public.table_reservations (entitlement_id, table_id, during, party_size) values (v_ent, t.id, v_during, v_party);
    else
      foreach seat in array p_seats loop
        insert into public.table_reservations (entitlement_id, table_id, seat_id, during, party_size) values (v_ent, t.id, seat, v_during, 1);
      end loop;
    end if;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;

  if jsonb_typeof(coalesce(p_preorder, '[]')) = 'array' and jsonb_array_length(coalesce(p_preorder, '[]')) > 0 then
    insert into public.menu_orders (reservation_id, entitlement_id) values (v_cart, v_ent) returning id into v_order;
    for it in select value from jsonb_array_elements(p_preorder) loop
      qty := (it.value ->> 'qty')::int;
      select * into prod from public.menu_products where id = (it.value ->> 'product_id')::uuid and active and available;
      if not found or qty is null or qty < 1 or qty > 50 then raise exception 'product_unavailable'; end if;
      insert into public.menu_order_items (order_id, product_id, name, unit_price, qty) values (v_order, prod.id, prod.name, prod.price, qty);
      v_total := v_total + prod.price * qty;
    end loop;
    update public.menu_orders set total = v_total where id = v_order;
  end if;
  return v_ent;
end $$;

-- ───────────── SPA ─────────────
create function public._spa_conflict(p_res uuid, p_range tstzrange) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.spa_appointments a
                 where a.resource_id = p_res and a.status <> 'released' and a.during && p_range and public._blocking(a.entitlement_id))
$$;

create function public.spa_free_resources(p_service uuid, p_start timestamptz) returns setof uuid
language sql stable security definer set search_path = public as $$
  with svc as (select duration_min, buffer_min from public.spa_services where id = p_service and active),
       loc as (select (p_start at time zone public.hotel_tz())::date as d)
  select r.id from public.spa_resources r
  join public.spa_service_resources sr on sr.resource_id = r.id and sr.service_id = p_service
  cross join svc cross join loc
  where r.active
    and exists (select 1 from public.spa_schedules sc
                where sc.resource_id = r.id and sc.weekday = extract(dow from loc.d)::int
                  and p_start >= public.local_ts(loc.d, sc.start_time)
                  and p_start + make_interval(mins => svc.duration_min) <= public.local_ts(loc.d, sc.end_time)
                  and mod((extract(epoch from p_start - public.local_ts(loc.d, sc.start_time)) / 60)::int, sc.slot_minutes) = 0)
    and not public._spa_conflict(r.id, tstzrange(p_start, p_start + make_interval(mins => svc.duration_min + svc.buffer_min), '[)'))
  order by r.name
$$;

create function public.spa_available_slots(p_service uuid, p_date date)
returns table (slot_start timestamptz) language sql stable security definer set search_path = public as $$
  select distinct g from public.spa_services svc
  join public.spa_service_resources sr on sr.service_id = svc.id
  join public.spa_schedules sc on sc.resource_id = sr.resource_id and sc.weekday = extract(dow from p_date)::int
  cross join lateral generate_series(public.local_ts(p_date, sc.start_time),
        public.local_ts(p_date, sc.end_time) - make_interval(mins => svc.duration_min), make_interval(mins => sc.slot_minutes)) g
  where svc.id = p_service and svc.active and g > now()
    and exists (select 1 from public.spa_free_resources(p_service, g))
  order by 1
$$;

create function public.add_spa_to_cart(p_service uuid, p_start timestamptz, p_adults int, p_children int)
returns uuid language plpgsql security definer set search_path = public as $$
declare svc public.spa_services; s public.settings; v_cart uuid; v_res uuid; v_ent uuid; v_range tstzrange; v_guests int;
  v_end timestamptz; v_done boolean := false; v_rname text;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select * into svc from public.spa_services where id = p_service and active;
  if not found then raise exception 'service_unavailable'; end if;
  v_guests := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or v_guests > svc.max_guests then raise exception 'invalid_party'; end if;
  if p_start is null or p_start <= now() then raise exception 'invalid_time'; end if;
  v_range := tstzrange(p_start, p_start + make_interval(mins => svc.duration_min + svc.buffer_min), '[)');
  v_end := p_start + make_interval(mins => svc.duration_min);

  for v_res in select * from public.spa_free_resources(p_service, p_start) loop
    perform 1 from public.spa_resources where id = v_res for update;           -- serialize on the resource
    if public._spa_conflict(v_res, v_range) then continue; end if;             -- re-check after the lock
    select name into v_rname from public.spa_resources where id = v_res;
    insert into public.entitlements (reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
        adults, children, total, meta, status, hold_expires_at)
    values (v_cart, 'spa', svc.name, svc.duration_min || ' min' || case when v_guests > 1 then ' · ' || v_guests || ' guests' else '' end,
        p_start, v_end, p_start - interval '30 minutes', v_end, p_adults, p_children, coalesce(svc.price, 0) * v_guests,
        jsonb_build_object('service_id', svc.id, 'resource', v_rname, 'price_configured', svc.price is not null),
        'held', now() + make_interval(mins => s.hold_minutes))
    returning id into v_ent;
    begin
      insert into public.spa_appointments (entitlement_id, service_id, resource_id, during) values (v_ent, svc.id, v_res, v_range);
      v_done := true; exit;
    exception when exclusion_violation then
      delete from public.entitlements where id = v_ent;
    end;
  end loop;
  if not v_done then raise exception 'slot_taken'; end if;
  return v_ent;
end $$;

-- ───────────── EVENTS ─────────────
create function public.add_event_to_cart(p_event uuid, p_adults int, p_children int)
returns uuid language plpgsql security definer set search_path = public as $$
declare ev public.events; s public.settings; v_cart uuid; v_qty int; v_ent uuid; v_taken int;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select * into ev from public.events where id = p_event and active and booking_enabled for update; -- lock = capacity serialization
  if not found then raise exception 'event_unavailable'; end if;
  if ev.starts_at <= now() then raise exception 'event_past'; end if;
  v_qty := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or v_qty > 20 then raise exception 'invalid_party'; end if;
  select coalesce(sum(qty), 0) into v_taken from public.event_bookings b where b.event_id = ev.id and b.status <> 'released';
  if ev.capacity is not null and v_taken + v_qty > ev.capacity then raise exception 'event_full'; end if;
  insert into public.entitlements (reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
      adults, children, total, meta, status, hold_expires_at)
  values (v_cart, 'event', ev.title, v_qty || ' guest' || case when v_qty > 1 then 's' else '' end,
      ev.starts_at, ev.ends_at, ev.starts_at - interval '1 hour', ev.ends_at, p_adults, p_children,
      ev.price * p_adults + coalesce(ev.child_price, ev.price) * p_children,
      jsonb_build_object('event_id', ev.id, 'location', ev.location), 'held', now() + make_interval(mins => s.hold_minutes))
  returning id into v_ent;
  insert into public.event_bookings (entitlement_id, event_id, qty) values (v_ent, ev.id, v_qty);
  return v_ent;
end $$;

create function public.remove_cart_item(p_ent uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.entitlements e using public.reservations r
   where e.id = p_ent and r.id = e.reservation_id and r.customer_id = auth.uid() and r.status = 'cart';
  if not found then raise exception 'not_found'; end if;
end $$;

-- ───────────── PASSES ─────────────
create function public._issue_pass(p_res uuid, p_reason text default 'reissued') returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  update public.qr_passes set status = 'revoked', revoked_at = now(), revoked_reason = p_reason where reservation_id = p_res and status = 'active';
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- 244 random bits, no personal data
  insert into public.qr_passes (reservation_id, token) values (p_res, v_token);
  perform public.log_audit('pass.issued', 'reservation', p_res::text, '{}');
  return v_token;
end $$;

create function public._confirm_internal(p_res uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.reservations set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now())
   where id = p_res and status in ('pending', 'confirmed');
  if not found then raise exception 'invalid_status'; end if;
  if not exists (select 1 from public.qr_passes where reservation_id = p_res and status = 'active') then
    perform public._issue_pass(p_res, 'issued');
  end if;
end $$;

create function public._cancel_internal(p_res uuid, p_reason text, p_ent_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.entitlements set status = p_ent_status
   where reservation_id = p_res and status in ('held', 'active') and checked_in_at is null;
  perform public._release_resources(p_res);
  update public.qr_passes set status = 'revoked', revoked_at = now(), revoked_reason = p_reason
   where reservation_id = p_res and status = 'active';
  update public.reservations set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_res;
end $$;

create function public.reissue_pass(p_res uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r public.reservations;
begin
  select * into r from public.reservations where id = p_res;
  if not found or (r.customer_id <> auth.uid() and not public.is_admin()) then raise exception 'forbidden'; end if;
  if r.status <> 'confirmed' then raise exception 'invalid_status'; end if;
  return public._issue_pass(p_res, 'reissued');
end $$;

-- ───────────── CHECKOUT & PAYMENTS ─────────────
create function public.checkout_cart(p_first text, p_last text, p_email text, p_phone text, p_method text, p_notes text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cart uuid; s public.settings; v_sub numeric; v_tax numeric; v_fee numeric; v_total numeric; pm jsonb;
  n int; bad int; v_status public.reservation_status; v_pay text; v_pid uuid; r public.reservations;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select count(*) filter (where status = 'held'), count(*) filter (where status <> 'held') into n, bad
    from public.entitlements where reservation_id = v_cart;
  if bad > 0 then raise exception 'cart_items_expired'; end if;
  if n = 0 then raise exception 'cart_empty'; end if;
  if length(trim(coalesce(p_first, ''))) < 1 or length(trim(coalesce(p_last, ''))) < 1
     or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(trim(coalesce(p_phone, ''))) < 5 then
    raise exception 'invalid_details'; end if;
  pm := s.payment_methods -> p_method;
  if pm is null or coalesce((pm ->> 'enabled')::boolean, false) is not true then raise exception 'payment_method_unavailable'; end if;
  if p_method = 'card' then raise exception 'card_not_configured'; end if; -- no card provider is wired in this build

  select coalesce(sum(total), 0) into v_sub from public.entitlements where reservation_id = v_cart;
  v_sub := v_sub + coalesce((select sum(total) from public.menu_orders where reservation_id = v_cart), 0);
  v_tax := round(v_sub * s.tax_rate / 100, 2);
  v_fee := round(v_sub * s.service_fee_rate / 100, 2);
  v_total := v_sub + v_tax + v_fee;

  update public.entitlements set status = 'active', hold_expires_at = null where reservation_id = v_cart;
  update public.room_stays set status = 'confirmed' where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);
  update public.table_reservations set status = 'confirmed' where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);
  update public.spa_appointments set status = 'confirmed' where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);
  update public.event_bookings set status = 'confirmed' where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);

  if v_total = 0 then v_status := 'confirmed'; v_pay := 'paid';
  elsif p_method = 'bank_transfer' then v_status := 'pending'; v_pay := 'awaiting_receipt';
  elsif p_method = 'dev_test' then v_status := 'confirmed'; v_pay := 'paid';
  else v_status := 'confirmed'; v_pay := 'unpaid'; end if;

  update public.reservations set status = v_status, first_name = trim(p_first), last_name = trim(p_last), email = trim(p_email),
    phone = trim(p_phone), notes = left(coalesce(p_notes, ''), 1000), subtotal = v_sub, tax = v_tax, fees = v_fee, total = v_total,
    currency = s.currency, placed_at = now(), confirmed_at = case when v_status = 'confirmed' then now() end
   where id = v_cart returning * into r;
  insert into public.payments (reservation_id, method, status, amount, currency, paid_at, note)
  values (v_cart, p_method, v_pay, v_total, s.currency, case when v_pay = 'paid' then now() end,
          case when p_method = 'dev_test' then 'DEVELOPMENT-ONLY test payment. No money moved.' else '' end)
  returning id into v_pid;
  if v_status = 'confirmed' then perform public._issue_pass(v_cart, 'issued'); end if;
  perform public.log_audit('reservation.placed', 'reservation', v_cart::text, jsonb_build_object('method', p_method, 'total', v_total));
  return jsonb_build_object('reservation_id', v_cart, 'reference', r.reference, 'status', v_status, 'payment_status', v_pay);
end $$;

create function public.attach_receipt(p_res uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_path is null or p_path not like auth.uid()::text || '/' || p_res::text || '/%' then raise exception 'forbidden'; end if;
  update public.payments p set receipt_path = p_path, status = 'pending_verification'
   from public.reservations r
   where p.reservation_id = p_res and r.id = p.reservation_id and r.customer_id = auth.uid()
     and p.method = 'bank_transfer' and p.status in ('awaiting_receipt', 'pending_verification', 'failed');
  if not found then raise exception 'invalid_status'; end if;
  perform public.log_audit('receipt.uploaded', 'reservation', p_res::text, '{}');
end $$;

create function public.cancel_my_reservation(p_res uuid, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.reservations; s public.settings; v_first timestamptz; v_fee numeric := 0;
begin
  select * into r from public.reservations where id = p_res and customer_id = auth.uid();
  if not found or r.status not in ('pending', 'confirmed') then raise exception 'invalid_status'; end if;
  if exists (select 1 from public.entitlements where reservation_id = p_res and checked_in_at is not null) then
    raise exception 'already_used'; end if;
  select * into s from public.settings where id = 1;
  select min(starts_at) into v_first from public.entitlements where reservation_id = p_res;
  if v_first - make_interval(hours => s.free_cancel_hours) < now() then
    v_fee := round(r.total * s.late_cancel_fee_percent / 100, 2); end if;
  update public.reservations set cancellation_fee = v_fee where id = p_res;
  perform public._cancel_internal(p_res, coalesce(nullif(trim(p_reason), ''), 'Cancelled by guest'), 'cancelled');
  perform public.log_audit('reservation.cancelled_by_guest', 'reservation', p_res::text, jsonb_build_object('fee', v_fee));
  return jsonb_build_object('cancellation_fee', v_fee);
end $$;

create function public.admin_set_payment_status(p_payment uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare pay public.payments; r public.reservations;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('unpaid', 'awaiting_receipt', 'pending_verification', 'paid', 'failed') then raise exception 'invalid_status'; end if;
  select * into pay from public.payments where id = p_payment for update;
  if not found or pay.status in ('refunded', 'partially_refunded') then raise exception 'invalid_status'; end if;
  update public.payments set status = p_status, note = coalesce(nullif(p_note, ''), note),
      verified_by = auth.uid(), paid_at = case when p_status = 'paid' then now() else paid_at end where id = p_payment;
  select * into r from public.reservations where id = pay.reservation_id;
  if p_status = 'paid' and r.status = 'pending' then perform public._confirm_internal(r.id); end if;
end $$;

create function public.admin_set_reservation_status(p_res uuid, p_status public.reservation_status, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into r from public.reservations where id = p_res for update;
  if not found or r.status = 'cart' then raise exception 'invalid_status'; end if;
  if p_status = 'confirmed' then perform public._confirm_internal(p_res);
  elsif p_status = 'cancelled' then perform public._cancel_internal(p_res, coalesce(nullif(p_reason, ''), 'Cancelled by staff'), 'cancelled');
  elsif p_status in ('completed', 'pending') then update public.reservations set status = p_status where id = p_res;
  else raise exception 'invalid_status'; end if;
  perform public.log_audit('reservation.status', 'reservation', p_res::text, jsonb_build_object('from', r.status, 'to', p_status, 'reason', p_reason));
end $$;

create function public.refund_reservation(p_res uuid, p_amount numeric, p_reason text default '', p_cancel boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare pay public.payments; v_done numeric;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into pay from public.payments where reservation_id = p_res and status in ('paid', 'partially_refunded')
   order by created_at desc limit 1 for update;
  if not found then raise exception 'nothing_to_refund'; end if;
  select coalesce(sum(amount), 0) into v_done from public.refunds where payment_id = pay.id;
  if p_amount is null or p_amount <= 0 or v_done + p_amount > pay.amount then raise exception 'invalid_amount'; end if;
  insert into public.refunds (payment_id, amount, reason, created_by) values (pay.id, p_amount, coalesce(p_reason, ''), auth.uid());
  update public.payments set status = case when v_done + p_amount >= amount then 'refunded' else 'partially_refunded' end where id = pay.id;
  if p_cancel then
    perform public._cancel_internal(p_res, coalesce(nullif(p_reason, ''), 'Refunded'), 'refunded');
  end if;
end $$;

-- ───────────── SCANNING & CHECK-IN ─────────────
create function public._area_service(p_area text) returns public.service_type
language sql immutable as $$
  select case p_area when 'hotel' then 'hotel' when 'restaurant' then 'restaurant' when 'spa' then 'spa' when 'events' then 'event' end::public.service_type
$$;

create function public._ent_state(e public.entitlements, r public.reservations, pass public.qr_passes) returns text
language sql stable set search_path = public as $$
  select case
    when e.status = 'refunded' then 'refunded'
    when e.status in ('cancelled', 'expired') or r.status = 'cancelled' then 'cancelled'
    when pass.status = 'revoked' then 'revoked'
    when e.checked_in_at is not null then 'already_checked_in'
    when r.status not in ('confirmed', 'completed') then 'unconfirmed'
    when now() < e.eligible_from then 'not_yet_eligible'
    when now() > e.eligible_until then 'expired'
    else 'valid' end
$$;

create function public.scan_pass(p_token text, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pass public.qr_passes; r public.reservations; v_svc public.service_type; v_list jsonb; v_state text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where token = p_token;
  if not found then
    perform public.log_audit('scan.unknown', 'qr_pass', null, jsonb_build_object('area', p_area));
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into r from public.reservations where id = pass.reservation_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'detail', e.detail, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'adults', e.adults, 'children', e.children, 'meta', e.meta, 'checked_in_at', e.checked_in_at,
      'state', public._ent_state(e, r, pass)) order by e.starts_at), '[]')
    into v_list from public.entitlements e where e.reservation_id = r.id and e.service_type = v_svc;
  if jsonb_array_length(v_list) = 0 then v_state := 'no_service';
  elsif pass.status = 'revoked' then v_state := 'revoked';
  elsif exists (select 1 from jsonb_array_elements(v_list) x where x ->> 'state' = 'valid') then v_state := 'valid';
  else v_state := v_list -> 0 ->> 'state'; end if;
  return jsonb_build_object('state', v_state, 'area', p_area,
    'reservation', jsonb_build_object('reference', r.reference, 'guest', r.first_name || ' ' || r.last_name, 'status', r.status),
    'entitlements', v_list);
end $$;

-- Atomic: the conditional UPDATE takes a row lock, so concurrent scans of the same entitlement
-- serialize; the loser re-evaluates "checked_in_at is null" and gets 0 rows. UNIQUE(checkins.entitlement_id) is the backstop.
create function public.check_in(p_token text, p_entitlement uuid, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pass public.qr_passes; r public.reservations; e public.entitlements; v_svc public.service_type; v_state text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where token = p_token;
  if not found then
    perform public.log_audit('checkin.denied', 'qr_pass', null, jsonb_build_object('area', p_area, 'state', 'unknown'));
    return jsonb_build_object('ok', false, 'state', 'unknown');
  end if;
  update public.entitlements en set checked_in_at = now(), checked_in_by = auth.uid()
    from public.reservations rr
   where en.id = p_entitlement and en.reservation_id = pass.reservation_id and rr.id = en.reservation_id
     and pass.status = 'active' and rr.status = 'confirmed' and en.status = 'active' and en.checked_in_at is null
     and en.service_type = v_svc and now() between en.eligible_from and en.eligible_until
  returning en.* into e;
  if found then
    insert into public.checkins (entitlement_id, pass_id, staff_id, area) values (e.id, pass.id, auth.uid(), p_area);
    perform public.log_audit('checkin', 'entitlement', e.id::text,
      jsonb_build_object('area', p_area, 'reservation_id', e.reservation_id, 'service', e.service_type, 'title', e.title));
    return jsonb_build_object('ok', true, 'state', 'checked_in', 'checked_in_at', e.checked_in_at);
  end if;
  select * into e from public.entitlements where id = p_entitlement and reservation_id = pass.reservation_id and service_type = v_svc;
  if not found then v_state := 'no_service';
  else
    select * into r from public.reservations where id = e.reservation_id;
    v_state := public._ent_state(e, r, pass);
  end if;
  perform public.log_audit('checkin.denied', 'entitlement', p_entitlement::text, jsonb_build_object('area', p_area, 'state', v_state));
  return jsonb_build_object('ok', false, 'state', v_state);
end $$;

-- Staff work list: minimal guest details (no email / phone / payment data).
create function public.staff_service_list(p_area text, p_date date)
returns table (entitlement_id uuid, guest_name text, reference text, title text, detail text, starts_at timestamptz,
               adults int, children int, meta jsonb, status text, checked_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  return query
    select e.id, r.first_name || ' ' || left(r.last_name, 1) || '.', r.reference, e.title, e.detail, e.starts_at,
           e.adults, e.children, e.meta, e.status, e.checked_in_at
    from public.entitlements e join public.reservations r on r.id = e.reservation_id
    where e.service_type = public._area_service(p_area) and r.status in ('pending', 'confirmed', 'completed')
      and e.status = 'active'
      and e.starts_at >= public.local_ts(p_date, '00:00') and e.starts_at < public.local_ts(p_date, '00:00') + interval '1 day'
    order by e.starts_at;
end $$;

-- Cron-only: cancel bank-transfer reservations never paid within the configured window.
create function public.expire_unpaid_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare s public.settings; rid uuid; n int := 0;
begin
  select * into s from public.settings where id = 1;
  for rid in select r.id from public.reservations r
             where r.status = 'pending' and r.placed_at < now() - make_interval(hours => s.unpaid_expiry_hours)
               and not exists (select 1 from public.payments p where p.reservation_id = r.id and p.status in ('paid', 'pending_verification')) loop
    perform public._cancel_internal(rid, 'Payment not received in time', 'cancelled');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────── GRANTS: nothing is callable unless listed here ─────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_staff(), public.staff_area(text), public.hotel_tz(), public.local_ts(date, time)
  to anon, authenticated;
grant execute on function public.room_type_availability(date, date), public.restaurant_availability(date, time),
  public.spa_available_slots(uuid, date), public.submit_event_lead(uuid, text, text, text, text) to anon, authenticated;
grant execute on function
  public.add_room_to_cart(uuid, date, date, int, int, uuid[]),
  public.add_restaurant_to_cart(uuid, uuid[], date, time, int, int, jsonb),
  public.add_spa_to_cart(uuid, timestamptz, int, int),
  public.add_event_to_cart(uuid, int, int),
  public.remove_cart_item(uuid),
  public.checkout_cart(text, text, text, text, text, text),
  public.attach_receipt(uuid, text),
  public.cancel_my_reservation(uuid, text),
  public.reissue_pass(uuid),
  public.admin_set_payment_status(uuid, text, text),
  public.admin_set_reservation_status(uuid, public.reservation_status, text),
  public.refund_reservation(uuid, numeric, text, boolean),
  public.scan_pass(text, text),
  public.check_in(text, uuid, text),
  public.staff_service_list(text, date)
  to authenticated;
grant execute on function public.release_expired_holds(), public.expire_unpaid_reservations() to service_role;
