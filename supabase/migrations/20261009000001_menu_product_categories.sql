create table public.menu_product_categories (
  product_id uuid not null references public.menu_products (id) on delete cascade,
  category_id uuid not null references public.menu_categories (id) on delete cascade,
  primary key (product_id, category_id)
);

insert into public.menu_product_categories (product_id, category_id)
select id, category_id
from public.menu_products
where category_id is not null
on conflict do nothing;

alter table public.menu_product_categories enable row level security;
create policy menu_product_categories_admin on public.menu_product_categories
  for all using (public.is_admin()) with check (public.is_admin());
create policy menu_product_categories_public on public.menu_product_categories
  for select using (
    exists (
      select 1
      from public.menu_products p
      join public.menu_categories c on c.id = menu_product_categories.category_id
      where p.id = menu_product_categories.product_id
        and p.active and c.active
    )
  );

create trigger audit_menu_product_categories
  after insert or update or delete on public.menu_product_categories
  for each row execute function public.audit_row();

create function public.admin_save_menu_product(
  p_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_photo_url text,
  p_available boolean,
  p_active boolean,
  p_category_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_categories uuid[];
  v_category uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if nullif(trim(p_name), '') is null or p_price is null or p_price < 0
    or p_available is null or p_active is null then
    raise exception 'invalid_product';
  end if;

  select coalesce(array_agg(distinct category_id), '{}')
    into v_categories
    from unnest(coalesce(p_category_ids, '{}')) as selected(category_id);
  if exists (
    select 1
    from unnest(v_categories) selected(category_id)
    left join public.menu_categories c on c.id = selected.category_id and c.active
    where c.id is null
  ) then
    raise exception 'invalid_category';
  end if;

  if p_id is null then
    insert into public.menu_products (name, description, price, photo_url, available, active, category_id)
    values (trim(p_name), coalesce(p_description, ''), p_price, p_photo_url, p_available, p_active, v_categories[1])
    returning id into v_id;
  else
    update public.menu_products
      set name = trim(p_name), description = coalesce(p_description, ''), price = p_price,
          photo_url = p_photo_url, available = p_available, active = p_active,
          category_id = v_categories[1]
      where id = p_id
      returning id into v_id;
    if v_id is null then raise exception 'product_not_found'; end if;
    delete from public.menu_product_categories where product_id = v_id;
  end if;

  foreach v_category in array v_categories loop
    insert into public.menu_product_categories (product_id, category_id)
    values (v_id, v_category);
  end loop;
  return v_id;
end $$;

revoke all on function public.admin_save_menu_product(uuid, text, text, numeric, text, boolean, boolean, uuid[]) from public, anon;
grant execute on function public.admin_save_menu_product(uuid, text, text, numeric, text, boolean, boolean, uuid[]) to authenticated;
