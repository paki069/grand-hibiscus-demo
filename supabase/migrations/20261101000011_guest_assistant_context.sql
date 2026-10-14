create or replace function public.guest_loyalty_guide()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'room_night_points', (select room_night_points from public.loyalty_settings where id = 1),
    'room_addon_points', (select room_addon_points from public.loyalty_settings where id = 1),
    'spa_spend_block_amount', (select spa_spend_block_amount from public.loyalty_settings where id = 1),
    'spa_spend_block_points', (select spa_spend_block_points from public.loyalty_settings where id = 1),
    'gym_points_per_guest_day', (select gym_points_per_guest_day from public.loyalty_settings where id = 1),
    'tour_booking_points', (select tour_booking_points from public.loyalty_settings where id = 1),
    'room_type_free_night_rewards', (
      select coalesce(jsonb_agg(
        jsonb_build_object('room_type', name, 'points_per_night', loyalty_free_night_points)
        order by name
      ), '[]'::jsonb)
      from public.room_types where active
    ),
    'gym_package_rewards', (
      select coalesce(jsonb_agg(
        jsonb_build_object('package', title, 'points', loyalty_points)
        order by sort_order
      ), '[]'::jsonb)
      from public.gym_packages where active
    )
  )
$$;

revoke all on function public.guest_loyalty_guide() from public;
grant execute on function public.guest_loyalty_guide() to anon, authenticated;
