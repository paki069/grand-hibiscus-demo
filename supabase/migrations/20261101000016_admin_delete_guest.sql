create or replace function public.admin_delete_guest_records(p_guest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_ids uuid[];
  v_entitlement_ids uuid[];
  v_owned_payment_ids uuid[];
  v_reservation_audit_ids text[];
  v_payment_audit_ids text[];
  v_refund_audit_ids text[];
  v_pass_audit_ids text[];
  v_checkin_audit_ids text[];
  v_event_lead_audit_ids text[];
begin
  if p_guest_id is null then
    raise exception 'guest_account_unavailable';
  end if;

  perform 1
  from public.profiles
  where id = p_guest_id and role = 'customer'
  for update;
  if not found then
    raise exception 'guest_account_unavailable';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_reservation_ids
    from public.reservations
    where customer_id = p_guest_id;

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_entitlement_ids
    from public.entitlements
    where reservation_id = any(v_reservation_ids);

  select coalesce(array_agg(id), '{}'::uuid[])
    into v_owned_payment_ids
    from public.payments
    where reservation_id = any(v_reservation_ids);

  select coalesce(array_agg(id::text), '{}'::text[])
    into v_reservation_audit_ids
    from public.reservations
    where id = any(v_reservation_ids);

  select coalesce(array_agg(id::text), '{}'::text[])
    into v_payment_audit_ids
    from public.payments
    where reservation_id = any(v_reservation_ids) or verified_by = p_guest_id;

  select coalesce(array_agg(refund.id::text), '{}'::text[])
    into v_refund_audit_ids
    from public.refunds as refund
    where refund.payment_id = any(v_owned_payment_ids) or refund.created_by = p_guest_id;

  select coalesce(array_agg(pass.id::text), '{}'::text[])
    into v_pass_audit_ids
    from public.qr_passes as pass
    where pass.reservation_id = any(v_reservation_ids);

  select coalesce(array_agg(checkin.id::text), '{}'::text[])
    into v_checkin_audit_ids
    from public.checkins as checkin
    where checkin.entitlement_id = any(v_entitlement_ids) or checkin.staff_id = p_guest_id;

  select coalesce(array_agg(lead.id::text), '{}'::text[])
    into v_event_lead_audit_ids
    from public.event_leads as lead
    where lead.assigned_to = p_guest_id;

  delete from public.checkins
  where id::text = any(v_checkin_audit_ids);

  update public.entitlements
  set checked_in_by = null
  where checked_in_by = p_guest_id;

  update public.payments
  set verified_by = null
  where verified_by = p_guest_id;

  update public.refunds
  set created_by = null
  where created_by = p_guest_id;

  update public.event_leads
  set assigned_to = null
  where assigned_to = p_guest_id;

  delete from public.notifications
  where reservation_id = any(v_reservation_ids);

  delete from public.loyalty_coupons
  where customer_id = p_guest_id;

  delete from public.loyalty_point_ledger
  where customer_id = p_guest_id;

  delete from public.reservations
  where customer_id = p_guest_id;

  delete from public.audit_log
  where actor_id = p_guest_id
     or (entity_type = 'reservations' and entity_id = any(v_reservation_audit_ids))
     or (entity_type = 'payments' and entity_id = any(v_payment_audit_ids))
     or (entity_type = 'refunds' and entity_id = any(v_refund_audit_ids))
     or (entity_type = 'qr_passes' and entity_id = any(v_pass_audit_ids))
     or (entity_type = 'checkins' and entity_id = any(v_checkin_audit_ids))
     or (entity_type = 'event_leads' and entity_id = any(v_event_lead_audit_ids));
end;
$$;

revoke all on function public.admin_delete_guest_records(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_guest_records(uuid) to service_role;
