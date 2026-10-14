alter table public.room_types
  add column if not exists loyalty_free_night_points integer not null default 500
  check (loyalty_free_night_points > 0);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gym_packages' and column_name = 'loyalty_points'
  ) then
    alter table public.gym_packages
      add column loyalty_points integer not null default 0 check (loyalty_points >= 0);
    update public.gym_packages
    set loyalty_points = case slug
      when 'day-pass' then 5
      when 'monthly' then 25
      when 'three-month' then 80
      when 'yearly' then 350
      else 0
    end;
  end if;
end $$;

create table if not exists public.loyalty_settings (
  id integer primary key check (id = 1),
  room_night_points integer not null default 20 check (room_night_points >= 0),
  room_addon_points integer not null default 5 check (room_addon_points >= 0),
  spa_spend_block_amount numeric(10,2) not null default 50 check (spa_spend_block_amount > 0),
  spa_spend_block_points integer not null default 10 check (spa_spend_block_points >= 0),
  gym_points_per_guest_day integer not null default 5 check (gym_points_per_guest_day >= 0),
  tour_booking_points integer not null default 10 check (tour_booking_points >= 0),
  updated_at timestamptz not null default now()
);

alter table public.loyalty_settings
  add column if not exists gym_points_per_guest_day integer not null default 5
  check (gym_points_per_guest_day >= 0);

insert into public.loyalty_settings (id) values (1) on conflict (id) do nothing;

alter table public.loyalty_settings enable row level security;
drop policy if exists loyalty_settings_admin_all on public.loyalty_settings;
create policy loyalty_settings_admin_all on public.loyalty_settings
  for all using (public.is_admin()) with check (public.is_admin());
drop trigger if exists audit_loyalty_settings on public.loyalty_settings;
create trigger audit_loyalty_settings
  after update on public.loyalty_settings
  for each row execute function public.audit_row();
grant select, insert, update, delete on public.loyalty_settings to authenticated;

create table if not exists public.loyalty_point_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  reservation_id uuid references public.reservations (id) on delete set null,
  reference_key text not null unique,
  entry_type text not null check (entry_type in ('earn', 'redeem', 'reversal', 'adjustment')),
  points integer not null check (points <> 0),
  description text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists loyalty_point_ledger_customer_idx
  on public.loyalty_point_ledger (customer_id, created_at desc);
create index if not exists loyalty_point_ledger_reservation_idx
  on public.loyalty_point_ledger (reservation_id);

alter table public.loyalty_point_ledger enable row level security;
drop policy if exists loyalty_point_ledger_owner_read on public.loyalty_point_ledger;
create policy loyalty_point_ledger_owner_read on public.loyalty_point_ledger
  for select using (customer_id = auth.uid() or public.is_admin());
grant select on public.loyalty_point_ledger to authenticated;

create table if not exists public.loyalty_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  room_type_id uuid not null references public.room_types (id) on delete restrict,
  points_cost integer not null check (points_cost > 0),
  status text not null default 'available' check (status in ('available', 'reserved', 'redeemed')),
  reservation_id uuid references public.reservations (id) on delete set null,
  reserved_entitlement_id uuid references public.entitlements (id) on delete set null,
  reserved_until timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_coupons_owner_idx
  on public.loyalty_coupons (customer_id, status, created_at desc);
create index if not exists loyalty_coupons_reservation_idx
  on public.loyalty_coupons (reservation_id, status);

alter table public.loyalty_coupons enable row level security;
drop policy if exists loyalty_coupons_owner_read on public.loyalty_coupons;
create policy loyalty_coupons_owner_read on public.loyalty_coupons
  for select using (customer_id = auth.uid() or public.is_admin());
grant select on public.loyalty_coupons to authenticated;

create or replace function public.my_loyalty_balance()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(points), 0)::integer
  from public.loyalty_point_ledger
  where customer_id = auth.uid()
$$;

