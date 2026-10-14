create table if not exists public.host_event_inquiries (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('personal', 'cultural', 'corporate')),
  event_type text not null,
  custom_event_type text,
  organization_name text not null default '',
  contact_name text not null,
  contact_title text not null default '',
  email text not null,
  phone text not null,
  website text not null default '',
  preferred_date date not null,
  date_flexible boolean not null default false,
  start_time time,
  end_time time,
  expected_guests integer not null check (expected_guests > 0),
  spaces_requested text[] not null check (cardinality(spaces_requested) > 0),
  custom_space text not null default '',
  request_special_room_rates boolean not null default false,
  estimated_room_count integer check (estimated_room_count is null or estimated_room_count > 0),
  checkin_system text not null check (checkin_system in ('hotel', 'own', 'undecided', 'not_needed')),
  details text not null,
  created_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time),
  check ('Other' <> all (spaces_requested) or length(btrim(custom_space)) > 0),
  check (event_type <> 'Other' or length(btrim(coalesce(custom_event_type, ''))) > 0)
);

create index if not exists host_event_inquiries_created_idx
  on public.host_event_inquiries (created_at desc);

alter table public.host_event_inquiries enable row level security;
drop policy if exists host_event_inquiries_admin_read on public.host_event_inquiries;
create policy host_event_inquiries_admin_read on public.host_event_inquiries
  for select to authenticated using (public.is_admin());
grant select on public.host_event_inquiries to authenticated;
revoke all on public.host_event_inquiries from anon;

