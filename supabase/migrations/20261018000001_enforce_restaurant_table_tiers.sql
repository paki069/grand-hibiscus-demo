create function public.enforce_restaurant_table_tier()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_party int;
  v_capacity int;
begin
  select e.adults + e.children
  into v_party
  from public.entitlements e
  where e.id = new.entitlement_id and e.service_type = 'restaurant';
  if not found then raise exception 'cart_item_not_found'; end if;

  select t.capacity
  into v_capacity
  from public.seating_tables t
  where t.id = new.table_id;
  if not found then raise exception 'table_unavailable'; end if;

  if v_party between 1 and 2 and v_capacity <> 2
     or v_party between 3 and 4 and v_capacity <> 4
     or v_party between 5 and 8 and v_capacity <> 8 then
    raise exception 'table_size_mismatch';
  end if;
  if v_party < 1 or v_party > 8 then raise exception 'party_size_not_allowed'; end if;

  return new;
end $$;

create trigger restaurant_table_tier_guard
before insert or update of entitlement_id, table_id on public.table_reservations
for each row execute function public.enforce_restaurant_table_tier();
