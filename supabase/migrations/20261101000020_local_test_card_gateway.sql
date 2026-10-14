update public.settings
set payment_methods = jsonb_set(
  jsonb_set(
    payment_methods,
    '{cash_on_arrival}',
    coalesce(payment_methods -> 'cash_on_arrival', '{}'::jsonb)
      || jsonb_build_object('label', 'Cash/Card on arrival'),
    true
  ),
  '{card}',
  coalesce(payment_methods -> 'card', '{}'::jsonb)
    || jsonb_build_object('enabled', true, 'label', 'Credit Card'),
  true
),
updated_at = now()
where id = 1;

create or replace function public._checkout_cart_for_customer(
  p_customer uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_method text,
  p_notes text,
  p_test_card_authorized boolean
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cart uuid;
  s public.settings;
  v_sub numeric;
  v_tax numeric;
  v_fee numeric;
  v_total numeric;
  pm jsonb;
  n integer;
  bad integer;
  v_status public.reservation_status;
  v_pay text;
  r public.reservations;
begin
  if p_customer is null then raise exception 'not_authenticated'; end if;
  select id into v_cart
  from public.reservations
  where customer_id = p_customer and status = 'cart'
  for update;
  if not found then raise exception 'cart_empty'; end if;

  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select count(*) filter (where status = 'held'),
    count(*) filter (where status <> 'held')
  into n, bad
  from public.entitlements
  where reservation_id = v_cart;
  if bad > 0 then raise exception 'cart_items_expired'; end if;
  if n = 0 then raise exception 'cart_empty'; end if;
  if length(trim(coalesce(p_first, ''))) < 1
     or length(trim(coalesce(p_last, ''))) < 1
     or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(trim(coalesce(p_phone, ''))) < 5 then
    raise exception 'invalid_details';
  end if;

  pm := s.payment_methods -> p_method;
  if pm is null or coalesce((pm ->> 'enabled')::boolean, false) is not true then
    raise exception 'payment_method_unavailable';
  end if;
  if p_method = 'card' and not p_test_card_authorized then
    raise exception 'card_payment_requires_server';
  end if;

  select coalesce(sum(total), 0) into v_sub
  from public.entitlements where reservation_id = v_cart;
  v_sub := v_sub + coalesce((
    select sum(total) from public.menu_orders where reservation_id = v_cart
  ), 0);
  v_tax := round(v_sub * s.tax_rate / 100, 2);
  v_fee := round(v_sub * s.service_fee_rate / 100, 2);
  v_total := v_sub + v_tax + v_fee;

  update public.entitlements
  set status = 'active', hold_expires_at = null
  where reservation_id = v_cart;
  update public.room_stays
  set status = 'confirmed'
  where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);
  update public.table_reservations
  set status = 'confirmed'
  where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);
  update public.spa_appointments
  set status = 'confirmed'
  where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);
  update public.event_bookings
  set status = 'confirmed'
  where entitlement_id in (select id from public.entitlements where reservation_id = v_cart);

  if v_total = 0 then
    v_status := 'confirmed';
    v_pay := 'paid';
  elsif p_method = 'bank_transfer' then
    v_status := 'pending';
    v_pay := 'awaiting_receipt';
  elsif p_method in ('dev_test', 'card') then
    v_status := 'confirmed';
    v_pay := 'paid';
  else
    v_status := 'confirmed';
    v_pay := 'unpaid';
  end if;

  update public.reservations
  set status = v_status,
      first_name = trim(p_first),
      last_name = trim(p_last),
      email = trim(p_email),
      phone = trim(p_phone),
      notes = left(coalesce(p_notes, ''), 1000),
      subtotal = v_sub,
      tax = v_tax,
      fees = v_fee,
      total = v_total,
      currency = s.currency,
      placed_at = now(),
      confirmed_at = case when v_status = 'confirmed' then now() end
  where id = v_cart
  returning * into r;

  insert into public.payments (
    reservation_id, method, status, amount, currency, paid_at, note
  ) values (
    v_cart, p_method, v_pay, v_total, s.currency,
    case when v_pay = 'paid' then now() end,
    case
      when p_method = 'dev_test' then 'DEVELOPMENT-ONLY test payment. No money moved.'
      when p_method = 'card' then 'LOCAL TEST GATEWAY: Approved test-card payment. No money moved.'
      else ''
    end
  );
  if v_status = 'confirmed' then perform public._issue_pass(v_cart, 'issued'); end if;
  perform public.log_audit(
    'reservation.placed',
    'reservation',
    v_cart::text,
    jsonb_build_object('method', p_method, 'total', v_total)
  );
  return jsonb_build_object(
    'reservation_id', v_cart,
    'reference', r.reference,
    'status', v_status,
    'payment_status', v_pay
  );
