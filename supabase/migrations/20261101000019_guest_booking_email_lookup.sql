create or replace function public.guest_has_prior_booking(p_email text)
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(
    p_email is not null
    and length(btrim(p_email)) between 3 and 254
    and exists (
      select 1
      from public.reservations reservation
      where reservation.status <> 'cart'
        and lower(btrim(reservation.email)) = lower(btrim(p_email))
    ),
    false
  )
$$;

revoke all on function public.guest_has_prior_booking(text)
  from public, anon, authenticated;
grant execute on function public.guest_has_prior_booking(text)
  to service_role;
