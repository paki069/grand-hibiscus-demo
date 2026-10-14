with reserved_coupon_nights as (
  select
    entitlement.id as entitlement_id,
    coupons.code_id,
    ((entitlement.meta->>'checkin')::date + coupons.position::integer - 1) as coupon_night,
    coalesce((
      select rate_override.rate
      from public.room_rate_overrides rate_override
      where rate_override.room_type_id = room_type.id
        and ((entitlement.meta->>'checkin')::date + coupons.position::integer - 1) <@ rate_override.during
      limit 1
    ), room_type.base_rate) as discount
  from public.entitlements entitlement
  cross join lateral jsonb_array_elements_text(entitlement.meta->'loyalty_coupon_ids')
    with ordinality as coupons(code_id, position)
  join public.loyalty_coupons coupon
    on coupon.id = coupons.code_id::uuid
   and coupon.status = 'reserved'
   and coupon.reserved_entitlement_id = entitlement.id
  join public.room_types room_type
    on room_type.id = (entitlement.meta->>'room_type_id')::uuid
  where entitlement.meta ? 'loyalty_coupon_ids'
    and not (entitlement.meta ? 'loyalty_coupon_allocations')
    and entitlement.meta->>'checkin' is not null
),
allocations as (
  select entitlement_id,
         jsonb_object_agg(
           code_id,
           jsonb_build_object('night', coupon_night, 'discount', discount)
         ) as value
  from reserved_coupon_nights
  group by entitlement_id
)
update public.entitlements entitlement
set meta = entitlement.meta || jsonb_build_object('loyalty_coupon_allocations', allocations.value)
from allocations
where entitlement.id = allocations.entitlement_id;

