create or replace function public.sync_profile_from_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles as profile
  set email = coalesce(nullif(btrim(profile.email), ''), nullif(lower(btrim(new.email)), '')),
      first_name = coalesce(nullif(btrim(profile.first_name), ''), nullif(btrim(new.first_name), ''), ''),
      last_name = coalesce(nullif(btrim(profile.last_name), ''), nullif(btrim(new.last_name), ''), ''),
      phone = coalesce(nullif(btrim(profile.phone), ''), nullif(btrim(new.phone), ''), '')
  where profile.id = new.customer_id
    and (
      nullif(btrim(profile.email), '') is null
      or nullif(btrim(profile.first_name), '') is null
      or nullif(btrim(profile.last_name), '') is null
      or nullif(btrim(profile.phone), '') is null
    );
  return new;
end;
$$;

drop trigger if exists reservations_sync_profile on public.reservations;
create trigger reservations_sync_profile
  after insert or update of customer_id, email, first_name, last_name, phone
  on public.reservations
  for each row execute function public.sync_profile_from_reservation();

with latest_reservation as (
  select distinct on (reservation.customer_id)
    reservation.customer_id,
    reservation.email,
    reservation.first_name,
    reservation.last_name,
    reservation.phone
  from public.reservations as reservation
  where reservation.status <> 'cart'
  order by reservation.customer_id,
    coalesce(reservation.confirmed_at, reservation.placed_at, reservation.created_at) desc,
    reservation.created_at desc,
    reservation.id desc
)
update public.profiles as profile
set email = coalesce(nullif(btrim(profile.email), ''), nullif(btrim(auth_user.email), ''), nullif(lower(btrim(booking.email)), '')),
    first_name = coalesce(nullif(btrim(profile.first_name), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'first_name'), ''), nullif(btrim(booking.first_name), ''), ''),
    last_name = coalesce(nullif(btrim(profile.last_name), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'last_name'), ''), nullif(btrim(booking.last_name), ''), ''),
    phone = coalesce(nullif(btrim(profile.phone), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'phone'), ''), nullif(btrim(booking.phone), ''), '')
from auth.users as auth_user
left join latest_reservation as booking on booking.customer_id = auth_user.id
where profile.id = auth_user.id
  and (
    nullif(btrim(profile.email), '') is null
    or nullif(btrim(profile.first_name), '') is null
    or nullif(btrim(profile.last_name), '') is null
    or nullif(btrim(profile.phone), '') is null
  );

create or replace function public.claim_guest_reservations()
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
  v_email_matched_guests uuid[] := '{}';
  v_email_matched_reservations uuid[] := '{}';
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

  select coalesce(array_agg(profile.id), '{}'::uuid[])
    into v_email_matched_guests
    from public.profiles as profile
    join auth.users as guest_user on guest_user.id = profile.id
    where coalesce(guest_user.is_anonymous, false)
      and lower(btrim(coalesce(profile.email, ''))) = v_email;

  select coalesce(array_agg(distinct reservation.id), '{}'::uuid[])
    into v_email_matched_reservations
    from public.reservations as reservation
    join auth.users as guest_user on guest_user.id = reservation.customer_id
    where coalesce(guest_user.is_anonymous, false)
      and reservation.status <> 'cart'
      and lower(btrim(reservation.email)) = v_email;

  update public.loyalty_point_ledger as ledger
    set customer_id = auth.uid()
    where ledger.customer_id = any(v_email_matched_guests)
       or ledger.reservation_id = any(v_email_matched_reservations);

  update public.loyalty_coupons as coupon
    set customer_id = auth.uid()
    where coupon.customer_id = any(v_email_matched_guests)
       or coupon.reservation_id = any(v_email_matched_reservations);

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
      update public.loyalty_coupons
        set customer_id = auth.uid()
        where reservation_id = guest_cart.id;
    else
      update public.entitlements
        set reservation_id = v_target_cart
        where reservation_id = guest_cart.id;
      update public.menu_orders
        set reservation_id = v_target_cart
        where reservation_id = guest_cart.id;
      update public.loyalty_coupons
        set customer_id = auth.uid(),
            reservation_id = v_target_cart
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

