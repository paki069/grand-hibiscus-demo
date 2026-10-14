alter table public.payments
  add column if not exists entitlement_id uuid references public.entitlements (id) on delete set null;

create index if not exists payments_entitlement_idx
  on public.payments (entitlement_id, created_at desc);

create or replace function public.sync_room_linked_hold_expiry()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_room_expiry timestamptz;
  v_room_status text;
begin
  if new.parent_entitlement_id is null
     or new.service_type not in ('restaurant', 'spa', 'event') then
    return new;
  end if;

  select room.hold_expires_at, room.status
  into v_room_expiry, v_room_status
  from public.entitlements room
  where room.id = new.parent_entitlement_id
    and room.reservation_id = new.reservation_id
    and room.service_type = 'hotel'
    and room.status in ('held', 'active');
  if not found then raise exception 'room_not_in_cart'; end if;

  new.hold_expires_at := case when v_room_status = 'held' then v_room_expiry else null end;
  return new;
end $$;

create function public.book_tour_for_room_stay(
  p_hotel_entitlement uuid,
  p_event uuid,
  p_tour_date date,
  p_adults int,
  p_children int,
  p_payment_method text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_res public.reservations;
  v_room public.entitlements;
  v_event public.events;
  v_settings public.settings;
  v_payment_config jsonb;
  v_checkin date;
  v_checkout date;
  v_today date;
  v_qty int;
  v_taken int;
  v_start timestamptz;
  v_end timestamptz;
  v_subtotal numeric(10,2);
  v_tax numeric(10,2);
  v_fee numeric(10,2);
  v_due numeric(10,2);
  v_ent uuid;
  v_payment_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform public.release_expired_holds();
  if coalesce(p_payment_method, '') not in ('bank_transfer', 'cash_on_arrival') then
    raise exception 'payment_method_unavailable';
  end if;

  select reservation.* into v_res
  from public.reservations reservation
  join public.entitlements room on room.reservation_id = reservation.id
  where room.id = p_hotel_entitlement
    and room.service_type = 'hotel'
    and reservation.customer_id = auth.uid()
    and reservation.status = 'confirmed'
  for update of reservation;
  if not found then raise exception 'confirmed_room_required'; end if;

  select * into v_room
  from public.entitlements
  where id = p_hotel_entitlement
    and reservation_id = v_res.id
    and service_type = 'hotel'
    and status = 'active'
  for update;
  if not found then raise exception 'confirmed_room_required'; end if;

  select * into v_settings from public.settings where id = 1;
  if not found then raise exception 'settings_unavailable'; end if;
  v_payment_config := v_settings.payment_methods -> p_payment_method;
  if v_payment_config is null or coalesce((v_payment_config ->> 'enabled')::boolean, false) is not true then
    raise exception 'payment_method_unavailable';
  end if;

  v_checkin := nullif(v_room.meta ->> 'checkin', '')::date;
  v_checkout := nullif(v_room.meta ->> 'checkout', '')::date;
  if v_checkin is null or v_checkout is null or v_checkout <= v_checkin then
    raise exception 'confirmed_room_required';
  end if;

  v_today := (now() at time zone v_settings.timezone)::date;
  if p_tour_date is null or p_tour_date < v_today
     or p_tour_date < v_checkin or p_tour_date >= v_checkout then
    raise exception 'event_date_outside_stay';
  end if;

  select * into v_event
  from public.events
  where id = p_event and active and booking_enabled
  for update;
  if not found then raise exception 'event_unavailable'; end if;
  if v_event.available_from is null or v_event.available_until is null
     or v_event.departure_start is null or v_event.departure_end is null
     or p_tour_date < v_event.available_from or p_tour_date > v_event.available_until then
    raise exception 'event_date_unavailable';
  end if;

  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0
     or coalesce(p_adults, 0) + coalesce(p_children, 0) > 20 then
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
  if exists (
    select 1
    from public.event_bookings booking
    join public.entitlements entitlement on entitlement.id = booking.entitlement_id
    where entitlement.reservation_id = v_res.id
      and entitlement.parent_entitlement_id = v_room.id
      and booking.event_id = p_event
      and booking.booking_date = p_tour_date
      and booking.status <> 'released'
  ) then
    raise exception 'event_already_booked';
  end if;
  v_qty := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if v_event.capacity is not null and v_taken + v_qty > v_event.capacity then
    raise exception 'event_full';
  end if;

  v_subtotal := round(v_event.price * p_adults + coalesce(v_event.child_price, v_event.price) * p_children, 2);
  v_tax := round(v_subtotal * v_settings.tax_rate / 100, 2);
  v_fee := round(v_subtotal * v_settings.service_fee_rate / 100, 2);
  v_due := v_subtotal + v_tax + v_fee;

  insert into public.entitlements (
    reservation_id, parent_entitlement_id, service_type, title, detail, starts_at, ends_at,
    eligible_from, eligible_until, adults, children, total, meta, status, hold_expires_at
  ) values (
    v_res.id, v_room.id, 'event', v_event.title,
    v_qty || ' guest' || case when v_qty > 1 then 's' else '' end
      || case when coalesce(v_event.location, '') = '' then '' else ' · ' || v_event.location end,
    v_start, v_end, v_start - interval '1 hour', v_end, p_adults, p_children, v_subtotal,
    jsonb_build_object('event_id', v_event.id, 'location', v_event.location, 'tour_date', p_tour_date),
    'active', null
  ) returning id into v_ent;

  insert into public.event_bookings (entitlement_id, event_id, qty, booking_date, status)
  values (v_ent, v_event.id, v_qty, p_tour_date, 'confirmed');

  update public.reservations
  set subtotal = subtotal + v_subtotal,
      tax = tax + v_tax,
      fees = fees + v_fee,
      total = total + v_due
  where id = v_res.id;

  if v_due > 0 then
    v_payment_status := case when p_payment_method = 'bank_transfer' then 'awaiting_receipt' else 'unpaid' end;
    insert into public.payments (reservation_id, entitlement_id, method, status, amount, currency)
    values (v_res.id, v_ent, p_payment_method, v_payment_status, v_due, v_res.currency);
  else
    v_payment_status := 'paid';
  end if;

  perform public.log_audit('tour.booked_for_room', 'entitlement', v_ent::text,
    jsonb_build_object('reservation_id', v_res.id, 'parent_entitlement_id', v_room.id,
      'event_id', v_event.id, 'tour_date', p_tour_date, 'payment_method', p_payment_method));

  return jsonb_build_object(
    'entitlement_id', v_ent,
    'reservation_id', v_res.id,
    'reference', v_res.reference,
    'amount_due', v_due,
    'payment_status', v_payment_status
  );
end $$;

drop function if exists public.attach_receipt(uuid, text);

create function public.attach_receipt(p_res uuid, p_path text, p_payment uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_payment uuid;
begin
  if p_path is null or p_path not like auth.uid()::text || '/' || p_res::text || '/%' then
    raise exception 'forbidden';
  end if;

  select payment.id into v_payment
  from public.payments payment
  join public.reservations reservation on reservation.id = payment.reservation_id
  where payment.reservation_id = p_res
    and reservation.customer_id = auth.uid()
    and payment.method = 'bank_transfer'
    and payment.status in ('awaiting_receipt', 'pending_verification', 'failed')
    and (p_payment is null or payment.id = p_payment)
  order by payment.created_at desc
  limit 1
  for update of payment;
  if not found then raise exception 'invalid_status'; end if;

  update public.payments
  set receipt_path = p_path, status = 'pending_verification'
  where id = v_payment;
  perform public.log_audit('receipt.uploaded', 'payment', v_payment::text, jsonb_build_object('reservation_id', p_res));
end $$;

create or replace function public.scan_pass(p_token text, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pass public.qr_passes;
  r public.reservations;
  v_svc public.service_type;
  v_list jsonb;
  v_state text;
  v_payment_status text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where id = public._resolve_scan_pass(p_token);
  if not found then
    perform public.log_audit('scan.unknown', 'qr_pass', null, jsonb_build_object('area', p_area));
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into r from public.reservations where id = pass.reservation_id;

  select payment.status into v_payment_status
  from public.payments payment
  where payment.reservation_id = r.id and payment.entitlement_id is null
  order by payment.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'detail', e.detail, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'eligible_from', e.eligible_from, 'adults', e.adults, 'children', e.children, 'meta', e.meta,
      'checked_in_at', e.checked_in_at, 'payment_status', (
        select payment.status
        from public.payments payment
        where payment.reservation_id = e.reservation_id
          and (payment.entitlement_id is null or payment.entitlement_id = e.id)
        order by (payment.entitlement_id is not null) desc, payment.created_at desc
        limit 1
      ), 'state', public._ent_state(e, r, pass)) order by e.starts_at), '[]')
    into v_list from public.entitlements e where e.reservation_id = r.id and e.service_type = v_svc;
  if jsonb_array_length(v_list) = 0 then v_state := 'no_service';
  elsif pass.status = 'revoked' then v_state := 'revoked';
  elsif exists (select 1 from jsonb_array_elements(v_list) x where x ->> 'state' = 'valid') then v_state := 'valid';
  else v_state := v_list -> 0 ->> 'state'; end if;

  return jsonb_build_object('state', v_state, 'area', p_area,
    'reservation', jsonb_build_object(
      'id', r.id,
      'reference', r.reference,
      'guest', r.first_name || ' ' || r.last_name,
      'status', r.status,
      'payment_status', v_payment_status
    ),
    'entitlements', v_list);
