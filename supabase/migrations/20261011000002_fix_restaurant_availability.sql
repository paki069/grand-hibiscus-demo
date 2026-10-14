create or replace function public.restaurant_availability(p_date date, p_time time)
returns table (table_id uuid, taken boolean, taken_seat_ids uuid[])
language sql stable security definer set search_path = public as $$
  with w as (
    select public.local_ts(p_date, p_time) as s,
           public.local_ts(p_date, p_time)
             + make_interval(mins => (select dwell_minutes from public.restaurant_config where id = 1)) as e
  )
  select t.id,
         coalesce(bool_or(tr.entitlement_id is not null and tr.seat_id is null), false),
         coalesce(array_agg(tr.seat_id) filter (where tr.seat_id is not null), '{}')
  from public.seating_tables t cross join w
  left join public.table_reservations tr on tr.table_id = t.id and tr.status <> 'released'
       and tr.during && tstzrange(w.s, w.e, '[)') and public._blocking(tr.entitlement_id)
  where t.active
  group by t.id
$$;