create or replace function public.admin_loyalty_customer_accounts()
returns table (
  customer_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  role public.app_role
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  return query
  select profile.id,
         coalesce(nullif(btrim(profile.email), ''), nullif(btrim(auth_user.email), ''), nullif(lower(btrim(booking.email)), '')),
         coalesce(nullif(btrim(profile.first_name), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'first_name'), ''), nullif(btrim(booking.first_name), ''), ''),
         coalesce(nullif(btrim(profile.last_name), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'last_name'), ''), nullif(btrim(booking.last_name), ''), ''),
         coalesce(nullif(btrim(profile.phone), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'phone'), ''), nullif(btrim(booking.phone), ''), ''),
         profile.role
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  left join lateral (
    select reservation.email, reservation.first_name, reservation.last_name, reservation.phone
    from public.reservations as reservation
    where reservation.customer_id = profile.id
      and reservation.status <> 'cart'
    order by coalesce(reservation.confirmed_at, reservation.placed_at, reservation.created_at) desc,
      reservation.created_at desc,
      reservation.id desc
    limit 1
  ) as booking on true
  where profile.role in ('customer', 'admin')
    and not (
      coalesce(auth_user.is_anonymous, false)
      and exists (
        select 1
        from auth.users as verified_user
        where not coalesce(verified_user.is_anonymous, false)
          and verified_user.email_confirmed_at is not null
          and lower(btrim(verified_user.email)) = lower(btrim(coalesce(
            nullif(profile.email, ''),
            nullif(booking.email, ''),
            nullif(auth_user.email, '')
          )))
      )
    )
  order by profile.last_name, profile.first_name, auth_user.email, profile.id
  limit 1000;
end;
$$;

create or replace function public.admin_loyalty_customer_balances(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  customer_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  points_balance bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if length(coalesce(p_search, '')) > 100 or p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'loyalty_admin_search_invalid';
  end if;

  return query
  with account_contacts as (
    select profile.id,
           coalesce(nullif(btrim(profile.email), ''), nullif(btrim(auth_user.email), ''), nullif(lower(btrim(booking.email)), '')) as email,
           coalesce(nullif(btrim(profile.first_name), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'first_name'), ''), nullif(btrim(booking.first_name), ''), '') as first_name,
           coalesce(nullif(btrim(profile.last_name), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'last_name'), ''), nullif(btrim(booking.last_name), ''), '') as last_name,
           coalesce(nullif(btrim(profile.phone), ''), nullif(btrim(auth_user.raw_user_meta_data ->> 'phone'), ''), nullif(btrim(booking.phone), ''), '') as phone
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    left join lateral (
      select reservation.email, reservation.first_name, reservation.last_name, reservation.phone
      from public.reservations as reservation
      where reservation.customer_id = profile.id
        and reservation.status <> 'cart'
      order by coalesce(reservation.confirmed_at, reservation.placed_at, reservation.created_at) desc,
        reservation.created_at desc,
        reservation.id desc
      limit 1
    ) as booking on true
    where profile.role in ('customer', 'admin')
      and not (
        coalesce(auth_user.is_anonymous, false)
        and exists (
          select 1
          from auth.users as verified_user
          where not coalesce(verified_user.is_anonymous, false)
            and verified_user.email_confirmed_at is not null
            and lower(btrim(verified_user.email)) = lower(btrim(coalesce(
              nullif(profile.email, ''),
              nullif(booking.email, ''),
              nullif(auth_user.email, '')
            )))
        )
      )
  ), balances as (
    select account.id, account.email, account.first_name, account.last_name, account.phone,
           coalesce(sum(ledger.points), 0)::bigint as points_balance
    from account_contacts as account
    left join public.loyalty_point_ledger as ledger on ledger.customer_id = account.id
    where nullif(btrim(p_search), '') is null
       or concat_ws(' ', account.first_name, account.last_name, account.email, account.phone)
          ilike '%' || btrim(p_search) || '%'
    group by account.id, account.email, account.first_name, account.last_name, account.phone
  ), counted as (
    select balances.*, count(*) over ()::bigint as total_count
    from balances
  )
  select counted.id, counted.email, counted.first_name, counted.last_name,
         counted.phone, counted.points_balance, counted.total_count
  from counted
  order by counted.last_name, counted.first_name, counted.email
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_loyalty_customer_accounts() from public, anon;
grant execute on function public.admin_loyalty_customer_accounts() to authenticated;
