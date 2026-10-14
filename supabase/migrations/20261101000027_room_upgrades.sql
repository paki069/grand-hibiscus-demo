create or replace function public.add_room_to_cart(p_room_type uuid, p_checkin date, p_checkout date,
  p_adults int, p_children int, p_addons uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare rt public.room_types; s public.settings; v_cart uuid; v_room uuid; v_nights int; v_rate numeric;
  v_addons numeric := 0; v_meta jsonb := '[]'; v_ent uuid; a public.room_addons; v_line numeric; n int := 0;
  v_room_no text;
begin
  v_cart := public._cart_id();
  perform public.release_expired_holds();
  select * into s from public.settings where id = 1;
  select * into rt from public.room_types where id = p_room_type and active for update;
  if not found then raise exception 'room_type_unavailable'; end if;
  if p_checkin is null or p_checkout is null or p_checkin < (now() at time zone s.timezone)::date or p_checkout <= p_checkin then
    raise exception 'invalid_dates'; end if;
  v_nights := p_checkout - p_checkin;
  if v_nights < rt.min_nights or v_nights > rt.max_nights then raise exception 'stay_length_not_allowed'; end if;
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or p_adults > rt.max_adults
     or p_children > rt.max_children or p_adults + p_children > rt.max_occupancy then
    raise exception 'occupancy_exceeded'; end if;
  v_room := public._free_room(rt.id, p_checkin, p_checkout);
  if v_room is null then raise exception 'sold_out'; end if;
  v_rate := public._room_total(rt.id, p_checkin, p_checkout);

  p_addons := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_addons, '{}')) x);
  for a in select * from public.room_addons where id = any (p_addons) loop
    if not a.active or a.kind <> 'addon' or (a.room_type_id is not null and a.room_type_id <> rt.id) then
      raise exception 'addon_unavailable';
    end if;
    v_line := case a.pricing when 'per_night' then a.price * v_nights
                             when 'per_guest' then a.price * (p_adults + p_children) else a.price end;
    v_addons := v_addons + v_line; n := n + 1;
    v_meta := v_meta || jsonb_build_array(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'price', v_line));
  end loop;
  if n <> cardinality(p_addons) then raise exception 'addon_unavailable'; end if;
  select number into v_room_no from public.rooms where id = v_room;

  insert into public.entitlements (reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until,
      adults, children, total, meta, status, hold_expires_at)
  values (v_cart, 'hotel', rt.name, v_nights || ' night' || case when v_nights > 1 then 's' else '' end,
      public.local_ts(p_checkin, s.checkin_time), public.local_ts(p_checkout, s.checkout_time),
      public.local_ts(p_checkin, '00:00'), public.local_ts(p_checkout, s.checkout_time),
      p_adults, p_children, v_rate + v_addons,
      jsonb_build_object('room_type_id', rt.id, 'room_number', v_room_no, 'checkin', p_checkin, 'checkout', p_checkout,
                         'nights', v_nights, 'room_total', v_rate, 'addons', v_meta),
      'held', now() + make_interval(mins => s.hold_minutes))
  returning id into v_ent;
  begin
    insert into public.room_stays (entitlement_id, room_id, stay) values (v_ent, v_room, daterange(p_checkin, p_checkout, '[)'));
  exception when exclusion_violation then raise exception 'sold_out';
  end;
  return v_ent;
end $$;

