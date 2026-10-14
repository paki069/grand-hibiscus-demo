create or replace function public.staff_room_requests()
returns table (
  entitlement_id uuid,
  reservation_reference text,
  guest_name text,
  room_title text,
  room_number text,
  checkin timestamptz,
  checkout timestamptz,
  reservation_status text,
  request_kind text,
  request_name text,
  request_details text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.staff_area('hotel') then raise exception 'forbidden'; end if;

  return query
  with booked_rooms as (
    select e.id,
      r.reference,
      concat_ws(' ', nullif(btrim(r.first_name), ''),
        case when nullif(btrim(r.last_name), '') is not null then left(btrim(r.last_name), 1) || '.' end) as guest_name,
      e.title,
      e.meta->>'room_number' as room_number,
      e.starts_at,
      e.ends_at,
      r.status::text as reservation_status,
      case when jsonb_typeof(e.meta->'addons') = 'array' then e.meta->'addons' else '[]'::jsonb end as addons,
      case when jsonb_typeof(e.meta->'room_upgrades') = 'array' then e.meta->'room_upgrades' else '[]'::jsonb end as room_upgrades
    from public.entitlements e
    join public.reservations r on r.id = e.reservation_id
    where e.service_type = 'hotel'
      and e.status = 'active'
      and r.status in ('pending', 'confirmed')
      and e.ends_at > now()
  ),
  requests as (
    select room.id as entitlement_id, room.reference, room.guest_name, room.title, room.room_number,
      room.starts_at, room.ends_at, room.reservation_status, 'addon'::text as request_kind,
      item.value->>'name' as request_name, null::text as request_details, item.ordinality
    from booked_rooms room
    cross join lateral jsonb_array_elements(room.addons) with ordinality as item(value, ordinality)
    where item.value->>'kind' = 'addon'
      and nullif(btrim(item.value->>'name'), '') is not null

    union all

    select room.id, room.reference, room.guest_name, room.title, room.room_number,
      room.starts_at, room.ends_at, room.reservation_status, 'upgrade'::text,
      item.value->>'name', nullif(btrim(item.value->>'details'), ''), item.ordinality
    from booked_rooms room
    cross join lateral jsonb_array_elements(room.room_upgrades) with ordinality as item(value, ordinality)
    where nullif(btrim(item.value->>'name'), '') is not null

    union all

    select room.id, room.reference, room.guest_name, room.title, room.room_number,
      room.starts_at, room.ends_at, room.reservation_status, 'upgrade'::text,
      item.value->>'name', null::text, item.ordinality
    from booked_rooms room
    cross join lateral jsonb_array_elements(room.addons) with ordinality as item(value, ordinality)
    where item.value->>'kind' = 'upgrade'
      and nullif(btrim(item.value->>'name'), '') is not null
  )
  select requests.entitlement_id, requests.reference, requests.guest_name, requests.title, requests.room_number,
    requests.starts_at, requests.ends_at, requests.reservation_status, requests.request_kind,
    requests.request_name, requests.request_details
  from requests
  order by requests.starts_at, requests.guest_name, requests.title, requests.request_name, requests.ordinality;
end $$;

revoke all on function public.staff_room_requests() from public, anon;
grant execute on function public.staff_room_requests() to authenticated;
