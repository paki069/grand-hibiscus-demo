begin;

create temporary table table_label_changes on commit drop as
select
  id,
  area_id,
  label as old_label,
  case
    when label ~ '^T2($|-)'
      then regexp_replace(label, '^T2', 'D')
    else regexp_replace(label, '^T4', 'Q')
  end as new_label,
  false as resolved
from public.seating_tables
where label ~ '^T[24]($|-)';

create temporary table seat_label_changes on commit drop as
select
  s.id,
  s.table_id,
  s.label as old_label,
  c.old_label as old_table_label,
  c.new_label || substring(s.label from length(c.old_label) + 1) as new_label,
  false as resolved
from public.seats s
join pg_temp.table_label_changes c on c.id = s.table_id
where s.label like c.old_label || '-%';

update public.seating_tables t
set label = '__table_rename__' || t.id::text
from pg_temp.table_label_changes c
where t.id = c.id;

update public.seats s
set label = '__seat_rename__' || s.id::text
from pg_temp.seat_label_changes c
where s.id = c.id;

do $$
declare
  r record;
  candidate text;
  prefix text;
  n integer;
begin
  for r in select * from pg_temp.table_label_changes order by area_id, id loop
    candidate := r.new_label;
    if exists (
      select 1 from public.seating_tables t
      where t.area_id = r.area_id and t.label = candidate
    ) or exists (
      select 1 from pg_temp.table_label_changes c
      where c.area_id = r.area_id and c.resolved and c.new_label = candidate
    ) then
      prefix := case when r.old_label ~ '^T2' then 'D' else 'Q' end;
      n := coalesce(substring(r.old_label from '-([0-9]+)$')::integer, 1);
      loop
        candidate := prefix || '-' || lpad(n::text, 2, '0');
        exit when not exists (
          select 1 from public.seating_tables t
          where t.area_id = r.area_id and t.label = candidate
        ) and not exists (
          select 1 from pg_temp.table_label_changes c
          where c.area_id = r.area_id and c.resolved and c.new_label = candidate
        );
        n := n + 1;
      end loop;
    end if;
    update pg_temp.table_label_changes set new_label = candidate, resolved = true where id = r.id;
  end loop;

  update pg_temp.seat_label_changes s
  set new_label = c.new_label || substring(s.old_label from length(s.old_table_label) + 1)
  from pg_temp.table_label_changes c
  where c.id = s.table_id;

  for r in select * from pg_temp.seat_label_changes order by table_id, id loop
    candidate := r.new_label;
    if exists (
      select 1 from public.seats s
      where s.table_id = r.table_id and s.label = candidate
    ) or exists (
      select 1 from pg_temp.seat_label_changes c
      where c.table_id = r.table_id and c.resolved and c.new_label = candidate
    ) then
      n := 2;
      loop
        candidate := r.new_label || '-' || n::text;
        exit when not exists (
          select 1 from public.seats s
          where s.table_id = r.table_id and s.label = candidate
        ) and not exists (
          select 1 from pg_temp.seat_label_changes c
          where c.table_id = r.table_id and c.resolved and c.new_label = candidate
        );
        n := n + 1;
      end loop;
    end if;
    update pg_temp.seat_label_changes set new_label = candidate, resolved = true where id = r.id;
  end loop;
end $$;

update public.seating_tables t
set label = c.new_label
from pg_temp.table_label_changes c
where t.id = c.id;

update public.seats s
set label = c.new_label
from pg_temp.seat_label_changes c
where s.id = c.id;

commit;
