create function public.restaurant_reservations(
  p_date date,
  p_from_time time,
  p_to_time time,
  p_code text
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
  return query
  select bookings.reservation_id, bookings.reference, bookings.guest_name, bookings.reservation_status,
         bookings.entitlement_id, bookings.title, bookings.detail, bookings.starts_at, bookings.ends_at,
         bookings.adults, bookings.children, bookings.service_status, bookings.checked_in_at,
         bookings.area_name, bookings.table_label, bookings.party_size, bookings.seat_labels
  from public.restaurant_reservations(p_date, p_from_time, p_to_time) bookings
  where p_code is null or position(upper(btrim(p_code)) in upper(bookings.reference)) > 0;
end $$;

revoke execute on function public.restaurant_reservations(date, time, time, text) from public, anon, authenticated;
grant execute on function public.restaurant_reservations(date, time, time, text) to authenticated;
