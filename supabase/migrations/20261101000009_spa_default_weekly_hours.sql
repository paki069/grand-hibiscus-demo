insert into public.spa_service_availability (service_id, weekday, start_time, end_time, capacity)
select
  service.id,
  day.weekday,
  case when day.weekday in (0, 6) then time '09:00' else time '08:00' end,
  time '19:00',
  10
from public.spa_services service
cross join (values (0), (1), (2), (3), (4), (5), (6)) as day(weekday)
on conflict (service_id, weekday) do update
set start_time = excluded.start_time,
    end_time = excluded.end_time,
    capacity = excluded.capacity;
