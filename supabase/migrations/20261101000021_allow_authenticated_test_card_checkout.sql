create or replace function public.checkout_cart_test_card(
  p_customer_id uuid,
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text default ''
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_customer_id is null or not exists (
    select 1 from public.profiles where id = p_customer_id
  ) then
    raise exception 'not_authenticated';
  end if;
  perform set_config('request.jwt.claim.sub', p_customer_id::text, true);
  return public._checkout_cart_for_customer(
    p_customer_id, p_first, p_last, p_email, p_phone, 'card', p_notes, true
  );
end $$;

revoke all on function public.checkout_cart_test_card(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.checkout_cart_test_card(uuid, text, text, text, text, text)
  to service_role;
