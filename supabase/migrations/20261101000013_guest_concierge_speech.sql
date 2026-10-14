alter table public.settings
  add column if not exists concierge_voice_input_enabled boolean not null default true,
  add column if not exists concierge_voice_output_enabled boolean not null default true,
  add column if not exists concierge_speech_voice text not null default 'autumn'
    check (concierge_speech_voice in ('autumn', 'diana', 'hannah'));
