create or replace function public.preview_room_booking_coupon_discount(
  p_room_type uuid,
  p_checkin date,
  p_checkout date,
  p_room_count integer,
  p_coupon_codes text[]
) returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_room_type public.room_types;
  v_nights integer;
  v_codes text[];
  v_coupon_count integer;
  v_distinct_count integer;
  v_discount numeric(10,2);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce(p_room_count, 0) not between 1 and 20 then raise exception 'invalid_party'; end if;
  if p_checkin is null or p_checkout is null or p_checkout <= p_checkin then raise exception 'invalid_dates'; end if;

  select * into v_room_type from public.room_types where id = p_room_type and active;
  if not found then raise exception 'room_type_unavailable'; end if;

  v_nights := p_checkout - p_checkin;
  if v_nights < v_room_type.min_nights or v_nights > v_room_type.max_nights then
    raise exception 'stay_length_not_allowed';
  end if;

  v_codes := array(
    select upper(btrim(code))
    from unnest(coalesce(p_coupon_codes, '{}')) with ordinality as input_codes(code, position)
    order by position
  );
  if cardinality(v_codes) = 0 then return 0; end if;
  if exists (select 1 from unnest(v_codes) code where code is null or code = '') then
    raise exception 'loyalty_coupon_invalid';
  end if;
  select count(distinct code) into v_distinct_count from unnest(v_codes) code;
  if v_distinct_count <> cardinality(v_codes) then raise exception 'loyalty_coupon_duplicate'; end if;
  if cardinality(v_codes) > v_nights * p_room_count then raise exception 'loyalty_coupon_nights_exceeded'; end if;

  perform coupon.id
  from public.loyalty_coupons coupon
  where coupon.code = any(v_codes) and coupon.customer_id = auth.uid()
    and coupon.room_type_id = p_room_type and coupon.status = 'available'
  order by coupon.id for update;
  select count(*)::integer into v_coupon_count
  from public.loyalty_coupons coupon
  where coupon.code = any(v_codes) and coupon.customer_id = auth.uid()
    and coupon.room_type_id = p_room_type and coupon.status = 'available';
  if v_coupon_count <> cardinality(v_codes) then raise exception 'loyalty_coupon_invalid'; end if;

  select coalesce(sum(coalesce(
    (select override.rate from public.room_rate_overrides override
     where override.room_type_id = p_room_type
       and (p_checkin + ((coupon.position - 1) % v_nights)::integer) <@ override.during
     limit 1),
    v_room_type.base_rate
  )), 0)::numeric(10,2)
  into v_discount
  from unnest(v_codes) with ordinality as coupon(code, position);

  return v_discount;
end $$;

revoke execute on function public.preview_room_booking_coupon_discount(uuid, date, date, integer, text[])
  from public, anon;
grant execute on function public.preview_room_booking_coupon_discount(uuid, date, date, integer, text[])
  to authenticated;

create or replace function public._handle_reservation_loyalty_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' then
    perform public._award_reservation_loyalty_points(new.id);
  elsif new.status = 'cancelled' then
    perform public._reverse_reservation_loyalty_points(new.id);
  end if;
  return new;
end $$;

create or replace function public._redeem_loyalty_coupons_after_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_became_paid boolean;
begin
  if tg_op = 'INSERT' then
    v_became_paid := new.status = 'paid';
  else
    v_became_paid := new.status = 'paid' and old.status is distinct from new.status;
  end if;

  if v_became_paid and new.entitlement_id is null then
    update public.loyalty_coupons
    set status = 'redeemed', reserved_until = null, redeemed_at = now()
    where reservation_id = new.reservation_id and status = 'reserved';
  end if;
  return new;
end $$;

revoke execute on function public._redeem_loyalty_coupons_after_payment() from public, anon;

update public.loyalty_coupons coupon
set status = 'redeemed', reserved_until = null, redeemed_at = coalesce(coupon.redeemed_at, now())
where coupon.status = 'reserved'
  and exists (
    select 1 from public.payments payment
    where payment.reservation_id = coupon.reservation_id
      and payment.entitlement_id is null and payment.status = 'paid'
  );

update public.loyalty_coupons coupon
set status = 'reserved', reserved_until = null, redeemed_at = null
where coupon.status = 'redeemed'
  and exists (
    select 1 from public.reservations reservation
    where reservation.id = coupon.reservation_id and reservation.status <> 'cancelled'
  )
  and not exists (
    select 1 from public.payments payment
    where payment.reservation_id = coupon.reservation_id
      and payment.entitlement_id is null and payment.status in ('paid', 'partially_refunded', 'refunded')
  );

drop trigger if exists payments_redeem_loyalty_coupons on public.payments;
create trigger payments_redeem_loyalty_coupons
  after insert or update of status on public.payments
  for each row execute function public._redeem_loyalty_coupons_after_payment();