create or replace function public.set_cart_room_upgrades(p_room_selections jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cart uuid;
  v_selection jsonb;
  v_choice jsonb;
  v_room_id uuid;
  v_upgrade_id uuid;
  v_ent public.entitlements;
  v_addon public.room_addons;
  v_existing jsonb;
  v_room_type uuid;
  v_checkin date;
  v_checkout date;
  v_nights integer;
  v_old_total numeric;
  v_new_total numeric;
  v_line numeric;
  v_details text;
  v_room_upgrades jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_room_selections is null or jsonb_typeof(p_room_selections) is distinct from 'array' then
    raise exception 'invalid_upgrade_selection';
  end if;

  v_cart := public._cart_id();
  perform public.release_expired_holds();

  if (select count(distinct value->>'room_id') from jsonb_array_elements(p_room_selections))
      <> jsonb_array_length(p_room_selections) then
    raise exception 'invalid_upgrade_selection';
  end if;

  for v_selection in select value from jsonb_array_elements(p_room_selections) loop
    if jsonb_typeof(v_selection) is distinct from 'object'
       or not coalesce(v_selection->>'room_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
       or jsonb_typeof(v_selection->'upgrades') is distinct from 'array' then
      raise exception 'invalid_upgrade_selection';
    end if;
    v_room_id := (v_selection->>'room_id')::uuid;

    select * into v_ent
    from public.entitlements
    where id = v_room_id and reservation_id = v_cart
      and service_type = 'hotel' and status in ('held', 'active')
    for update;
    if not found then raise exception 'cart_room_not_found'; end if;
    select room.room_type_id, lower(stay.stay), upper(stay.stay)
      into v_room_type, v_checkin, v_checkout
    from public.room_stays stay
    join public.rooms room on room.id = stay.room_id
    where stay.entitlement_id = v_ent.id;
    if not found then raise exception 'cart_room_not_found'; end if;

    select coalesce(sum((upgrade->>'total')::numeric), 0) into v_old_total
    from jsonb_array_elements(coalesce(v_ent.meta->'room_upgrades', '[]'::jsonb)) as old_upgrades(upgrade);
    v_new_total := 0;
    v_room_upgrades := '[]'::jsonb;
    v_nights := v_checkout - v_checkin;

    if exists (
      select 1
      from jsonb_array_elements(v_selection->'upgrades') as choices(choice)
      group by choice->>'upgrade_id'
      having count(*) > 1
    ) then
      raise exception 'invalid_upgrade_selection';
    end if;

    for v_choice in select value from jsonb_array_elements(v_selection->'upgrades') loop
      if jsonb_typeof(v_choice) is distinct from 'object'
         or not coalesce(v_choice->>'upgrade_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) then
        raise exception 'invalid_upgrade_selection';
      end if;
      v_upgrade_id := (v_choice->>'upgrade_id')::uuid;
      v_existing := null;
      select existing_upgrade into v_existing
      from jsonb_array_elements(coalesce(v_ent.meta->'room_upgrades', '[]'::jsonb)) as existing_upgrades(existing_upgrade)
      where existing_upgrade->>'id' = v_upgrade_id::text
      limit 1;
      if v_existing is not null then
        v_line := coalesce((v_existing->>'total')::numeric, 0);
        v_details := nullif(left(btrim(coalesce(v_choice->>'details', '')), 1000), '');
        v_room_upgrades := v_room_upgrades || jsonb_build_array(v_existing || jsonb_build_object('details', v_details));
        v_new_total := v_new_total + v_line;
        continue;
      end if;

      select * into v_addon
      from public.room_addons
      where id = v_upgrade_id and active and kind = 'upgrade'
        and (room_type_id is null or room_type_id = v_room_type);
      if not found then raise exception 'upgrade_unavailable'; end if;

      v_line := case v_addon.pricing
        when 'per_night' then v_addon.price * v_nights
        when 'per_guest' then v_addon.price * (v_ent.adults + v_ent.children)
        else v_addon.price
      end;
      v_details := nullif(left(btrim(coalesce(v_choice->>'details', '')), 1000), '');
      v_room_upgrades := v_room_upgrades || jsonb_build_array(jsonb_build_object(
        'id', v_addon.id, 'name', v_addon.name, 'description', v_addon.description,
        'pricing', v_addon.pricing, 'unit_price', v_addon.price, 'total', v_line, 'details', v_details
      ));
      v_new_total := v_new_total + v_line;
    end loop;

    update public.entitlements
    set total = round(total - v_old_total + v_new_total, 2),
        meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('room_upgrades', v_room_upgrades)
    where id = v_ent.id;
  end loop;
end $$;

revoke execute on function public.set_cart_room_upgrades(jsonb) from public, anon;
grant execute on function public.set_cart_room_upgrades(jsonb) to authenticated;

create or replace function public._guard_room_addon_room_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'addon' and new.room_type_id is not null then
    if tg_op = 'INSERT' or old.kind <> 'addon' or new.room_type_id is distinct from old.room_type_id then
      raise exception 'addon_room_type_requires_upgrade';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists room_addon_room_type_guard on public.room_addons;
create trigger room_addon_room_type_guard
before insert or update of kind, room_type_id on public.room_addons
for each row execute function public._guard_room_addon_room_type();

update public.room_addons
set kind = 'upgrade'
where kind = 'addon' and lower(btrim(name)) = 'late checkout';

insert into public.room_addons (name, description, kind, price, pricing, active)
select template.name, template.description, 'upgrade', 0, 'per_stay', false
from (values
  ('Airport pickup', 'Configure the price and details for pickup from the airport.'),
  ('Airport drop-off', 'Configure the price and details for drop-off at the airport.'),
  ('Early check-in', 'Configure the price and earliest available check-in time.')
) as template(name, description)
where not exists (
  select 1 from public.room_addons existing
  where existing.kind = 'upgrade' and lower(btrim(existing.name)) = lower(template.name)
);
