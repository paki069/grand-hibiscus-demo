create function public.sync_room_linked_hold_expiry()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_room_expiry timestamptz;
begin
  if new.parent_entitlement_id is null
     or new.service_type not in ('restaurant', 'spa', 'event') then
    return new;
  end if;

  select room.hold_expires_at
  into v_room_expiry
  from public.entitlements room
  where room.id = new.parent_entitlement_id
    and room.reservation_id = new.reservation_id
    and room.service_type = 'hotel'
    and room.status = 'held';
  if not found then raise exception 'room_not_in_cart'; end if;

  new.hold_expires_at := v_room_expiry;
  return new;
end $$;

create trigger room_linked_hold_expiry_sync
before insert or update of parent_entitlement_id on public.entitlements
for each row execute function public.sync_room_linked_hold_expiry();

create function public.propagate_room_hold_expiry()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.service_type = 'hotel'
     and new.hold_expires_at is distinct from old.hold_expires_at then
    update public.entitlements
    set hold_expires_at = new.hold_expires_at
    where parent_entitlement_id = new.id
      and service_type in ('restaurant', 'spa', 'event')
      and status = 'held'
      and hold_expires_at is distinct from new.hold_expires_at;
  end if;
  return new;
end $$;

create trigger propagate_room_hold_expiry
after update of hold_expires_at on public.entitlements
for each row execute function public.propagate_room_hold_expiry();

update public.entitlements child
set hold_expires_at = room.hold_expires_at
from public.entitlements room
where child.parent_entitlement_id = room.id
  and child.reservation_id = room.reservation_id
  and child.service_type in ('restaurant', 'spa', 'event')
  and child.status = 'held'
  and room.service_type = 'hotel'
  and room.status = 'held'
  and child.hold_expires_at is distinct from room.hold_expires_at;
