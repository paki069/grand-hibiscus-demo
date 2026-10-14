create or replace function public._create_restaurant_reservation_item(
  p_reservation uuid,
  p_table uuid,
  p_seats uuid[],
  p_date date,
  p_time time,
  p_adults int,
  p_children int,
  p_preorder jsonb,
  p_entitlement_status text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cfg public.restaurant_config;
  s public.settings;
  t public.seating_tables;
  ar public.seating_areas;
  v_start timestamptz;
  v_end timestamptz;
  v_during tstzrange;
  v_party int;
  v_ent uuid;
  v_order uuid;
  v_total numeric := 0;
  m numeric;
  seat_labels text[];
  it record;
  prod public.menu_products;
  qty int;
  seat uuid;
begin
  if p_entitlement_status not in ('held', 'active') then raise exception 'invalid_status'; end if;
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

  if exists (
    select 1 from public.table_reservations tr
    where tr.table_id = t.id and tr.status <> 'released' and tr.during && v_during
      and public._blocking(tr.entitlement_id)
      and (p_seats is null or tr.seat_id is null or tr.seat_id = any (p_seats))
  ) then raise exception 'slot_taken'; end if;

  insert into public.entitlements (
    reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
    adults, children, total, meta, status, hold_expires_at
  )
  values (
    p_reservation, 'restaurant', 'Table ' || t.label || ' · ' || ar.name,
    'Party of ' || v_party || case when seat_labels is not null then ' · seats ' || array_to_string(seat_labels, ', ') else '' end,
    v_start, v_end, v_start - interval '30 minutes', v_end, p_adults, p_children,
    case when p_entitlement_status = 'active' then 0 else cfg.deposit_per_guest * v_party end,
    jsonb_build_object('table_id', t.id, 'table_label', t.label, 'area', ar.name, 'party_size', v_party,
                       'seats', coalesce(to_jsonb(seat_labels), '[]'::jsonb)),
    p_entitlement_status,
    case when p_entitlement_status = 'held' then now() + make_interval(mins => s.hold_minutes) else null end
  )
  returning id into v_ent;

  begin
    if p_seats is null then
      insert into public.table_reservations (entitlement_id, table_id, during, party_size, status)
      values (v_ent, t.id, v_during, v_party, case when p_entitlement_status = 'held' then 'held' else 'confirmed' end);
    else
      foreach seat in array p_seats loop
        insert into public.table_reservations (entitlement_id, table_id, seat_id, during, party_size, status)
        values (v_ent, t.id, seat, v_during, 1, case when p_entitlement_status = 'held' then 'held' else 'confirmed' end);
      end loop;
    end if;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  if jsonb_typeof(coalesce(p_preorder, '[]')) = 'array' and jsonb_array_length(coalesce(p_preorder, '[]')) > 0 then
    insert into public.menu_orders (reservation_id, entitlement_id) values (p_reservation, v_ent) returning id into v_order;
    for it in select value from jsonb_array_elements(p_preorder) loop
      qty := (it.value ->> 'qty')::int;
      select * into prod from public.menu_products
      where id = (it.value ->> 'product_id')::uuid and active and available;
      if not found or qty is null or qty < 1 or qty > 50 then raise exception 'product_unavailable'; end if;
      insert into public.menu_order_items (order_id, product_id, name, unit_price, qty)
      values (v_order, prod.id, prod.name, prod.price, qty);
      v_total := v_total + prod.price * qty;
    end loop;
    update public.menu_orders set total = v_total where id = v_order;
  end if;

  return v_ent;
end $$;

create or replace function public.add_restaurant_to_cart(
  p_table uuid,
  p_seats uuid[],
  p_date date,
  p_time time,
  p_adults int,
  p_children int,
  p_preorder jsonb default '[]'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cart uuid;
begin
  v_cart := public._cart_id();
  return public._create_restaurant_reservation_item(
    v_cart, p_table, p_seats, p_date, p_time, p_adults, p_children, p_preorder, 'held'
  );
end $$;

create function public.confirm_standalone_restaurant_booking(
  p_table uuid,
  p_seats uuid[],
  p_date date,
  p_time time,
  p_adults int,
  p_children int,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid := auth.uid();
  v_res public.reservations;
begin
  if v_customer is null or not exists (
    select 1 from public.profiles where id = v_customer and active
  ) then raise exception 'not_authenticated'; end if;
  if length(trim(coalesce(p_first, ''))) < 1 or length(trim(coalesce(p_last, ''))) < 1
     or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(trim(coalesce(p_phone, ''))) < 5 then raise exception 'invalid_details'; end if;

  insert into public.reservations (
    customer_id, status, first_name, last_name, email, phone, notes, currency, placed_at, confirmed_at
  )
  select v_customer, 'confirmed', trim(p_first), trim(p_last), trim(p_email), trim(p_phone),
         left(coalesce(p_notes, ''), 1000), s.currency, now(), now()
  from public.settings s
  where s.id = 1
  returning * into v_res;
  if not found then raise exception 'settings_not_found'; end if;

  perform public._create_restaurant_reservation_item(
    v_res.id, p_table, p_seats, p_date, p_time, p_adults, p_children, '[]'::jsonb, 'active'
  );
  perform public._issue_pass(v_res.id, 'issued');
  perform public.log_audit(
    'reservation.placed', 'reservation', v_res.id::text,
    jsonb_build_object('service', 'restaurant', 'total', 0, 'payment_required', false)
  );

  return jsonb_build_object('reservation_id', v_res.id, 'reference', v_res.reference, 'status', v_res.status);
end $$;

revoke all on function public._create_restaurant_reservation_item(uuid, uuid, uuid[], date, time, int, int, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.confirm_standalone_restaurant_booking(uuid, uuid[], date, time, int, int, text, text, text, text, text)
  from public, anon;
grant execute on function public.confirm_standalone_restaurant_booking(uuid, uuid[], date, time, int, int, text, text, text, text, text)
  to authenticated;
