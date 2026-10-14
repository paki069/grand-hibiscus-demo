alter table public.room_addons
  add column if not exists details_label text not null default 'Details for the hotel team',
  add column if not exists details_prompt text not null default '';
