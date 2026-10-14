create or replace function public.scan_pass(p_token text, p_area text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pass public.qr_passes;
  r public.reservations;
  v_svc public.service_type;
  v_list jsonb;
  v_state text;
  v_payment_status text;
begin
  if not public.staff_area(p_area) then raise exception 'forbidden'; end if;
  v_svc := public._area_service(p_area);
  select * into pass from public.qr_passes where id = public._resolve_scan_pass(p_token);
  if not found then
    perform public.log_audit('scan.unknown', 'qr_pass', null, jsonb_build_object('area', p_area));
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into r from public.reservations where id = pass.reservation_id;
  select payment.status into v_payment_status
  from public.payments payment
  where payment.reservation_id = r.id
  order by payment.created_at desc
  limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'title', e.title, 'detail', e.detail, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'eligible_from', e.eligible_from, 'adults', e.adults, 'children', e.children, 'meta', e.meta,
      'checked_in_at', e.checked_in_at, 'state', public._ent_state(e, r, pass)) order by e.starts_at), '[]')
    into v_list from public.entitlements e where e.reservation_id = r.id and e.service_type = v_svc;
  if jsonb_array_length(v_list) = 0 then v_state := 'no_service';
  elsif pass.status = 'revoked' then v_state := 'revoked';
  elsif exists (select 1 from jsonb_array_elements(v_list) x where x ->> 'state' = 'valid') then v_state := 'valid';
  else v_state := v_list -> 0 ->> 'state'; end if;
  return jsonb_build_object('state', v_state, 'area', p_area,
    'reservation', jsonb_build_object(
      'id', r.id,
      'reference', r.reference,
      'guest', r.first_name || ' ' || r.last_name,
      'status', r.status,
      'payment_status', v_payment_status
    ),
    'entitlements', v_list);
end $$;
