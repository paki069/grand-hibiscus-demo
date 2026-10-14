create or replace function public._birthday_is_observed(p_birthday date, p_today date)
returns boolean
language sql immutable
set search_path = public as $$
  select coalesce(
    p_birthday is not null
    and p_today is not null
    and (
      (extract(month from p_birthday) = extract(month from p_today)
        and extract(day from p_birthday) = extract(day from p_today))
      or (
        extract(month from p_birthday) = 2
        and extract(day from p_birthday) = 29
        and not (
          mod(extract(year from p_today)::integer, 400) = 0
          or (
            mod(extract(year from p_today)::integer, 4) = 0
            and mod(extract(year from p_today)::integer, 100) <> 0
          )
        )
        and (
          (extract(month from p_today) = 2 and extract(day from p_today) = 28)
          or (extract(month from p_today) = 3 and extract(day from p_today) = 1)
        )
      )
    ),
    false
  )
$$;

create or replace function public._issue_birthday_reward(p_customer uuid, p_claim_method text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_birthday date;
  v_today date := (now() at time zone public.hotel_tz())::date;
  v_year integer := extract(year from (now() at time zone public.hotel_tz()))::integer;
  v_reference text;
  v_inserted integer;
  v_balance integer;
begin
  select birthday into v_birthday
  from public.profiles
  where id = p_customer and role = 'customer' and active
  for update;
  if not found or v_birthday is null then raise exception 'birthday_not_on_file'; end if;
  if not public._birthday_is_observed(v_birthday, v_today) then raise exception 'birthday_reward_not_today'; end if;

  v_reference := 'birthday:' || p_customer::text || ':' || v_year::text;
  insert into public.loyalty_point_ledger (
    customer_id, reference_key, entry_type, points, description, details
  ) values (
    p_customer, v_reference, 'earn', 100, 'Birthday gift · 100 points',
    jsonb_build_object(
      'claim_method', p_claim_method,
      'birthday_year', v_year,
      'verified_by', case when p_claim_method = 'front_desk' then auth.uid() else null end
    )
  ) on conflict (reference_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then raise exception 'birthday_reward_already_claimed'; end if;

  select coalesce(sum(points), 0)::integer into v_balance
  from public.loyalty_point_ledger
  where customer_id = p_customer;
  return v_balance;
end $$;

create or replace function public.my_birthday_reward_status()
returns table (
  birthday date,
  birthday_today boolean,
  already_claimed boolean,
  can_claim boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_birthday date;
  v_today date := (now() at time zone public.hotel_tz())::date;
  v_year integer := extract(year from (now() at time zone public.hotel_tz()))::integer;
  v_claimed boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select profile.birthday into v_birthday
  from public.profiles profile
  where profile.id = auth.uid() and profile.active;
  if not found then raise exception 'loyalty_customer_unavailable'; end if;

  select exists (
    select 1 from public.loyalty_point_ledger
    where customer_id = auth.uid()
      and reference_key = 'birthday:' || auth.uid()::text || ':' || v_year::text
  ) into v_claimed;

  return query select
    v_birthday,
    public._birthday_is_observed(v_birthday, v_today),
    v_claimed,
    public._birthday_is_observed(v_birthday, v_today) and not v_claimed;
end $$;

create or replace function public.claim_my_birthday_reward()
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public._issue_birthday_reward(auth.uid(), 'guest');
end $$;

create or replace function public.staff_find_birthday_guest(p_email text)
returns table (
  customer_id uuid,
  first_name text,
  last_name text,
  birthday date,
  birthday_today boolean,
  already_claimed boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone public.hotel_tz())::date;
  v_year integer := extract(year from (now() at time zone public.hotel_tz()))::integer;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.staff_area('hotel') then raise exception 'forbidden'; end if;
  if length(v_email) < 3 or length(v_email) > 254 then raise exception 'birthday_guest_search_invalid'; end if;

  return query
  select profile.id, profile.first_name, profile.last_name, profile.birthday,
    public._birthday_is_observed(profile.birthday, v_today),
    exists (
      select 1 from public.loyalty_point_ledger ledger
      where ledger.customer_id = profile.id
        and ledger.reference_key = 'birthday:' || profile.id::text || ':' || v_year::text
    )
  from public.profiles profile
  where profile.role = 'customer'
    and profile.active
    and lower(profile.email) = v_email
  limit 1;
end $$;

create or replace function public.staff_award_birthday_reward(p_customer uuid)
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.staff_area('hotel') then raise exception 'forbidden'; end if;
  return public._issue_birthday_reward(p_customer, 'front_desk');
end $$;

revoke all on function public._birthday_is_observed(date, date),
  public._issue_birthday_reward(uuid, text),
  public.my_birthday_reward_status(),
  public.claim_my_birthday_reward(),
  public.staff_find_birthday_guest(text),
  public.staff_award_birthday_reward(uuid)
  from public, anon;
revoke all on function public._birthday_is_observed(date, date),
  public._issue_birthday_reward(uuid, text)
  from authenticated;
grant execute on function public.my_birthday_reward_status(),
  public.claim_my_birthday_reward(),
  public.staff_find_birthday_guest(text),
  public.staff_award_birthday_reward(uuid)
  to authenticated;
