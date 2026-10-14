alter table public.events
  add column sort_order int not null default 0 check (sort_order >= 0),
  alter column starts_at drop not null,
  alter column ends_at drop not null;

update public.events
set booking_enabled = false;

alter table public.events
  alter column booking_enabled set default false,
  add constraint events_bookable_requires_schedule
    check (not booking_enabled or (starts_at is not null and ends_at is not null and ends_at > starts_at));

create or replace view public.public_events as
  select e.id, e.title, e.description, e.photo_url, e.location, e.starts_at, e.ends_at, e.capacity,
         e.price, coalesce(e.child_price, e.price) as child_price, e.booking_enabled,
         p.name as provider_name, e.includes, e.sort_order
  from public.events e left join public.event_providers p on p.id = e.provider_id
  where e.active;

insert into public.event_providers (name)
select 'The Grand Hibiscus'
where not exists (
  select 1 from public.event_providers where name = 'The Grand Hibiscus'
);

insert into public.events (
  provider_id, title, description, location, starts_at, ends_at, price, booking_enabled, active, sort_order
)
select provider.id, tour.title, tour.description, '', null, null, 0, false, true, tour.sort_order
from (
  select id from public.event_providers where name = 'The Grand Hibiscus' order by id limit 1
) provider
cross join (values
  ('Asa Wright Nature Centre & Bird Watching', 'Discover the Asa Wright Nature Centre and enjoy bird watching in Trinidad.', 1),
  ('Avocat Waterfall & Marianne River Hike', 'Hike to Avocat Waterfall and explore the Marianne River.', 2),
  ('Caroni Bird Sanctuary Sunset Boat Tour', 'Experience the Caroni Bird Sanctuary on a sunset boat tour.', 3),
  ('Central Trinidad Cultural & Temple Tour', 'Explore Central Trinidad’s culture and temples.', 4),
  ('Gasparee Caves & “Down D’ Islands” Cruise', 'Explore Gasparee Caves and cruise around Down D’ Islands.', 5),
  ('North Coast Scenic Drive & Maracas Bay', 'Take a scenic drive along Trinidad’s North Coast and visit Maracas Bay.', 6),
  ('Paramin Mountain 4×4 Culture & Culinary Tour', 'Discover Paramin by 4×4 and explore local culture and culinary traditions.', 7),
  ('Port of Spain City & Fort George Sightseeing', 'See Port of Spain and visit historic Fort George.', 8),
  ('Rio Seco Waterfall Swim', 'Visit Rio Seco Waterfall and enjoy a swim.', 9)
) as tour(title, description, sort_order)
where not exists (
  select 1 from public.events existing where existing.title = tour.title
);