end $$;

create or replace function public.checkout_cart(
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_method text,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_method = 'card' then raise exception 'card_payment_requires_server'; end if;
  perform public._cart_id();
  return public._checkout_cart_for_customer(
    auth.uid(), p_first, p_last, p_email, p_phone, p_method, p_notes, false
  );
end $$;

create or replace function public.checkout_cart_test_card(
  p_customer_id uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_customer_id is null or not exists (
    select 1 from public.profiles
    where id = p_customer_id and role = 'customer' and active
  ) then
    raise exception 'not_authenticated';
  end if;
  perform set_config('request.jwt.claim.sub', p_customer_id::text, true);
  return public._checkout_cart_for_customer(
    p_customer_id, p_first, p_last, p_email, p_phone, 'card', p_notes, true
  );
end $$;

revoke all on function public._checkout_cart_for_customer(uuid, text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.checkout_cart_test_card(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.checkout_cart_test_card(uuid, text, text, text, text, text)
  to service_role;

create or replace function public.book_tour_for_room_stay_test_card(
  p_customer_id uuid,
  p_hotel_entitlement uuid,
  p_event uuid,
  p_tour_date date,
  p_adults integer,
  p_children integer
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_fallback_method text;
  v_payment_id uuid;
  v_due numeric;
begin
  if p_customer_id is null or not exists (
    select 1 from public.profiles
    where id = p_customer_id and role = 'customer' and active
  ) then
    raise exception 'not_authenticated';
  end if;
  if not exists (
    select 1 from public.settings
    where id = 1
      and coalesce((payment_methods -> 'card' ->> 'enabled')::boolean, false)
  ) then
    raise exception 'payment_method_unavailable';
  end if;

  select method into v_fallback_method
  from (values ('cash_on_arrival', 1), ('bank_transfer', 2)) as methods(method, sort_order)
  where coalesce(
    (select (payment_methods -> method ->> 'enabled')::boolean
      from public.settings where id = 1),
    false
  )
  order by sort_order
  limit 1;
  if v_fallback_method is null then raise exception 'payment_method_unavailable'; end if;

  perform set_config('request.jwt.claim.sub', p_customer_id::text, true);
  v_result := public.book_tour_for_room_stay(
    p_hotel_entitlement, p_event, p_tour_date, p_adults, p_children, v_fallback_method
  );
  v_due := coalesce((v_result ->> 'amount_due')::numeric, 0);
  if v_due > 0 then
    update public.payments
    set method = 'card',
        status = 'paid',
        paid_at = now(),
        note = 'LOCAL TEST GATEWAY: Approved test-card payment. No money moved.'
    where reservation_id = (v_result ->> 'reservation_id')::uuid
      and entitlement_id = (v_result ->> 'entitlement_id')::uuid
      and method = v_fallback_method
      and status in ('unpaid', 'awaiting_receipt')
    returning id into v_payment_id;
    if v_payment_id is null then raise exception 'test_card_payment_finalize_failed'; end if;
  end if;

  update public.audit_log
  set details = details || jsonb_build_object('payment_method', 'card')
  where action = 'tour.booked_for_room'
    and entity_type = 'entitlement'
    and entity_id = v_result ->> 'entitlement_id'
    and actor_id = p_customer_id;
  if not found then raise exception 'test_card_payment_finalize_failed'; end if;

  return jsonb_set(v_result, '{payment_status}', '"paid"'::jsonb, true);
end $$;

revoke all on function public.book_tour_for_room_stay_test_card(uuid, uuid, uuid, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.book_tour_for_room_stay_test_card(uuid, uuid, uuid, date, integer, integer)
  to service_role;