create or replace function public.apply_cart_coupon(p_code text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_cart uuid;
  v_coupon public.loyalty_coupons;
  v_entitlement public.entitlements;
  v_checkin date;
  v_checkout date;
  v_night date;
  v_coupon_ids jsonb;
  v_allocations jsonb;
  v_discount numeric(10,2);
  v_total_discount numeric(10,2);
  v_room_type public.room_types;
  v_matching_room boolean := false;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if nullif(btrim(p_code), '') is null then raise exception 'loyalty_coupon_invalid'; end if;

  perform public.release_expired_holds();
  select id into v_cart
  from public.reservations
  where customer_id = auth.uid() and status = 'cart'
  for update;
  if not found then raise exception 'cart_not_found'; end if;

  select * into v_coupon
  from public.loyalty_coupons
  where code = upper(btrim(p_code)) and customer_id = auth.uid()
  for update;
  if not found then raise exception 'loyalty_coupon_invalid'; end if;
  if v_coupon.status = 'reserved' and v_coupon.reservation_id = v_cart then
    raise exception 'loyalty_coupon_duplicate';
  end if;
  if v_coupon.status <> 'available' then raise exception 'loyalty_coupon_invalid'; end if;

  for v_entitlement in
    select entitlement.*
    from public.entitlements entitlement
    where entitlement.reservation_id = v_cart
      and entitlement.service_type = 'hotel'
      and entitlement.status in ('held', 'active')
      and (entitlement.hold_expires_at is null or entitlement.hold_expires_at > now())
      and entitlement.meta->>'room_type_id' = v_coupon.room_type_id::text
    order by entitlement.starts_at, entitlement.id
    for update
  loop
    v_matching_room := true;
    v_checkin := nullif(v_entitlement.meta->>'checkin', '')::date;
    v_checkout := nullif(v_entitlement.meta->>'checkout', '')::date;
    if v_checkin is null or v_checkout is null or v_checkout <= v_checkin then
      raise exception 'loyalty_coupon_invalid';
    end if;

    v_coupon_ids := coalesce(v_entitlement.meta->'loyalty_coupon_ids', '[]'::jsonb);
    v_allocations := coalesce(v_entitlement.meta->'loyalty_coupon_allocations', '{}'::jsonb);
    if jsonb_typeof(v_coupon_ids) is distinct from 'array'
       or jsonb_typeof(v_allocations) is distinct from 'object' then
      raise exception 'loyalty_coupon_invalid';
    end if;

    for v_night in
      select nights.stay_night::date
      from generate_series(v_checkin::timestamp, (v_checkout - 1)::timestamp, interval '1 day')
        as nights(stay_night)
    loop
      if exists (
        select 1
        from jsonb_each(v_allocations) allocation
        where allocation.value->>'night' = v_night::text
      ) then
        continue;
      end if;

      select coalesce((
        select rate_override.rate
        from public.room_rate_overrides rate_override
        where rate_override.room_type_id = v_coupon.room_type_id
          and v_night <@ rate_override.during
        limit 1
      ), room_type.base_rate)
      into v_discount
      from public.room_types room_type
      where room_type.id = v_coupon.room_type_id;
      if not found then raise exception 'loyalty_coupon_invalid'; end if;

      v_coupon_ids := v_coupon_ids || jsonb_build_array(v_coupon.id);
      v_allocations := v_allocations || jsonb_build_object(
        v_coupon.id::text,
        jsonb_build_object('night', v_night, 'discount', v_discount)
      );
      v_total_discount := coalesce((v_entitlement.meta->>'loyalty_discount')::numeric, 0) + v_discount;

      update public.entitlements
      set total = round(total - v_discount, 2),
          meta = meta || jsonb_build_object(
            'loyalty_coupon_ids', v_coupon_ids,
            'loyalty_coupon_allocations', v_allocations,
            'loyalty_discount', v_total_discount
          )
      where id = v_entitlement.id;

      update public.loyalty_coupons
      set status = 'reserved',
          reservation_id = v_cart,
          reserved_entitlement_id = v_entitlement.id,
          reserved_until = v_entitlement.hold_expires_at,
          redeemed_at = null
      where id = v_coupon.id and status = 'available';
      if not found then raise exception 'loyalty_coupon_unavailable'; end if;
      return v_discount;
    end loop;
  end loop;

  if v_matching_room then raise exception 'loyalty_coupon_nights_exceeded'; end if;
  raise exception 'loyalty_coupon_invalid';
end $$;

create or replace function public.remove_cart_coupon(p_code text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_cart uuid;
  v_coupon public.loyalty_coupons;
  v_entitlement public.entitlements;
  v_coupon_ids jsonb;
  v_allocations jsonb;
  v_allocation jsonb;
  v_coupon_id text;
  v_discount numeric(10,2);
  v_total_discount numeric(10,2);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if nullif(btrim(p_code), '') is null then raise exception 'loyalty_coupon_invalid'; end if;

  select id into v_cart
  from public.reservations
  where customer_id = auth.uid() and status = 'cart'
  for update;
  if not found then raise exception 'cart_not_found'; end if;

  select * into v_coupon
  from public.loyalty_coupons
  where code = upper(btrim(p_code))
    and customer_id = auth.uid()
    and reservation_id = v_cart
    and status = 'reserved'
  for update;
  if not found then raise exception 'loyalty_coupon_invalid'; end if;

  select * into v_entitlement
  from public.entitlements
  where id = v_coupon.reserved_entitlement_id
    and reservation_id = v_cart
    and service_type = 'hotel'
  for update;
  if not found then raise exception 'loyalty_coupon_invalid'; end if;

  v_coupon_id := v_coupon.id::text;
  v_coupon_ids := coalesce(v_entitlement.meta->'loyalty_coupon_ids', '[]'::jsonb);
  v_allocations := coalesce(v_entitlement.meta->'loyalty_coupon_allocations', '{}'::jsonb);
  v_allocation := v_allocations->v_coupon_id;
  v_discount := nullif(v_allocation->>'discount', '')::numeric;
  if v_discount is null then
    raise exception 'loyalty_coupon_invalid';
  end if;

  select coalesce(jsonb_agg(ids.coupon_id order by ids.position), '[]'::jsonb)
  into v_coupon_ids
  from jsonb_array_elements(v_coupon_ids) with ordinality as ids(coupon_id, position)
  where ids.coupon_id #>> '{}' <> v_coupon_id;
  v_allocations := v_allocations - v_coupon_id;
  v_total_discount := greatest(coalesce((v_entitlement.meta->>'loyalty_discount')::numeric, 0) - v_discount, 0);

  update public.entitlements
  set total = round(total + v_discount, 2),
      meta = meta || jsonb_build_object(
        'loyalty_coupon_ids', v_coupon_ids,
        'loyalty_coupon_allocations', v_allocations,
        'loyalty_discount', v_total_discount
      )
  where id = v_entitlement.id;

  update public.loyalty_coupons
  set status = 'available',
      reservation_id = null,
      reserved_entitlement_id = null,
      reserved_until = null,
      redeemed_at = null
  where id = v_coupon.id and status = 'reserved' and reservation_id = v_cart;
  if not found then raise exception 'loyalty_coupon_invalid'; end if;
  return v_discount;
end $$;

revoke execute on function public.apply_cart_coupon(text),
  public.remove_cart_coupon(text)
  from public, anon;
grant execute on function public.apply_cart_coupon(text),
  public.remove_cart_coupon(text)
  to authenticated;
