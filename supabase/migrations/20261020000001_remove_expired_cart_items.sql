create or replace function public.release_expired_holds() returns int
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; room_ids uuid[]; room_id uuid;
begin
  with ex as (
    update public.entitlements set status = 'expired'
    where status = 'held' and hold_expires_at < now()
    returning id, parent_entitlement_id
  )
  select coalesce(array_agg(id), '{}'),
         coalesce(array_agg(distinct parent_entitlement_id) filter (where parent_entitlement_id is not null), '{}')
    into ids, room_ids
  from ex;

  if cardinality(ids) > 0 then
    update public.room_stays set status = 'released' where entitlement_id = any (ids);
    update public.table_reservations set status = 'released' where entitlement_id = any (ids);
    update public.spa_appointments set status = 'released' where entitlement_id = any (ids);
    update public.event_bookings set status = 'released' where entitlement_id = any (ids);
    foreach room_id in array room_ids loop
      perform public._refresh_room_early_checkin(room_id);
    end loop;
  end if;

  delete from public.entitlements entitlement
  using public.reservations reservation
  where entitlement.reservation_id = reservation.id
    and reservation.status = 'cart'
    and entitlement.status in ('cancelled', 'refunded', 'expired');

  return cardinality(ids);
end $$;