create or replace function public.redeem_loyalty_points(p_room_type uuid, p_quantity integer)
returns table (coupon_code text, room_name text, points_spent integer)
language plpgsql security definer set search_path = public as $$
declare
  v_room public.room_types;
  v_balance integer;
  v_cost integer;
  v_code text;
  v_i integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then raise exception 'loyalty_invalid_quantity'; end if;

  perform 1 from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'not_authenticated'; end if;
  select * into v_room from public.room_types where id = p_room_type and active for share;
  if not found then raise exception 'loyalty_reward_unavailable'; end if;

  v_cost := v_room.loyalty_free_night_points * p_quantity;
  select coalesce(sum(points), 0)::integer into v_balance
  from public.loyalty_point_ledger where customer_id = auth.uid();
  if v_balance < v_cost then raise exception 'loyalty_insufficient_points'; end if;

  insert into public.loyalty_point_ledger (
    customer_id, reference_key, entry_type, points, description, details
  ) values (
    auth.uid(), 'redeem:' || gen_random_uuid()::text, 'redeem', -v_cost,
    'Converted points to ' || p_quantity || ' free-night coupon' || case when p_quantity = 1 then '' else 's' end,
    jsonb_build_object('room_type_id', v_room.id, 'quantity', p_quantity, 'points_per_night', v_room.loyalty_free_night_points)
  );

  for v_i in 1..p_quantity loop
    v_code := 'HIB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    insert into public.loyalty_coupons (code, customer_id, room_type_id, points_cost)
    values (v_code, auth.uid(), v_room.id, v_room.loyalty_free_night_points);
    coupon_code := v_code;
    room_name := v_room.name;
    points_spent := v_room.loyalty_free_night_points;
    return next;
  end loop;
end $$;

