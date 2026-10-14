alter table public.loyalty_coupons
  add column if not exists issue_source text not null default 'points'
    check (issue_source in ('points', 'admin')),
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

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
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if length(coalesce(p_search, '')) > 100 or p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'loyalty_admin_search_invalid';
  end if;

  return query
  with balances as (
    select profile.id, profile.email, profile.first_name, profile.last_name, profile.phone,
           coalesce(sum(ledger.points), 0)::bigint as points_balance
    from public.profiles profile
    left join public.loyalty_point_ledger ledger on ledger.customer_id = profile.id
    where profile.role = 'customer'
      and (
        nullif(btrim(p_search), '') is null
        or concat_ws(' ', profile.first_name, profile.last_name, profile.email, profile.phone)
          ilike '%' || btrim(p_search) || '%'
      )
    group by profile.id
  ), counted as (
    select balances.*, count(*) over ()::bigint as total_count
    from balances
  )
  select counted.id, counted.email, counted.first_name, counted.last_name, counted.phone,
         counted.points_balance, counted.total_count
  from counted
  order by counted.last_name, counted.first_name, counted.email
  limit p_limit offset p_offset;
end $$;

create or replace function public.admin_adjust_loyalty_points(
  p_customer uuid,
  p_points integer,
  p_reason text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role;
  v_balance integer;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_customer is null or p_points is null or p_points < 1 or p_points > 100000
     or length(v_reason) < 1 or length(v_reason) > 250 then
    raise exception 'loyalty_admin_adjustment_invalid';
  end if;

  select role into v_role
  from public.profiles
  where id = p_customer
  for update;
  if not found or v_role <> 'customer' then raise exception 'loyalty_customer_unavailable'; end if;

  insert into public.loyalty_point_ledger (
    customer_id, reference_key, entry_type, points, description, details
  ) values (
    p_customer,
    'admin-adjust:' || gen_random_uuid()::text,
    'adjustment',
    p_points,
    'Admin added ' || p_points || ' points: ' || v_reason,
    jsonb_build_object('created_by', auth.uid(), 'reason', v_reason)
  );

  select coalesce(sum(points), 0)::integer into v_balance
  from public.loyalty_point_ledger
  where customer_id = p_customer;

  perform public.log_audit(
    'loyalty.points.adjust',
    'profile',
    p_customer::text,
    jsonb_build_object('points', p_points, 'reason', v_reason)
  );
  return v_balance;
end $$;

create or replace function public.admin_issue_loyalty_coupons(
  p_customer uuid,
  p_room_type uuid,
  p_quantity integer
) returns table (coupon_code text, room_name text, points_value integer)
language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role;
  v_room public.room_types;
  v_code text;
  v_codes text[] := '{}';
  v_i integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_customer is null or p_room_type is null or p_quantity is null
     or p_quantity < 1 or p_quantity > 20 then
    raise exception 'loyalty_admin_coupon_invalid';
  end if;

  select role into v_role
  from public.profiles
  where id = p_customer
  for update;
  if not found or v_role <> 'customer' then raise exception 'loyalty_customer_unavailable'; end if;

  select * into v_room from public.room_types where id = p_room_type and active for share;
  if not found then raise exception 'loyalty_reward_unavailable'; end if;

  for v_i in 1..p_quantity loop
    v_code := 'HIB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    insert into public.loyalty_coupons (
      code, customer_id, room_type_id, points_cost, issue_source, created_by
    ) values (
      v_code, p_customer, v_room.id, v_room.loyalty_free_night_points, 'admin', auth.uid()
    );
    v_codes := array_append(v_codes, v_code);
    coupon_code := v_code;
    room_name := v_room.name;
    points_value := v_room.loyalty_free_night_points;
    return next;
  end loop;

  perform public.log_audit(
    'loyalty.coupons.issue',
    'profile',
    p_customer::text,
    jsonb_build_object(
      'codes', to_jsonb(v_codes),
      'room_type_id', v_room.id,
      'quantity', p_quantity,
      'complimentary', true
    )
  );
end $$;

revoke execute on function public.admin_loyalty_customer_balances(text, integer, integer),
  public.admin_adjust_loyalty_points(uuid, integer, text),
  public.admin_issue_loyalty_coupons(uuid, uuid, integer)
  from public, anon;
grant execute on function public.admin_loyalty_customer_balances(text, integer, integer),
  public.admin_adjust_loyalty_points(uuid, integer, text),
  public.admin_issue_loyalty_coupons(uuid, uuid, integer)
  to authenticated;
