create or replace function public.add_gym_access_to_room_cart(
  p_hotel_entitlement uuid,
  p_adults int,
  p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_res uuid;
  v_room public.entitlements;
  v_package public.gym_packages;
  v_settings public.settings;
  v_ent uuid;
  v_checkin date;
  v_checkout date;
  v_nights int;
  v_adults int;
  v_subtotal numeric(10,2);
  v_discount numeric(10,2);
  v_total numeric(10,2);
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  select * into v_room
  from public.entitlements
  where id = p_hotel_entitlement and reservation_id = v_res and service_type = 'hotel';
  if not found then raise exception 'room_not_in_cart'; end if;

  v_checkin := (v_room.meta ->> 'checkin')::date;
  v_checkout := (v_room.meta ->> 'checkout')::date;
  if v_checkin is null or v_checkout is null or v_checkout <= v_checkin then raise exception 'invalid_stay'; end if;
  v_nights := v_checkout - v_checkin;
  if p_children is null then raise exception 'invalid_party'; end if;
  if p_children <> 0 then raise exception 'gym_adults_only'; end if;
  v_adults := coalesce(p_adults, 0);
  if p_adults is null or p_adults < 0 or v_adults < 1 or p_adults > v_room.adults then
    raise exception 'invalid_party';
  end if;
  if public.gym_access_covers_stay(v_checkin, v_checkout) then raise exception 'gym_membership_active'; end if;
  if exists (
    select 1 from public.entitlements
    where parent_entitlement_id = p_hotel_entitlement and service_type = 'gym' and status = 'held'
  ) then raise exception 'gym_item_in_cart'; end if;

  select * into v_package from public.gym_packages where slug = 'day-pass' and active;
  if not found then raise exception 'gym_package_unavailable'; end if;
  if v_package.price is null then raise exception 'gym_price_unavailable'; end if;
  v_subtotal := round(v_package.price * v_adults * v_nights, 2);
  v_total := round(v_subtotal * 0.65, 2);
  v_discount := v_subtotal - v_total;
  select * into v_settings from public.settings where id = 1;
  insert into public.entitlements (
    reservation_id, service_type, parent_entitlement_id, title, detail, starts_at, ends_at, eligible_from, eligible_until,
    adults, children, total, meta, status, hold_expires_at
  ) values (
    v_res, 'gym', p_hotel_entitlement, 'Gym access for your stay',
    v_adults || ' adult' || case when v_adults = 1 then '' else 's' end || ' · ' ||
      v_nights || ' night' || case when v_nights = 1 then '' else 's' end,
    v_room.starts_at, v_room.ends_at, v_room.starts_at, v_room.ends_at,
    v_adults, 0, v_total,
    jsonb_build_object(
      'package_id', v_package.id,
      'package_slug', v_package.slug,
      'price_per_guest_per_day', v_package.price,
      'guests', v_adults,
      'nights', v_nights,
      'subtotal_before_discount', v_subtotal,
      'hotel_discount_percent', 35,
      'discount_amount', v_discount
    ),
    'held', now() + make_interval(mins => v_settings.hold_minutes)
  ) returning id into v_ent;
  return v_ent;
end $$;
