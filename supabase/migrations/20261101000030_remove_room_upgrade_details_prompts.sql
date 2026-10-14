alter table public.room_addons
  drop column if exists details_label,
  drop column if exists details_prompt;
