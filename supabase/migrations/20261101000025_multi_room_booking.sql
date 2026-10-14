create or replace function public.add_multi_room_booking_with_coupons_to_cart(
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
  p_interests text[]
) returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_party jsonb;
  v_adults integer;
  v_children integer;
  v_coupon_codes text[];
  v_entitlement uuid;
  v_entitlements uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_room_parties is null or jsonb_typeof(p_room_parties) is distinct from 'array' then
    raise exception 'invalid_room_party';
  end if;
  if jsonb_array_length(p_room_parties) < 2 or jsonb_array_length(p_room_parties) > 20 then
    raise exception 'invalid_room_party';
  end if;

  for v_party in
    select party.value
    from jsonb_array_elements(p_room_parties) with ordinality as party(value, position)
    order by party.position
  loop
    if jsonb_typeof(v_party) is distinct from 'object'
       or jsonb_typeof(v_party->'adults') is distinct from 'number'
       or not coalesce(v_party->>'adults' ~ '^[0-9]{1,2}$', false)
       or jsonb_typeof(v_party->'children') is distinct from 'number'
       or not coalesce(v_party->>'children' ~ '^[0-9]{1,2}$', false)
       or (v_party ? 'coupon_codes' and jsonb_typeof(v_party->'coupon_codes') is distinct from 'array') then
      raise exception 'invalid_room_party';
    end if;

    v_adults := (v_party->>'adults')::integer;
    v_children := (v_party->>'children')::integer;
    select coalesce(array_agg(code.value order by code.position), '{}')
      into v_coupon_codes
      from jsonb_array_elements_text(coalesce(v_party->'coupon_codes', '[]'::jsonb))
        with ordinality as code(value, position);

    v_entitlement := public.add_room_booking_with_coupons_to_cart(
      p_room_type, p_checkin, p_checkout, v_adults, v_children, p_addons,
      p_first, p_last, p_email, p_phone, p_notes, p_interests, v_coupon_codes
    );
    v_entitlements := array_append(v_entitlements, v_entitlement);
  end loop;

  return v_entitlements;
end $$;

revoke execute on function public.add_multi_room_booking_with_coupons_to_cart(
  uuid, date, date, jsonb, uuid[], text, text, text, text, text, text[]
) from public, anon;

grant execute on function public.add_multi_room_booking_with_coupons_to_cart(
  uuid, date, date, jsonb, uuid[], text, text, text, text, text, text[]
) to authenticated;
