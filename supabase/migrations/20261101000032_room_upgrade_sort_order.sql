alter table public.room_addons
  add column if not exists sort_order integer;

with ordered_upgrades as (
  select id,
         row_number() over (
           order by
             case lower(btrim(name))
               when 'airport pickup' then 1
               when 'airport drop-off' then 2
               when 'early check-in' then 3
               when 'late checkout' then 4
               else 5
             end,
             lower(name),
             id
         ) * 10 as position
  from public.room_addons
  where kind = 'upgrade' and sort_order is null
)
update public.room_addons as addon
set sort_order = ordered_upgrades.position
from ordered_upgrades
where addon.id = ordered_upgrades.id;

update public.room_addons
set sort_order = 100
where sort_order is null;

alter table public.room_addons
  alter column sort_order set default 100,
  alter column sort_order set not null;
