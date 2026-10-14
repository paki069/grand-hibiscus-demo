create or replace function public.add_room_booking_with_upgrades_to_cart(
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
  p_coupon_codes text[],
  p_upgrades jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_entitlement uuid;
begin
  if p_upgrades is null or jsonb_typeof(p_upgrades) is distinct from 'array' then
    raise exception 'invalid_upgrade_selection';
  end if;

  v_entitlement := public.add_room_booking_with_coupons_to_cart(
    p_room_type, p_checkin, p_checkout, p_adults, p_children, p_addons,
    p_first, p_last, p_email, p_phone, p_notes, p_interests, p_coupon_codes
  );
  perform public.set_cart_room_upgrades(jsonb_build_array(jsonb_build_object(
    'room_id', v_entitlement, 'upgrades', p_upgrades
  )));
  return v_entitlement;
end $$;

revoke execute on function public.add_room_booking_with_upgrades_to_cart(
  uuid, date, date, integer, integer, uuid[], text, text, text, text, text, text[], text[], jsonb
) from public, anon;
grant execute on function public.add_room_booking_with_upgrades_to_cart(
  uuid, date, date, integer, integer, uuid[], text, text, text, text, text, text[], text[], jsonb
) to authenticated;

create or replace function public.add_multi_room_booking_with_upgrades_to_cart(
  p_room_type uuid,
  p_checkin date,
  p_checkout date,
  p_room_parties jsonb,
  p_addons uuid[],
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text,
  p_interests text[],
  p_room_upgrades jsonb
) returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_entitlements uuid[];
  v_room_upgrade jsonb;
  v_room_selections jsonb := '[]'::jsonb;
  v_index integer;
begin
  if p_room_upgrades is null or jsonb_typeof(p_room_upgrades) is distinct from 'array' then
    raise exception 'invalid_upgrade_selection';
  end if;

  v_entitlements := public.add_multi_room_booking_with_coupons_to_cart(
    p_room_type, p_checkin, p_checkout, p_room_parties, p_addons,
    p_first, p_last, p_email, p_phone, p_notes, p_interests
  );
  if jsonb_array_length(p_room_upgrades) <> cardinality(v_entitlements) then
    raise exception 'invalid_upgrade_selection';
  end if;

  for v_index in 1..cardinality(v_entitlements) loop
    v_room_upgrade := p_room_upgrades -> (v_index - 1);
    if jsonb_typeof(v_room_upgrade) is distinct from 'object'
       or jsonb_typeof(v_room_upgrade->'upgrades') is distinct from 'array' then
      raise exception 'invalid_upgrade_selection';
    end if;
    v_room_selections := v_room_selections || jsonb_build_array(jsonb_build_object(
      'room_id', v_entitlements[v_index], 'upgrades', v_room_upgrade->'upgrades'
    ));
  end loop;

  perform public.set_cart_room_upgrades(v_room_selections);
  return v_entitlements;
end $$;

revoke execute on function public.add_multi_room_booking_with_upgrades_to_cart(
  uuid, date, date, jsonb, uuid[], text, text, text, text, text, text[], jsonb
) from public, anon;
grant execute on function public.add_multi_room_booking_with_upgrades_to_cart(
  uuid, date, date, jsonb, uuid[], text, text, text, text, text, text[], jsonb
) to authenticated;
