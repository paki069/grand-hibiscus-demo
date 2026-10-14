alter table public.spa_service_availability
  add column if not exists weekday int;

do $$
declare
  old_constraint record;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'spa_service_availability' and column_name = 'service_date'
  ) then
    for old_constraint in
      select conname from pg_constraint
      where conrelid = 'public.spa_service_availability'::regclass and contype = 'x'
    loop
      execute format('alter table public.spa_service_availability drop constraint %I', old_constraint.conname);
    end loop;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'spa_service_availability' and column_name = 'window_range'
    ) then
      alter table public.spa_service_availability drop column window_range;
    end if;
    alter table public.spa_service_availability alter column service_date drop not null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.spa_service_availability'::regclass
      and conname = 'spa_service_availability_weekday_check'
  ) then
    alter table public.spa_service_availability
      add constraint spa_service_availability_weekday_check check (weekday is null or weekday between 0 and 6);
  end if;
end $$;

create unique index if not exists spa_service_availability_service_weekday_uq
  on public.spa_service_availability (service_id, weekday);

alter table public.spa_appointments
  alter column resource_id drop not null,
  add column if not exists availability_id uuid references public.spa_service_availability (id) on delete set null,
  drop constraint if exists spa_appointments_resource_id_during_excl;

create index if not exists spa_appointments_service_slot_idx
  on public.spa_appointments (service_id, (lower(during)))
  where status <> 'released';

create or replace function public.save_spa_weekly_availability(p_service uuid, p_schedule jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  day_entry jsonb;
  seen_days int[] := '{}';
  open_days int[] := '{}';
  v_weekday int;
  v_start time;
  v_end time;
  v_capacity int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.spa_services where id = p_service) then
    raise exception 'service_unavailable';
  end if;
  if jsonb_typeof(p_schedule) <> 'array' then raise exception 'invalid_schedule'; end if;

  for day_entry in select value from jsonb_array_elements(p_schedule)
  loop
    v_weekday := (day_entry->>'weekday')::int;
    if v_weekday is null or v_weekday < 0 or v_weekday > 6 or v_weekday = any(seen_days) then
      raise exception 'invalid_schedule';
    end if;
    seen_days := array_append(seen_days, v_weekday);

    if coalesce((day_entry->>'open')::boolean, false) then
      v_start := (day_entry->>'start_time')::time;
      v_end := (day_entry->>'end_time')::time;
      v_capacity := (day_entry->>'capacity')::int;
      if v_start is null or v_end is null or v_end <= v_start
         or v_capacity is null or v_capacity < 1 or v_capacity > 100 then
        raise exception 'invalid_schedule';
      end if;
      insert into public.spa_service_availability (service_id, weekday, start_time, end_time, capacity)
      values (p_service, v_weekday, v_start, v_end, v_capacity)
      on conflict (service_id, weekday) do update
        set start_time = excluded.start_time, end_time = excluded.end_time, capacity = excluded.capacity;
      open_days := array_append(open_days, v_weekday);
    end if;
  end loop;

  if cardinality(seen_days) <> 7 then raise exception 'invalid_schedule'; end if;
  update public.spa_appointments
  set availability_id = null
  where availability_id in (
    select id from public.spa_service_availability
    where service_id = p_service and weekday is not null and not (weekday = any(open_days))
  );
  delete from public.spa_service_availability
  where service_id = p_service and weekday is not null and not (weekday = any(open_days));
end $$;

revoke execute on function public.save_spa_weekly_availability(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_spa_weekly_availability(uuid, jsonb) to authenticated;

create or replace function public.spa_available_slots(p_service uuid, p_date date)
returns table (slot_start timestamptz)
language sql stable security definer set search_path = public as $$
  select slot.slot_start
  from public.spa_service_availability availability
  join public.spa_services svc on svc.id = availability.service_id
  cross join lateral generate_series(
    public.local_ts(p_date, availability.start_time),
    public.local_ts(p_date, availability.end_time) - make_interval(mins => svc.duration_min),
    make_interval(mins => svc.duration_min)
  ) as slot(slot_start)
  where availability.service_id = p_service
    and availability.weekday = extract(dow from p_date)::int
    and svc.active
    and slot.slot_start > now()
    and (
      select count(*)
      from public.spa_appointments a
      where a.service_id = p_service
        and a.status <> 'released'
        and lower(a.during) = slot.slot_start
        and public._blocking(a.entitlement_id)
    ) < availability.capacity
  order by slot.slot_start
$$;

create or replace function public.add_spa_to_cart(p_service uuid, p_start timestamptz, p_adults int, p_children int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  svc public.spa_services;
  availability public.spa_service_availability;
  s public.settings;
  v_cart uuid;
  v_res uuid;
  v_ent uuid;
  v_date date;
  v_weekday int;
  v_local_time time;
  v_open timestamptz;
  v_close timestamptz;
  v_end timestamptz;
  v_booked int;
  v_guests int;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select * into svc from public.spa_services where id = p_service and active;
  if not found then raise exception 'service_unavailable'; end if;

  v_guests := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or v_guests > svc.max_guests then
    raise exception 'invalid_party';
  end if;
  if p_start is null or p_start <= now() then raise exception 'invalid_time'; end if;

  v_date := (p_start at time zone public.hotel_tz())::date;
  v_weekday := extract(dow from v_date)::int;
  v_local_time := (p_start at time zone public.hotel_tz())::time;
  select * into availability
  from public.spa_service_availability
  where service_id = p_service
    and weekday = v_weekday
    and start_time <= v_local_time
    and end_time > v_local_time
  for update;
  if not found then raise exception 'slot_unavailable'; end if;

  v_open := public.local_ts(v_date, availability.start_time);
  v_close := public.local_ts(v_date, availability.end_time);
  if p_start < v_open
     or p_start + make_interval(mins => svc.duration_min) > v_close
     or mod(extract(epoch from (p_start - v_open))::bigint, (svc.duration_min * 60)::bigint) <> 0 then
    raise exception 'invalid_time';
  end if;

  select count(*)::int into v_booked
  from public.spa_appointments a
  where a.service_id = p_service
    and a.status <> 'released'
    and lower(a.during) = p_start
    and public._blocking(a.entitlement_id);
  if v_booked >= availability.capacity then raise exception 'slot_taken'; end if;

  v_end := p_start + make_interval(mins => svc.duration_min);
  insert into public.entitlements (
    reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
    adults, children, total, meta, status, hold_expires_at
  )
  values (
    v_cart, 'spa', svc.name,
    svc.duration_min || ' min' || case when v_guests > 1 then ' · ' || v_guests || ' guests' else '' end,
    p_start, v_end, p_start - interval '30 minutes', v_end, p_adults, p_children,
    coalesce(svc.price, 0) * v_guests,
    jsonb_build_object('service_id', svc.id, 'price_configured', svc.price is not null),
    'held', now() + make_interval(mins => s.hold_minutes)
  )
  returning id into v_ent;

  insert into public.spa_appointments (entitlement_id, service_id, resource_id, availability_id, during)
  values (v_ent, svc.id, null, availability.id, tstzrange(p_start, v_end, '[)'));
  return v_ent;
end $$;
