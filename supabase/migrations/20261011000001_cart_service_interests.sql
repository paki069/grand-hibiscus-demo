create table public.cart_service_interests (
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  service_type text not null check (service_type in ('restaurant', 'spa', 'event')),
  created_at timestamptz not null default now(),
  primary key (reservation_id, service_type)
);

alter table public.cart_service_interests enable row level security;
create policy cart_service_interests_admin_read on public.cart_service_interests
  for select using (public.is_admin());
create policy cart_service_interests_owner_read on public.cart_service_interests
  for select using (exists (
    select 1 from public.reservations r
    where r.id = reservation_id and r.customer_id = auth.uid()
  ));
grant select on public.cart_service_interests to authenticated;

create function public.set_cart_service_interest(p_service_type text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_cart uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_service_type is null or p_service_type not in ('restaurant', 'spa', 'event') then
    raise exception 'invalid_service_interest';
  end if;
  select id into v_cart from public.reservations where customer_id = auth.uid() and status = 'cart';
  if v_cart is null then raise exception 'cart_not_found'; end if;

  if p_enabled then
    insert into public.cart_service_interests (reservation_id, service_type)
    values (v_cart, p_service_type)
    on conflict (reservation_id, service_type) do nothing;
  else
    delete from public.cart_service_interests where reservation_id = v_cart and service_type = p_service_type;
  end if;
end $$;

create function public.add_room_booking_to_cart(
  p_room_type uuid,
  p_checkin date,
  p_checkout date,
  p_adults int,
  p_children int,
  p_addons uuid[],
  p_first text,
  p_last text,
  p_email text,
  p_phone text,
  p_notes text,
  p_interests text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_ent uuid; v_res uuid; v_interests text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if nullif(btrim(p_first), '') is null or nullif(btrim(p_last), '') is null
     or length(btrim(p_first)) > 100 or length(btrim(p_last)) > 100
     or nullif(btrim(p_email), '') is null or length(btrim(p_email)) > 254
     or btrim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or nullif(btrim(p_phone), '') is null or length(btrim(p_phone)) < 5 or length(btrim(p_phone)) > 40 then
    raise exception 'invalid_details';
  end if;

  v_interests := coalesce(p_interests, '{}');
  if exists (select 1 from unnest(v_interests) as interests(value) where value is null or value not in ('restaurant', 'spa', 'event')) then
    raise exception 'invalid_service_interest';
  end if;

  v_ent := public.add_room_to_cart(p_room_type, p_checkin, p_checkout, p_adults, p_children, p_addons);
  select reservation_id into v_res from public.entitlements where id = v_ent;
  update public.reservations
    set first_name = btrim(p_first), last_name = btrim(p_last), email = btrim(p_email),
        phone = btrim(p_phone), notes = left(coalesce(p_notes, ''), 1000)
    where id = v_res and customer_id = auth.uid() and status = 'cart';
  if not found then raise exception 'cart_not_found'; end if;

  delete from public.cart_service_interests where reservation_id = v_res;
  insert into public.cart_service_interests (reservation_id, service_type)
    select v_res, i from (select distinct unnest(v_interests) as i) selected;
  return v_ent;
end $$;

revoke execute on function public.set_cart_service_interest(text, boolean),
  public.add_room_booking_to_cart(uuid, date, date, int, int, uuid[], text, text, text, text, text, text[])
  from public, anon;
grant execute on function public.set_cart_service_interest(text, boolean),
  public.add_room_booking_to_cart(uuid, date, date, int, int, uuid[], text, text, text, text, text, text[])
  to authenticated;
