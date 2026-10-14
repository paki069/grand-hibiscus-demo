alter table public.profiles
  add column if not exists birthday date;

create or replace function public.profiles_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role <> old.role
       or new.staff_areas <> old.staff_areas
       or new.active <> old.active
       or new.id <> old.id
       or new.birthday is distinct from old.birthday then
      raise exception 'forbidden';
    end if;
  end if;
  return new;
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
  v_room_points integer;
  v_addon_points integer;
begin
  select r.customer_id into v_customer
  from public.reservations r
  where r.id = p_reservation
    and r.status in ('confirmed', 'completed')
    and not exists (
      select 1 from public.payments p
      where p.reservation_id = r.id and p.status = 'refunded'
    );
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

create or replace function public.backfill_my_loyalty_points()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_reservation uuid;
  v_balance integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'customer' and active
  ) then
    raise exception 'loyalty_customer_unavailable';
  end if;

  for v_reservation in
    select r.id
    from public.reservations r
    where r.customer_id = auth.uid()
      and r.status in ('confirmed', 'completed')
      and not exists (
        select 1 from public.payments p
        where p.reservation_id = r.id and p.status = 'refunded'
      )
    order by r.created_at, r.id
  loop
    perform public._award_reservation_loyalty_points(v_reservation);
  end loop;

  select coalesce(sum(points), 0)::integer into v_balance
  from public.loyalty_point_ledger
  where customer_id = auth.uid();
  return v_balance;
end $$;

revoke all on function public.backfill_my_loyalty_points() from public, anon;
grant execute on function public.backfill_my_loyalty_points() to authenticated;
