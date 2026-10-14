create function public.begin_restaurant_edit_for_room_cart(p_hotel_entitlement uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res uuid;
begin
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  perform public.release_expired_holds();
  v_res := public._cart_hotel_reservation(p_hotel_entitlement);
  perform 1
  from public.entitlements
  where id = p_hotel_entitlement and service_type = 'hotel'
  for update;
  if not found then raise exception 'room_not_in_cart'; end if;

  delete from public.entitlements
  where reservation_id = v_res
    and parent_entitlement_id = p_hotel_entitlement
    and service_type = 'restaurant';

  perform public._refresh_room_early_checkin(p_hotel_entitlement);
end $$;

revoke execute on function public.begin_restaurant_edit_for_room_cart(uuid) from public, anon;
grant execute on function public.begin_restaurant_edit_for_room_cart(uuid) to authenticated;