create or replace function public._award_reservation_loyalty_points(p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_config public.loyalty_settings;
  v_item record;
  v_points integer;
  v_nights integer;
  v_coupon_nights integer;
  v_addons integer;
  v_package_points integer;
  v_room_points integer;
  v_addon_points integer;
begin
  select customer_id into v_customer from public.reservations
  where id = p_reservation and status = 'confirmed';
  if not found then return; end if;
  select * into v_config from public.loyalty_settings where id = 1;

  for v_item in
    select * from public.entitlements
    where reservation_id = p_reservation and status = 'active'
    order by created_at, id
  loop
    v_points := 0;
    v_room_points := 0;
    v_addon_points := 0;
    if v_item.service_type = 'hotel' then
      v_nights := coalesce(nullif(v_item.meta ->> 'nights', '')::integer, 0);
      v_coupon_nights := coalesce(jsonb_array_length(v_item.meta -> 'loyalty_coupon_ids'), 0);
      v_addons := coalesce(jsonb_array_length(v_item.meta -> 'addons'), 0);
      v_room_points := greatest(v_nights - v_coupon_nights, 0) * v_config.room_night_points;
      v_addon_points := v_addons * v_config.room_addon_points;
      if v_room_points > 0 then
        insert into public.loyalty_point_ledger (
          customer_id, reservation_id, reference_key, entry_type, points, description, details
        ) values (
          v_customer, p_reservation, 'earn:room_nights:' || v_item.id::text, 'earn', v_room_points,
          v_item.title || ' · room nights',
          jsonb_build_object('service_type', v_item.service_type, 'entitlement_id', v_item.id, 'nights', greatest(v_nights - v_coupon_nights, 0))
        ) on conflict (reference_key) do nothing;
      end if;
      if v_addon_points > 0 then
        insert into public.loyalty_point_ledger (
          customer_id, reservation_id, reference_key, entry_type, points, description, details
        ) values (
          v_customer, p_reservation, 'earn:room_addons:' || v_item.id::text, 'earn', v_addon_points,
          v_item.title || ' · room add-ons',
          jsonb_build_object('service_type', v_item.service_type, 'entitlement_id', v_item.id, 'addons', v_addons)
        ) on conflict (reference_key) do nothing;
      end if;
      continue;
    elsif v_item.service_type = 'spa' then
      v_points := floor(v_item.total / v_config.spa_spend_block_amount)::integer * v_config.spa_spend_block_points;
    elsif v_item.service_type = 'gym' then
      if v_item.parent_entitlement_id is not null then
        select coalesce(nullif(meta ->> 'nights', '')::integer, 0) into v_nights
        from public.entitlements where id = v_item.parent_entitlement_id;
        v_points := v_item.adults * coalesce(v_nights, 0) * v_config.gym_points_per_guest_day;
      else
        select coalesce(loyalty_points, 0) into v_points
        from public.gym_packages where id = nullif(v_item.meta ->> 'package_id', '')::uuid;
        v_points := coalesce(v_points, 0);
      end if;
    elsif v_item.service_type = 'event' then
      v_points := v_config.tour_booking_points;
    end if;

    if v_points > 0 then
      insert into public.loyalty_point_ledger (
        customer_id, reservation_id, reference_key, entry_type, points, description, details
      ) values (
        v_customer, p_reservation, 'earn:' || v_item.id::text, 'earn', v_points,
        v_item.title || ' · loyalty points',
        jsonb_build_object('service_type', v_item.service_type, 'entitlement_id', v_item.id)
      ) on conflict (reference_key) do nothing;
    end if;
  end loop;
end $$;

create or replace function public._reverse_reservation_loyalty_points(p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid;
  v_earned integer;
begin
  select customer_id into v_customer from public.reservations where id = p_reservation;
  if not found then return; end if;
  select coalesce(sum(points), 0)::integer into v_earned
  from public.loyalty_point_ledger
  where reservation_id = p_reservation and entry_type = 'earn';
  if v_earned > 0 then
    insert into public.loyalty_point_ledger (
      customer_id, reservation_id, reference_key, entry_type, points, description
    ) values (
      v_customer, p_reservation, 'reverse:' || p_reservation::text, 'reversal', -v_earned,
      'Points reversed for a canceled or refunded booking'
    ) on conflict (reference_key) do nothing;
  end if;
  update public.loyalty_coupons
  set status = 'available', reservation_id = null, reserved_entitlement_id = null,
      reserved_until = null, redeemed_at = null
  where reservation_id = p_reservation and status in ('reserved', 'redeemed');
end $$;

create or replace function public._handle_reservation_loyalty_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' then
    update public.loyalty_coupons
    set status = 'redeemed', reserved_until = null, redeemed_at = now()
    where reservation_id = new.id and status = 'reserved';
    perform public._award_reservation_loyalty_points(new.id);
  elsif new.status = 'cancelled' then
    perform public._reverse_reservation_loyalty_points(new.id);
  end if;
  return new;
end $$;

drop trigger if exists reservations_loyalty_status on public.reservations;
create trigger reservations_loyalty_status
  after update of status on public.reservations
  for each row when (old.status is distinct from new.status)
  execute function public._handle_reservation_loyalty_status();

create or replace function public._release_loyalty_coupons_for_entitlement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_entitlement uuid;
begin
  if tg_op = 'DELETE' then
    v_entitlement := old.id;
  elsif new.status in ('expired', 'cancelled', 'refunded') then
    v_entitlement := new.id;
  else
    return new;
  end if;
  update public.loyalty_coupons
  set status = 'available', reservation_id = null, reserved_entitlement_id = null, reserved_until = null
  where reserved_entitlement_id = v_entitlement and status = 'reserved';
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists entitlements_release_loyalty_coupons on public.entitlements;
create trigger entitlements_release_loyalty_coupons
  after update of status or delete on public.entitlements
  for each row execute function public._release_loyalty_coupons_for_entitlement();

create or replace function public._reverse_loyalty_on_refund()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'refunded' and old.status is distinct from new.status then
    perform public._reverse_reservation_loyalty_points(new.reservation_id);
  end if;
  return new;
end $$;

drop trigger if exists payments_reverse_loyalty on public.payments;
create trigger payments_reverse_loyalty
  after update of status on public.payments
  for each row execute function public._reverse_loyalty_on_refund();

create or replace function public.add_room_booking_with_coupons_to_cart(
  p_room_type uuid,
  p_checkin date,
  p_checkout date,
  p_adults integer,
  p_children integer,
  p_addons uuid[],
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text,
  p_interests text[],
  p_coupon_codes text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ent uuid;
  v_res uuid;
  v_hold_expires timestamptz;
  v_codes text[];
  v_coupon_ids uuid[];
  v_coupon_count integer;
  v_distinct_count integer;
  v_discount numeric(10,2);
begin
  v_ent := public.add_room_booking_to_cart(
    p_room_type, p_checkin, p_checkout, p_adults, p_children, p_addons,
    p_first, p_last, p_email, p_phone, p_notes, p_interests
  );
  v_codes := array(
    select upper(btrim(code))
    from unnest(coalesce(p_coupon_codes, '{}')) with ordinality as input_codes(code, position)
    order by position
  );
  if cardinality(v_codes) = 0 then return v_ent; end if;
  if exists (select 1 from unnest(v_codes) code where code is null or code = '') then
    raise exception 'loyalty_coupon_invalid';
  end if;
  select count(distinct code) into v_distinct_count from unnest(v_codes) code;
  if v_distinct_count <> cardinality(v_codes) then raise exception 'loyalty_coupon_duplicate'; end if;
  if cardinality(v_codes) > p_checkout - p_checkin then raise exception 'loyalty_coupon_nights_exceeded'; end if;

  select reservation_id, hold_expires_at into v_res, v_hold_expires
  from public.entitlements where id = v_ent for update;
  perform coupon.id
  from public.loyalty_coupons coupon
  where coupon.code = any(v_codes) and coupon.customer_id = auth.uid()
    and coupon.room_type_id = p_room_type and coupon.status = 'available'
  order by coupon.id for update;
  select array_agg(coupon.id order by coupon.id), count(*)::integer
  into v_coupon_ids, v_coupon_count
  from public.loyalty_coupons coupon
  where coupon.code = any(v_codes) and coupon.customer_id = auth.uid()
    and coupon.room_type_id = p_room_type and coupon.status = 'available';
  if v_coupon_count <> cardinality(v_codes) then raise exception 'loyalty_coupon_invalid'; end if;

  select coalesce(sum(coalesce(
    (select override.rate from public.room_rate_overrides override
     where override.room_type_id = p_room_type and nights.stay_date::date <@ override.during limit 1),
    room_type.base_rate
  )), 0)::numeric(10,2)
  into v_discount
  from public.room_types room_type,
       generate_series(p_checkin::timestamp, (p_checkout - 1)::timestamp, interval '1 day')
         with ordinality as nights(stay_date, night_number)
  where room_type.id = p_room_type and nights.night_number <= cardinality(v_codes);

  update public.entitlements
  set total = greatest(total - v_discount, 0),
      meta = meta || jsonb_build_object(
        'loyalty_coupon_ids', to_jsonb(v_coupon_ids),
        'loyalty_discount', v_discount
      )
  where id = v_ent;

  update public.loyalty_coupons
  set status = 'reserved', reservation_id = v_res, reserved_entitlement_id = v_ent,
      reserved_until = v_hold_expires, redeemed_at = null
  where id = any(v_coupon_ids) and status = 'available';
  get diagnostics v_coupon_count = row_count;
  if v_coupon_count <> cardinality(v_codes) then raise exception 'loyalty_coupon_unavailable'; end if;
  return v_ent;
end $$;

revoke execute on function public.my_loyalty_balance(),
  public.redeem_loyalty_points(uuid, integer),
  public._award_reservation_loyalty_points(uuid),
  public._reverse_reservation_loyalty_points(uuid),
  public._handle_reservation_loyalty_status(),
  public._release_loyalty_coupons_for_entitlement(),
  public._reverse_loyalty_on_refund(),
  public.add_room_booking_with_coupons_to_cart(uuid, date, date, integer, integer, uuid[], text, text, text, text, text, text[], text[])
  from public, anon;

grant execute on function public.my_loyalty_balance(),
  public.redeem_loyalty_points(uuid, integer),
  public.add_room_booking_with_coupons_to_cart(uuid, date, date, integer, integer, uuid[], text, text, text, text, text, text[], text[])
  to authenticated;
