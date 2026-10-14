alter table public.settings alter column hotel_name set default 'The Grand Hibiscus';

update public.settings
set hotel_name = 'The Grand Hibiscus', updated_at = now()
where id = 1 and hotel_name in ('My Hotel', 'DEMO Harbor Hotel');
