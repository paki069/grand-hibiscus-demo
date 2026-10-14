create function public._resolve_scan_pass(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_pass_id uuid;
begin
  select id into v_pass_id
  from public.qr_passes
  where token = btrim(p_code);
  if found then return v_pass_id; end if;

  select pass.id into v_pass_id
  from public.qr_passes pass
  join public.reservations reservation on reservation.id = pass.reservation_id
  where upper(reservation.reference) = upper(btrim(p_code))
  order by (pass.status = 'active') desc, pass.issued_at desc
  limit 1;
  return v_pass_id;
end $$;

revoke execute on function public._resolve_scan_pass(text) from public, anon, authenticated;

create or replace function public.scan_pass(p_token text, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pass public.qr_passes; r public.reservations; v_svc public.service_type; v_list jsonb; v_state text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where id = public._resolve_scan_pass(p_token);
  if not found then
    perform public.log_audit('scan.unknown', 'qr_pass', null, jsonb_build_object('area', p_area));
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into r from public.reservations where id = pass.reservation_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'detail', e.detail, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'adults', e.adults, 'children', e.children, 'meta', e.meta, 'checked_in_at', e.checked_in_at,
      'state', public._ent_state(e, r, pass)) order by e.starts_at), '[]')
    into v_list from public.entitlements e where e.reservation_id = r.id and e.service_type = v_svc;
  if jsonb_array_length(v_list) = 0 then v_state := 'no_service';
  elsif pass.status = 'revoked' then v_state := 'revoked';
  elsif exists (select 1 from jsonb_array_elements(v_list) x where x ->> 'state' = 'valid') then v_state := 'valid';
  else v_state := v_list -> 0 ->> 'state'; end if;
  return jsonb_build_object('state', v_state, 'area', p_area,
    'reservation', jsonb_build_object('reference', r.reference, 'guest', r.first_name || ' ' || r.last_name, 'status', r.status),
    'entitlements', v_list);
end $$;

create or replace function public.check_in(p_token text, p_entitlement uuid, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pass public.qr_passes; r public.reservations; e public.entitlements; v_svc public.service_type; v_state text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where id = public._resolve_scan_pass(p_token);
  if not found then
    perform public.log_audit('checkin.denied', 'qr_pass', null, jsonb_build_object('area', p_area, 'state', 'unknown'));
    return jsonb_build_object('ok', false, 'state', 'unknown');
  end if;
  update public.entitlements en set checked_in_at = now(), checked_in_by = auth.uid()
    from public.reservations rr
   where en.id = p_entitlement and en.reservation_id = pass.reservation_id and rr.id = en.reservation_id
     and pass.status = 'active' and rr.status = 'confirmed' and en.status = 'active' and en.checked_in_at is null
     and en.service_type = v_svc and now() between en.eligible_from and en.eligible_until
  returning en.* into e;
  if found then
    insert into public.checkins (entitlement_id, pass_id, staff_id, area) values (e.id, pass.id, auth.uid(), p_area);
    perform public.log_audit('checkin', 'entitlement', e.id::text,
      jsonb_build_object('area', p_area, 'reservation_id', e.reservation_id, 'service', e.service_type, 'title', e.title));
    return jsonb_build_object('ok', true, 'state', 'checked_in', 'checked_in_at', e.checked_in_at);
  end if;
  select * into e from public.entitlements where id = p_entitlement and reservation_id = pass.reservation_id and service_type = v_svc;
  if not found then v_state := 'no_service';
  else
    select * into r from public.reservations where id = e.reservation_id;
    v_state := public._ent_state(e, r, pass);
  end if;
  perform public.log_audit('checkin.denied', 'entitlement', p_entitlement::text, jsonb_build_object('area', p_area, 'state', v_state));
  return jsonb_build_object('ok', false, 'state', v_state);
end $$;
