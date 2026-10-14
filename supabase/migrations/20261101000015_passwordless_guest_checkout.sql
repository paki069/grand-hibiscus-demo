create function public.claim_guest_reservations()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_claimed integer;
  v_target_cart uuid;
  v_rows integer;
  guest_cart public.reservations;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select lower(btrim(email))
    into v_email
    from auth.users
    where id = auth.uid()
      and not coalesce(is_anonymous, false)
      and email_confirmed_at is not null;

  if v_email is null then
    raise exception 'verified_email_required';
  end if;

  perform 1
    from public.profiles
    where id = auth.uid()
    for update;
  if not found then
    raise exception 'not_authenticated';
  end if;

  update public.reservations as guest_reservation
    set customer_id = auth.uid()
    where guest_reservation.customer_id in (
      select id from auth.users where coalesce(is_anonymous, false)
    )
      and lower(btrim(guest_reservation.email)) = v_email
      and guest_reservation.status <> 'cart';

  get diagnostics v_claimed = row_count;

  for guest_cart in
    select *
      from public.reservations as anonymous_cart
      where anonymous_cart.customer_id in (
        select id from auth.users where coalesce(is_anonymous, false)
      )
        and anonymous_cart.status = 'cart'
        and lower(btrim(anonymous_cart.email)) = v_email
      order by anonymous_cart.created_at, anonymous_cart.id
      for update
  loop
    select id
      into v_target_cart
      from public.reservations
      where customer_id = auth.uid()
        and status = 'cart'
      for update;

    if v_target_cart is null then
      update public.reservations
        set customer_id = auth.uid()
        where id = guest_cart.id;
      get diagnostics v_rows = row_count;
      v_claimed := v_claimed + v_rows;
    else
      update public.entitlements
        set reservation_id = v_target_cart
        where reservation_id = guest_cart.id;
      update public.menu_orders
        set reservation_id = v_target_cart
        where reservation_id = guest_cart.id;
      insert into public.cart_service_interests (reservation_id, hotel_entitlement_id, service_type)
        select v_target_cart, hotel_entitlement_id, service_type
          from public.cart_service_interests
          where reservation_id = guest_cart.id
        on conflict do nothing;
      update public.reservations as target_cart
        set first_name = coalesce(nullif(target_cart.first_name, ''), guest_cart.first_name),
            last_name = coalesce(nullif(target_cart.last_name, ''), guest_cart.last_name),
            email = coalesce(nullif(target_cart.email, ''), guest_cart.email),
            phone = coalesce(nullif(target_cart.phone, ''), guest_cart.phone),
            notes = coalesce(nullif(target_cart.notes, ''), guest_cart.notes)
        where target_cart.id = v_target_cart;
      delete from public.reservations where id = guest_cart.id;
      get diagnostics v_rows = row_count;
      v_claimed := v_claimed + v_rows;
    end if;
  end loop;

  return v_claimed;
end;
$$;

revoke all on function public.claim_guest_reservations() from public, anon;
grant execute on function public.claim_guest_reservations() to authenticated;