end $$;

create or replace function public.check_in(p_token text, p_entitlement uuid, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pass public.qr_passes;
  r public.reservations;
  e public.entitlements;
  v_svc public.service_type;
  v_state text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where id = public._resolve_scan_pass(p_token);
  if not found then
    perform public.log_audit('checkin.denied', 'qr_pass', null, jsonb_build_object('area', p_area, 'state', 'unknown'));
    return jsonb_build_object('ok', false, 'state', 'unknown');
  end if;

  update public.entitlements en set checked_in_at = now(), checked_in_by = auth.uid()
    from public.reservations rr
   where en.id = p_entitlement and en.reservation_id = pass.reservation_id and rr.id = en.reservation_id
     and pass.status = 'active' and rr.status = 'confirmed' and en.status = 'active' and en.checked_in_at is null
     and en.service_type = v_svc and now() between en.eligible_from and en.eligible_until
     and not exists (
       select 1 from public.payments payment
       where payment.reservation_id = en.reservation_id
         and payment.entitlement_id = en.id
         and payment.method = 'bank_transfer'
         and payment.status <> 'paid'
     )
  returning en.* into e;
  if found then
    insert into public.checkins (entitlement_id, pass_id, staff_id, area) values (e.id, pass.id, auth.uid(), p_area);
    perform public.log_audit('checkin', 'entitlement', e.id::text,
      jsonb_build_object('area', p_area, 'reservation_id', e.reservation_id, 'service', e.service_type, 'title', e.title));
    return jsonb_build_object('ok', true, 'state', 'checked_in', 'checked_in_at', e.checked_in_at);
  end if;

  select * into e from public.entitlements
  where id = p_entitlement and reservation_id = pass.reservation_id and service_type = v_svc;
  if not found then
    v_state := 'no_service';
  else
    select * into r from public.reservations where id = e.reservation_id;
    v_state := public._ent_state(e, r, pass);
    if v_state = 'valid' and exists (
      select 1 from public.payments payment
      where payment.reservation_id = e.reservation_id
        and payment.entitlement_id = e.id
        and payment.method = 'bank_transfer'
        and payment.status <> 'paid'
    ) then
      v_state := 'payment_pending';
    end if;
  end if;
  perform public.log_audit('checkin.denied', 'entitlement', p_entitlement::text,
    jsonb_build_object('area', p_area, 'state', v_state));
  return jsonb_build_object('ok', false, 'state', v_state);
end $$;

revoke all on function public.book_tour_for_room_stay(uuid, uuid, date, int, int, text),
  public.attach_receipt(uuid, text, uuid) from public, anon;
grant execute on function public.book_tour_for_room_stay(uuid, uuid, date, int, int, text),
  public.attach_receipt(uuid, text, uuid) to authenticated;