create or replace function public.submit_host_event_inquiry(p_submission jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_category text;
  v_event_type text;
  v_custom_event_type text;
  v_allowed_types text[];
  v_organization text;
  v_contact_name text;
  v_contact_title text;
  v_email text;
  v_phone text;
  v_website text;
  v_preferred_date date;
  v_date_flexible boolean;
  v_start_time time;
  v_end_time time;
  v_expected_guests integer;
  v_spaces text[];
  v_allowed_spaces constant text[] := array[
    'Banquet Hall', 'Auditorium', 'Pool', 'Restaurant / Private Dining',
    'Garden / Outdoor Space', 'Guest Rooms', 'Other', 'Open to hotel recommendations'
  ];
  v_custom_space text;
  v_request_rates boolean;
  v_estimated_rooms integer;
  v_checkin_system text;
  v_details text;
  v_id uuid;
begin
  if p_submission is null or jsonb_typeof(p_submission) is distinct from 'object' then
    raise exception 'host_event_invalid_submission';
  end if;

  v_category := nullif(btrim(p_submission ->> 'category'), '');
  v_event_type := nullif(btrim(p_submission ->> 'event_type'), '');
  v_custom_event_type := nullif(btrim(p_submission ->> 'custom_event_type'), '');
  if v_category = 'personal' then
    v_allowed_types := array[
      'Weddings and Receptions', 'Anniversaries and Birthday Parties', 'Proms and Graduations',
      'Family Reunions', 'Religious Celebrations', 'Other'
    ];
  elsif v_category = 'cultural' then
    v_allowed_types := array[
      'Gala Dinners and Fundraisers', 'Live Music and Concerts', 'Wine Tastings and Cooking Classes',
      'Art Exhibitions and Artist Residencies', 'Wellness Retreats', 'Themed and Holiday Parties', 'Other'
    ];
  elsif v_category = 'corporate' then
    v_allowed_types := array[
      'Conferences and Congresses', 'Seminars and Workshops', 'Company Meetings',
      'Product Launches', 'Trade Shows and Exhibitions', 'Team-Building Activities', 'Other'
    ];
  else
    raise exception 'host_event_invalid_category';
  end if;
  if v_event_type is null or not (v_event_type = any(v_allowed_types)) then
    raise exception 'host_event_invalid_type';
  end if;
  if v_event_type = 'Other' and v_custom_event_type is null then
    raise exception 'host_event_custom_type_required';
  end if;

  v_organization := btrim(coalesce(p_submission ->> 'organization_name', ''));
  v_contact_name := btrim(coalesce(p_submission ->> 'contact_name', ''));
  v_contact_title := btrim(coalesce(p_submission ->> 'contact_title', ''));
  v_email := btrim(coalesce(p_submission ->> 'email', ''));
  v_phone := btrim(coalesce(p_submission ->> 'phone', ''));
  v_website := btrim(coalesce(p_submission ->> 'website', ''));
  if v_contact_name = '' or length(v_contact_name) > 200
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(v_email) > 254
     or length(v_phone) < 7 or length(v_phone) > 50
     or length(v_organization) > 200 or length(v_contact_title) > 100
     or length(v_website) > 500 then
    raise exception 'host_event_invalid_contact';
  end if;

  if coalesce(p_submission ->> 'preferred_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'host_event_invalid_date';
  end if;
  v_preferred_date := (p_submission ->> 'preferred_date')::date;
  if p_submission ->> 'date_flexible' is null
     or p_submission ->> 'date_flexible' not in ('true', 'false')
     or p_submission ->> 'request_special_room_rates' is null
     or p_submission ->> 'request_special_room_rates' not in ('true', 'false') then
    raise exception 'host_event_invalid_submission';
  end if;
  v_date_flexible := (p_submission ->> 'date_flexible')::boolean;
  v_request_rates := (p_submission ->> 'request_special_room_rates')::boolean;

  v_start_time := nullif(p_submission ->> 'start_time', '')::time;
  v_end_time := nullif(p_submission ->> 'end_time', '')::time;
  if v_start_time is not null and v_end_time is not null and v_end_time <= v_start_time then
    raise exception 'host_event_invalid_time_range';
  end if;

  if coalesce(p_submission ->> 'expected_guests', '') !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'host_event_invalid_guest_count';
  end if;
  v_expected_guests := (p_submission ->> 'expected_guests')::integer;
  if v_expected_guests > 100000 then raise exception 'host_event_invalid_guest_count'; end if;

  if jsonb_typeof(p_submission -> 'spaces_requested') is distinct from 'array' then
    raise exception 'host_event_invalid_spaces';
  end if;
  select coalesce(array_agg(distinct btrim(space)), '{}'::text[])
    into v_spaces
    from jsonb_array_elements_text(p_submission -> 'spaces_requested') as requested(space)
    where btrim(space) <> '';
  if cardinality(v_spaces) = 0 or exists (
    select 1 from unnest(v_spaces) as requested(space)
    where not (space = any(v_allowed_spaces))
  ) then
    raise exception 'host_event_invalid_spaces';
  end if;
  v_custom_space := btrim(coalesce(p_submission ->> 'custom_space', ''));
  if 'Other' = any(v_spaces) and v_custom_space = '' then
    raise exception 'host_event_custom_space_required';
  end if;
  if length(v_custom_space) > 200 then raise exception 'host_event_invalid_spaces'; end if;

  v_estimated_rooms := null;
  if nullif(p_submission ->> 'estimated_room_count', '') is not null then
    if (p_submission ->> 'estimated_room_count') !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'host_event_invalid_room_count';
    end if;
    v_estimated_rooms := (p_submission ->> 'estimated_room_count')::integer;
  end if;
  v_checkin_system := nullif(p_submission ->> 'checkin_system', '');
  if v_checkin_system is null
     or v_checkin_system not in ('hotel', 'own', 'undecided', 'not_needed') then
    raise exception 'host_event_invalid_checkin_system';
  end if;

  v_details := btrim(coalesce(p_submission ->> 'details', ''));
  if v_details = '' or length(v_details) > 5000 then
    raise exception 'host_event_invalid_details';
  end if;

  insert into public.host_event_inquiries (
    category, event_type, custom_event_type, organization_name, contact_name, contact_title,
    email, phone, website, preferred_date, date_flexible, start_time, end_time, expected_guests,
    spaces_requested, custom_space, request_special_room_rates, estimated_room_count, checkin_system, details
  ) values (
    v_category, v_event_type, case when v_event_type = 'Other' then v_custom_event_type end,
    v_organization, v_contact_name, v_contact_title, v_email, v_phone, v_website,
    v_preferred_date, v_date_flexible, v_start_time, v_end_time, v_expected_guests, v_spaces,
    v_custom_space, v_request_rates, v_estimated_rooms, v_checkin_system, v_details
  ) returning id into v_id;

  perform public.log_audit(
    'host_event_inquiry.submitted', 'host_event_inquiry', v_id::text,
    jsonb_build_object('category', v_category, 'event_type', v_event_type)
  );
  return v_id;
end $$;

revoke all on function public.submit_host_event_inquiry(jsonb) from public;
grant execute on function public.submit_host_event_inquiry(jsonb) to anon, authenticated;
