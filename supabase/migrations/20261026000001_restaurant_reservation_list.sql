create function public.restaurant_reservations(
  p_date date,
  p_from_time time default null,
  p_to_time time default null
)
returns table (
  reservation_id uuid,
  reference text,
  guest_name text,
  reservation_status text,
  entitlement_id uuid,
  title text,
  detail text,
  starts_at timestamptz,
  ends_at timestamptz,
  adults int,
  children int,
  service_status text,
  checked_in_at timestamptz,
  area_name text,
  table_label text,
  party_size int,
  seat_labels text[]
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.staff_area('restaurant') then raise exception 'forbidden'; end if;
  if p_from_time is not null and p_to_time is not null and p_from_time > p_to_time then
    raise exception 'invalid_time_range';
  end if;

  return query
  select r.id,
         r.reference,
         r.first_name || ' ' || left(r.last_name, 1) || '.',
         r.status::text,
         e.id,
         e.title,
         e.detail,
         e.starts_at,
         e.ends_at,
         e.adults,
         e.children,
         e.status,
         e.checked_in_at,
         area.name,
         seating_table.label,
         table_reservation.party_size,
         coalesce(array_agg(distinct seat.label order by seat.label) filter (where seat.label is not null), '{}')
  from public.entitlements e
  join public.reservations r on r.id = e.reservation_id
  join public.table_reservations table_reservation on table_reservation.entitlement_id = e.id
  join public.seating_tables seating_table on seating_table.id = table_reservation.table_id
  join public.seating_areas area on area.id = seating_table.area_id
  left join public.seats seat on seat.id = table_reservation.seat_id
  where e.service_type = 'restaurant'
    and e.status = 'active'
    and r.status in ('pending', 'confirmed', 'completed')
    and (e.starts_at at time zone public.hotel_tz())::date = p_date
    and (p_from_time is null or (e.starts_at at time zone public.hotel_tz())::time >= p_from_time)
    and (p_to_time is null or (e.starts_at at time zone public.hotel_tz())::time <= p_to_time)
  group by r.id, r.reference, r.first_name, r.last_name, r.status,
           e.id, e.title, e.detail, e.starts_at, e.ends_at, e.adults, e.children, e.status, e.checked_in_at,
           area.name, seating_table.label, table_reservation.party_size
  order by e.starts_at, seating_table.label;
end $$;

revoke execute on function public.restaurant_reservations(date, time, time) from public, anon, authenticated;
grant execute on function public.restaurant_reservations(date, time, time) to authenticated;
