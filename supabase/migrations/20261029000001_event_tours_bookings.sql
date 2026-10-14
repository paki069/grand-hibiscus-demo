alter table public.events
  add column includes text not null default '';

update public.events
set booking_enabled = true
where booking_enabled = false;

alter table public.events
  alter column booking_enabled set default true;

create or replace view public.public_events as
  select e.id, e.title, e.description, e.photo_url, e.location, e.starts_at, e.ends_at, e.capacity,
         e.price, coalesce(e.child_price, e.price) as child_price, e.booking_enabled,
         p.name as provider_name, e.includes
  from public.events e left join public.event_providers p on p.id = e.provider_id
  where e.active and e.ends_at > now();
