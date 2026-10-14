alter table public.settings
  add column if not exists concierge_response_style text not null default 'trinidadian'
  check (concierge_response_style in ('trinidadian', 'standard'));
