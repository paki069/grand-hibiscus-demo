-- Core: roles, profiles, settings, audit log, notifications outbox.
create extension if not exists btree_gist;

create type public.app_role as enum ('admin', 'staff', 'customer');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  role public.app_role not null default 'customer',
  -- areas a staff member may work in: hotel, restaurant, spa, events
  staff_areas text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (staff_areas <@ array['hotel','restaurant','spa','events']::text[])
);

-- Authorization helpers (security definer so they can read profiles inside RLS policies).
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','staff') and active)
$$;

create function public.staff_area(p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
      and (role = 'admin' or (role = 'staff' and p_area = any (staff_areas)))
  )
$$;

-- New auth users are ALWAYS customers. Roles are only changed by admins.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent privilege escalation: only admins (or the service role / SQL, uid null) may change role fields.
create function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role <> old.role or new.staff_areas <> old.staff_areas or new.active <> old.active or new.id <> old.id then
      raise exception 'forbidden';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

alter table public.profiles enable row level security;
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_delete on public.profiles for delete using (public.is_admin());

-- Site settings (single row). Holds no secrets.
create table public.settings (
  id int primary key default 1 check (id = 1),
  hotel_name text not null default 'My Hotel',
  currency char(3) not null default 'USD',
  timezone text not null default 'UTC',
  checkin_time time not null default '15:00',
  checkout_time time not null default '11:00',
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  service_fee_rate numeric(5,2) not null default 0 check (service_fee_rate between 0 and 100),
  hold_minutes int not null default 15 check (hold_minutes between 1 and 240),
  unpaid_expiry_hours int not null default 48 check (unpaid_expiry_hours >= 1),
  free_cancel_hours int not null default 48 check (free_cancel_hours >= 0),
  late_cancel_fee_percent numeric(5,2) not null default 100 check (late_cancel_fee_percent between 0 and 100),
  cancellation_policy text not null default 'Free cancellation up to 48 hours before arrival. Later cancellations may incur a fee.',
  booking_policy text not null default 'Check-in from 15:00, check-out by 11:00. A valid photo ID is required at check-in.',
  payment_methods jsonb not null default jsonb_build_object(
    'bank_transfer', jsonb_build_object('enabled', true, 'label', 'Bank transfer',
      'instructions', 'Transfer the total to the account shown here, then upload your receipt. Configure your bank details in Admin > Settings.'),
    'cash_on_arrival', jsonb_build_object('enabled', true, 'label', 'Cash on arrival'),
    'card', jsonb_build_object('enabled', false, 'label', 'Card'),
    'dev_test', jsonb_build_object('enabled', false, 'label', 'Development test payment')
  ),
  notification_settings jsonb not null default jsonb_build_object(
    'confirmation_email', true, 'reminder_email', true, 'reminder_hours_before', 24, 'staff_notify_email', ''),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);
alter table public.settings enable row level security;
create policy settings_read on public.settings for select using (true);
create policy settings_admin_write on public.settings for update using (public.is_admin()) with check (public.is_admin());

-- Audit log: written by triggers/functions only; readable by admins only.
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'
);
create index audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
create policy audit_admin_read on public.audit_log for select using (public.is_admin());

create function public.log_audit(p_action text, p_type text, p_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_type, p_id, coalesce(p_details, '{}'))
$$;
revoke all on function public.log_audit(text, text, text, jsonb) from public, anon, authenticated;

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text; v_new jsonb; v_old jsonb;
begin
  if tg_op = 'DELETE' then v_old := to_jsonb(old); v_id := v_old ->> 'id';
    perform public.log_audit(tg_table_name || '.delete', tg_table_name, v_id, jsonb_build_object('old', v_old));
    return old;
  end if;
  v_new := to_jsonb(new); v_id := v_new ->> 'id';
  if tg_op = 'INSERT' then
    perform public.log_audit(tg_table_name || '.create', tg_table_name, v_id, jsonb_build_object('new', v_new));
  else
    v_old := to_jsonb(old);
    perform public.log_audit(tg_table_name || '.update', tg_table_name, v_id,
      jsonb_build_object('changed', (select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', v_old -> n.key, 'to', n.value)), '{}')
                                      from jsonb_each(v_new) n where v_old -> n.key is distinct from n.value)));
  end if;
  return new;
end $$;

create trigger audit_profiles after update or delete on public.profiles for each row execute function public.audit_row();
create trigger audit_settings after update on public.settings for each row execute function public.audit_row();

-- Email/message outbox. A row is only 'sent' if a provider actually accepted it.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid,
  kind text not null,                 -- confirmation | reminder | staff
  to_email text not null,
  subject text not null,
  body text not null default '',
  status text not null default 'queued' check (status in ('queued','sent','not_configured','failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.notifications enable row level security;
create policy notifications_admin_read on public.notifications for select using (public.is_admin());
