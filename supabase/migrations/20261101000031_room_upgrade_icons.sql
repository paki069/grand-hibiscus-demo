alter table public.room_addons
  add column if not exists icon text not null default 'sparkles';

update public.room_addons
set icon = case
  when lower(name) like '%airport%' then 'plane'
  when lower(name) like '%check%' then 'clock-3'
  else 'sparkles'
end
where kind = 'upgrade' and icon = 'sparkles';
