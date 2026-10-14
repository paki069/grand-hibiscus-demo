create function public._refresh_room_early_checkin(p_hotel_entitlement uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room public.entitlements;
  v_settings public.settings;
  v_standard timestamptz;
  v_early timestamptz;
  v_source uuid;
  v_meta jsonb;
begin
  select * into v_room from public.entitlements where id = p_hotel_entitlement for update;
  if not found or v_room.service_type <> 'hotel' then raise exception 'room_not_in_cart'; end if;
  select * into v_settings from public.settings where id = 1;

  v_standard := coalesce(
    (v_room.meta ->> 'standard_checkin_at')::timestamptz,
    public.local_ts((v_room.meta ->> 'checkin')::date, v_settings.checkin_time)
  );
  select e.ends_at, e.id into v_early, v_source
  from public.entitlements e
  where e.parent_entitlement_id = p_hotel_entitlement
    and e.service_type = 'restaurant'
    and e.status = 'held'
    and e.hold_expires_at > now()
    and (e.starts_at at time zone v_settings.timezone)::date = (v_room.meta ->> 'checkin')::date
    and e.ends_at < v_standard
  order by e.ends_at, e.id
  limit 1;

  v_meta := v_room.meta - 'early_checkin_guaranteed' - 'early_checkin_at' - 'early_checkin_source_entitlement';
  if v_early is not null then
    v_meta := v_meta || jsonb_build_object(
      'standard_checkin_at', v_standard,
      'early_checkin_guaranteed', true,
      'early_checkin_at', v_early,
      'early_checkin_source_entitlement', v_source
    );
  else
    v_meta := v_meta - 'standard_checkin_at';
  end if;

  update public.entitlements
  set starts_at = coalesce(v_early, v_standard),
      eligible_from = coalesce(v_early, v_standard),
      meta = v_meta
  where id = p_hotel_entitlement
    and (starts_at is distinct from coalesce(v_early, v_standard) or meta is distinct from v_meta);

  if v_early is not null and (
    v_room.meta ->> 'early_checkin_guaranteed' is distinct from 'true'
    or v_room.starts_at is distinct from v_early
  ) then
    perform public.log_audit('early_checkin.guaranteed', 'entitlement', p_hotel_entitlement::text,
      jsonb_build_object('room_number', v_room.meta ->> 'room_number', 'ready_at', v_early, 'restaurant_entitlement_id', v_source));
  elsif v_early is null and v_room.meta ->> 'early_checkin_guaranteed' = 'true' then
    perform public.log_audit('early_checkin.reset', 'entitlement', p_hotel_entitlement::text,
      jsonb_build_object('room_number', v_room.meta ->> 'room_number', 'restored_checkin_at', v_standard));
  end if;
end $$;

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
  if cardinality(ids) = 0 then return 0; end if;
  update public.room_stays set status = 'released' where entitlement_id = any (ids);
  update public.table_reservations set status = 'released' where entitlement_id = any (ids);
  update public.spa_appointments set status = 'released' where entitlement_id = any (ids);
  update public.event_bookings set status = 'released' where entitlement_id = any (ids);
  foreach room_id in array room_ids loop
    perform public._refresh_room_early_checkin(room_id);
  end loop;
  return cardinality(ids);
end $$;

create or replace function public.add_restaurant_to_room_cart(
  p_hotel_entitlement uuid, p_table uuid, p_seats uuid[], p_date date, p_time time, p_adults int, p_children int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_res uuid; v_ent uuid;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  perform public.release_expired_holds();
  perform 1 from public.entitlements where id = p_hotel_entitlement for update;
  v_ent := public.add_restaurant_to_cart(p_table, p_seats, p_date, p_time, p_adults, p_children);
  update public.entitlements set parent_entitlement_id = p_hotel_entitlement
  where id = v_ent and reservation_id = v_res and service_type = 'restaurant';
  if not found then raise exception 'cart_item_not_found'; end if;
  perform public._refresh_room_early_checkin(p_hotel_entitlement);
  return v_ent;
end $$;

create or replace function public.remove_cart_item(p_ent uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_parent uuid; v_service public.service_type;
begin
  select e.parent_entitlement_id, e.service_type into v_parent, v_service
  from public.entitlements e join public.reservations r on r.id = e.reservation_id
  where e.id = p_ent and r.customer_id = auth.uid() and r.status = 'cart';
  if not found then raise exception 'not_found'; end if;

  delete from public.entitlements e using public.reservations r
  where e.id = p_ent and r.id = e.reservation_id and r.customer_id = auth.uid() and r.status = 'cart';
  if not found then raise exception 'not_found'; end if;
  if v_service = 'restaurant' and v_parent is not null then
    perform public._refresh_room_early_checkin(v_parent);
  end if;
end $$;

revoke execute on function public._refresh_room_early_checkin(uuid) from public, anon, authenticated;
