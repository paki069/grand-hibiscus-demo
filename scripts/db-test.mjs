// Verifies migrations, RLS, concurrency and check-in behaviour against a real (embedded) Postgres.
// Supabase-specific pieces (auth schema, roles, storage tables) are stubbed below.
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const { Client } = pg
const PORT = 54329
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-pg-'))
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false })
const conn = { host: 'localhost', port: PORT, user: 'postgres', password: 'pw', database: 'hotel' }

let passed = 0, failed = 0
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name) } else { failed++; console.log('  ✘', name, extra) }
}

async function admin(sql, params = []) {
  const c = new Client(conn); await c.connect()
  try { return (await c.query(sql, params)).rows } finally { await c.end() }
}
// Run SQL as a Supabase 'authenticated' user (RLS applies), in its own transaction/connection.
async function as(uid, sql, params = []) {
  const c = new Client(conn); await c.connect()
  try {
    await c.query('begin'); await c.query('set local role authenticated')
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid])
    const r = await c.query(sql, params); await c.query('commit'); return r.rows
  } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { await c.end() }
}
async function asAnon(sql, params = []) {
  const c = new Client(conn); await c.connect()
  try {
    await c.query('begin'); await c.query('set local role anon')
    const r = await c.query(sql, params); await c.query('commit'); return r.rows
  } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { await c.end() }
}
async function asService(sql, params = []) {
  const c = new Client(conn); await c.connect()
  try {
    await c.query('begin'); await c.query('set local role service_role')
    const r = await c.query(sql, params); await c.query('commit'); return r.rows
  } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { await c.end() }
}
const err = async (p) => { try { await p; return null } catch (e) { return e.message } }
const rpcMsgs = (rs) => rs.map((r) => (r.status === 'fulfilled' ? 'OK' : r.reason.message))

async function main() {
  await server.initialise(); await server.start()
  await server.createDatabase('hotel')

  await admin(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb default '{}',
      is_anonymous boolean not null default false,
      email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)

  const root = path.resolve(import.meta.dirname, '..', 'supabase')
  for (const f of fs.readdirSync(path.join(root, 'migrations')).sort()) {
    if (f === '20261030000003_spa_weekly_grid.sql') {
      await admin(`alter table public.spa_service_availability
        drop constraint spa_service_availability_weekday_check,
        drop constraint spa_service_availability_service_id_weekday_key,
        drop column weekday;
        alter table public.spa_service_availability
          add column service_date date not null default current_date;
        alter table public.spa_service_availability
          alter column service_date drop default,
          add column window_range tsrange generated always as (
            tsrange(service_date + start_time, service_date + end_time, '[)')
          ) stored,
          add constraint spa_service_availability_legacy_window_excl
            exclude using gist (service_id with =, window_range with &&);`)
    }
    if (f === '20261101000008_spa_weekly_schedule_conflict_fix.sql') {
      await admin(`alter table public.spa_service_availability
        add constraint spa_service_availability_stale_overlap_excl
          exclude using gist (service_id with =, weekday with =);`)
    }
    await admin(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'))
    console.log('applied', f)
    if (f === '20261101000008_spa_weekly_schedule_conflict_fix.sql') {
      const constraints = await admin(`select count(*)::int as count from pg_constraint
        where conrelid = 'public.spa_service_availability'::regclass and contype = 'x'`)
      ok(constraints[0].count === 0, 'spa weekly availability has no stale exclusion constraints')
    }
  }
  const guestOwnerId = randomUUID()
  const verifiedGuestId = randomUUID()
  const unverifiedGuestId = randomUUID()
  await admin(`insert into auth.users (id, email, is_anonymous, email_confirmed_at)
    values ($1, null, true, null), ($2, 'guest@example.test', false, now()), ($3, 'unverified@example.test', false, null)`,
  [guestOwnerId, verifiedGuestId, unverifiedGuestId])
  const guestReservation = randomUUID()
  await admin(`insert into public.reservations (id, customer_id, status, email, first_name, last_name, phone)
    values ($1, $2, 'confirmed', 'guest@example.test', 'Jamie', 'Guest', '555-0101')`, [guestReservation, guestOwnerId])
  await admin(`insert into public.loyalty_point_ledger
    (customer_id, reservation_id, reference_key, entry_type, points, description)
    values ($1, $2, $3, 'earn', 25, 'Guest booking points')`,
  [guestOwnerId, guestReservation, `guest-claim:${guestReservation}`])
  const anonymousContact = (await admin(
    'select email, first_name, last_name, phone from public.profiles where id = $1',
    [guestOwnerId],
  ))[0]
  ok(anonymousContact.email === 'guest@example.test' && anonymousContact.first_name === 'Jamie'
    && anonymousContact.last_name === 'Guest' && anonymousContact.phone === '555-0101',
  'anonymous booking details populate the guest profile')
  const guestClaim = await as(verifiedGuestId, 'select public.claim_guest_reservations() as claimed')
  const claimedOwner = await admin('select customer_id from public.reservations where id = $1', [guestReservation])
  const claimedProfile = (await admin(
    'select email, first_name, last_name, phone from public.profiles where id = $1',
    [verifiedGuestId],
  ))[0]
  const claimedPoints = (await admin(
    'select customer_id from public.loyalty_point_ledger where reference_key = $1',
    [`guest-claim:${guestReservation}`],
  ))[0]
  ok(guestClaim[0].claimed === 1 && claimedOwner[0].customer_id === verifiedGuestId,
    'verified email sign-in claims matching guest reservations')
  ok(claimedProfile.email === 'guest@example.test' && claimedProfile.first_name === 'Jamie'
    && claimedProfile.last_name === 'Guest' && claimedProfile.phone === '555-0101'
    && claimedPoints.customer_id === verifiedGuestId
    && (await admin('select coalesce(sum(points), 0)::int balance from public.loyalty_point_ledger where customer_id = $1', [verifiedGuestId]))[0].balance === 25,
  'verified account receives the guest profile details and booking points')
  const unverifiedClaimError = await err(as(unverifiedGuestId, 'select public.claim_guest_reservations()'))
  ok(unverifiedClaimError?.includes('verified_email_required'),
    'unverified email cannot claim guest reservations')

  const anonymousCartOwnerId = randomUUID()
  const accountCartId = randomUUID()
  const anonymousCartId = randomUUID()
  const guestCartEntitlementId = randomUUID()
  await admin(`insert into auth.users (id, email, is_anonymous)
    values ($1, null, true)`, [anonymousCartOwnerId])
  await admin(`insert into public.reservations (id, customer_id, status, email)
    values ($1, $2, 'cart', ''), ($3, $4, 'cart', 'guest@example.test')`,
  [accountCartId, verifiedGuestId, anonymousCartId, anonymousCartOwnerId])
  await admin(`insert into public.entitlements
    (id, reservation_id, service_type, title, starts_at, ends_at, eligible_from, eligible_until, status)
    values ($1, $2, 'hotel', 'Guest room', now(), now() + interval '1 hour',
      now(), now() + interval '1 hour', 'held')`, [guestCartEntitlementId, anonymousCartId])
  await admin(`insert into public.cart_service_interests (reservation_id, service_type)
    values ($1, 'spa')`, [anonymousCartId])
  const mergedCartClaim = await as(verifiedGuestId, 'select public.claim_guest_reservations() as claimed')
  const mergedCart = (await admin(`select target.email, target.first_name,
      (select count(*)::int from public.entitlements where reservation_id = target.id) as items,
      (select count(*)::int from public.cart_service_interests where reservation_id = target.id) as interests,
      exists (select 1 from public.reservations where id = $2) as source_exists
    from public.reservations as target where target.id = $1`, [accountCartId, anonymousCartId]))[0]
  ok(mergedCartClaim[0].claimed === 1 && mergedCart.email === 'guest@example.test'
    && mergedCart.items === 1 && mergedCart.interests === 1 && !mergedCart.source_exists,
  'guest cart merges into an existing account cart during verified sign-in')

  const petalSpeechSettings = (await admin(`select concierge_voice_input_enabled, concierge_voice_output_enabled, concierge_speech_voice
    from public.settings where id = 1`))[0]
  ok(petalSpeechSettings.concierge_voice_input_enabled
    && petalSpeechSettings.concierge_voice_output_enabled
    && petalSpeechSettings.concierge_speech_voice === 'autumn',
  'Petal voice input and speech output are enabled by default')
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000002_gym_packages.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000004_gym_hotel_discount.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000005_loyalty_rewards.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000017_guest_birthdays_and_loyalty_reconciliation.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000026_preview_and_defer_coupon_redemption.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000027_room_upgrades.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000028_room_booking_upgrades_step.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000029_room_upgrade_details_prompts.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000030_remove_room_upgrade_details_prompts.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000031_room_upgrade_icons.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000032_room_upgrade_sort_order.sql'), 'utf8'))
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000033_cart_coupon_application.sql'), 'utf8'))
  const obsoleteUpgradePromptColumns = (await admin(`select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public' and table_name = 'room_addons'
      and column_name in ('details_label', 'details_prompt')`))[0].count
  ok(obsoleteUpgradePromptColumns === 0, 'room upgrade prompt migration removes the unused catalog columns')
  const roomUpgradeIconColumn = (await admin(`select count(*)::int as count from information_schema.columns
    where table_schema = 'public' and table_name = 'room_addons' and column_name = 'icon'`))[0].count
  ok(roomUpgradeIconColumn === 1, 'room upgrades have a configurable icon column')
  const roomUpgradeOrderColumn = (await admin(`select count(*)::int as count from information_schema.columns
    where table_schema = 'public' and table_name = 'room_addons' and column_name = 'sort_order'`))[0].count
  ok(roomUpgradeOrderColumn === 1, 'room upgrades have a configurable display order column')
  console.log('verified gym, loyalty and room upgrade migrations can be reapplied after a partial run')
  await admin(fs.readFileSync(path.join(root, 'seed.sql'), 'utf8'))
  console.log('applied seed.sql (demo data)')
  const guestLoyaltyGuide = (await asAnon('select public.guest_loyalty_guide() as guide'))[0].guide
  ok(guestLoyaltyGuide.room_night_points === 20
    && guestLoyaltyGuide.spa_spend_block_amount === 50
    && guestLoyaltyGuide.tour_booking_points === 10
    && Array.isArray(guestLoyaltyGuide.room_type_free_night_rewards)
    && !('customer_id' in guestLoyaltyGuide)
    && !('loyalty_point_ledger' in guestLoyaltyGuide),
  'public loyalty guide exposes guest rules without account or admin data')
  await admin(`insert into public.spa_service_availability (service_id, weekday, start_time, end_time, capacity)
    values ('00000000-0000-4000-8000-000000000703', 0, '10:00', '12:00', 3)
    on conflict (service_id, weekday) do update
    set start_time = excluded.start_time, end_time = excluded.end_time, capacity = excluded.capacity`)
  await admin(fs.readFileSync(path.join(root, 'migrations', '20261101000009_spa_default_weekly_hours.sql'), 'utf8'))
  const spaScheduleDefaults = await admin(`select
      (select count(*)::int from public.spa_services) as services,
      (select count(*)::int from public.spa_services service
        where (select count(*) from public.spa_service_availability availability
          where availability.service_id = service.id
            and availability.weekday is not null
            and availability.start_time = case when availability.weekday in (0, 6) then time '09:00' else time '08:00' end
            and availability.end_time = time '19:00'
            and availability.capacity = 10) = 7) as configured_services`)
  ok(spaScheduleDefaults[0].services > 0
    && spaScheduleDefaults[0].services === spaScheduleDefaults[0].configured_services,
  'spa default-hours migration replaces the weekly schedule for every service')
  const tourEvent = (await admin("select id, booking_enabled from public.events where title = 'Asa Wright Nature Centre & Bird Watching'"))[0]
  if (!tourEvent || tourEvent.booking_enabled) throw new Error('Tour listings must be non-bookable by default.')
  const demoEvent = (await admin("select id from public.events where title = 'DEMO Sunset Harbor Cruise'"))[0]
  if (!demoEvent) throw new Error('The event booking test fixture is missing.')
  await admin('update public.events set booking_enabled = true, active = true where id = $1', [demoEvent.id])

  const mk = async (role, areas = []) => {
    const id = randomUUID()
    await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{\"first_name\":\"T\",\"last_name\":\"User\",\"phone\":\"555-1234\"}')", [id, `${id}@example.com`])
    await admin('update public.profiles set role = $2, staff_areas = $3 where id = $1', [id, role, areas])
    return id
  }
  const adminU = await mk('admin')
  const FACIAL = '00000000-0000-4000-8000-000000000703'
  const staffRest = await mk('staff', ['restaurant'])
  const staffHotel = await mk('staff', ['hotel'])
  const staffEvents = await mk('staff', ['events'])
  const staffSpa = await mk('staff', ['spa'])
  const staffGym = await mk('staff', ['gym'])
  const customers = []
  for (let i = 0; i < 6; i++) customers.push(await mk('customer'))
  const [c1, c2] = customers
  const requestCustomer = await mk('customer')
  const requestReservation = randomUUID()
  const requestEntitlement = randomUUID()
  await admin(`insert into public.reservations (id, customer_id, status, first_name, last_name)
    values ($1, $2, 'confirmed', 'Jamie', 'Guest')`, [requestReservation, requestCustomer])
  await admin(`insert into public.entitlements
    (id, reservation_id, service_type, title, detail, starts_at, ends_at, eligible_from, eligible_until, meta, status)
    values ($1, $2, 'hotel', 'Ocean Suite', '2 nights', now() + interval '2 days', now() + interval '4 days',
      now(), now() + interval '4 days', $3::jsonb, 'active')`,
  [requestEntitlement, requestReservation, JSON.stringify({
    room_number: '208',
    addons: [
      { id: randomUUID(), name: 'Airport transfer', kind: 'addon' },
      { id: randomUUID(), name: 'Legacy room upgrade', kind: 'upgrade' },
    ],
    room_upgrades: [{ id: randomUUID(), name: 'Early check-in', details: 'Flight AB123' }],
  })])
  const roomRequests = await as(staffHotel, 'select * from public.staff_room_requests()')
  const guestRoomRequests = roomRequests.filter((request) => request.entitlement_id === requestEntitlement)
  ok(guestRoomRequests.length === 3
    && guestRoomRequests.filter((request) => request.request_kind === 'addon').some((request) => request.request_name === 'Airport transfer')
    && guestRoomRequests.filter((request) => request.request_kind === 'upgrade').some((request) => request.request_name === 'Early check-in' && request.request_details === 'Flight AB123')
    && guestRoomRequests.filter((request) => request.request_kind === 'upgrade').some((request) => request.request_name === 'Legacy room upgrade')
    && guestRoomRequests.every((request) => request.guest_name === 'Jamie G.' && request.room_number === '208'),
  'hotel staff can see upcoming booked add-ons and both current and legacy room upgrades')
  ok((await err(as(staffRest, 'select * from public.staff_room_requests()')))?.includes('forbidden'),
    'non-hotel staff cannot access room requests')
  const weeklySchedule = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    open: weekday === 0,
    start_time: weekday === 0 ? '10:00' : null,
    end_time: weekday === 0 ? '12:00' : null,
    capacity: 3,
  }))
  await as(adminU, 'select public.save_spa_weekly_availability($1, $2::jsonb)', [FACIAL, JSON.stringify(weeklySchedule)])
  ok((await admin('select weekday, capacity from public.spa_service_availability where service_id = $1', [FACIAL]))
    .some((row) => row.weekday === 0 && row.capacity === 3), 'admin saves all seven weekly rows with open days')
  ok((await err(as(c1, 'select public.save_spa_weekly_availability($1, $2::jsonb)', [FACIAL, JSON.stringify(weeklySchedule)])))?.includes('forbidden'),
    'customers cannot edit spa weekly availability')
  const pendingAdmin = await mk('staff')
  await admin('update public.profiles set active = false where id = $1', [pendingAdmin])
  await admin("insert into public.audit_log (action, entity_type, entity_id, details) values ('admin_registration.pending', 'profile', $1, '{}')", [pendingAdmin])

  const day = (n) => admin("select (current_date + $1::int)::text d", [n]).then((r) => r[0].d)
  const T1 = '00000000-0000-4000-8000-000000000501' // 4-top
  const D1 = '00000000-0000-4000-8000-000000000505' // 2-top
  const BAR = '00000000-0000-4000-8000-000000000504'
  const SUITE = '00000000-0000-4000-8000-000000000203' // only 1 room
  const MASSAGE = '00000000-0000-4000-8000-000000000701'
  const COUPLES_MASSAGE = '00000000-0000-4000-8000-000000000702'
  const d3 = await day(3)
  const d5 = await day(5), d6 = await day(6), d7 = await day(7), d8 = await day(8), d9 = await day(9), d10 = await day(10), d11 = await day(11), d12 = await day(12)
  await admin(`insert into public.spa_service_availability (service_id, weekday, start_time, end_time, capacity) values
    ($1, extract(dow from $3::date)::int, '09:00', '17:00', 2),
    ($2, extract(dow from $3::date)::int, '09:00', '17:00', 1),
    ($1, extract(dow from $4::date)::int, '09:00', '17:00', 2),
    ($2, extract(dow from $4::date)::int, '09:00', '17:00', 1)
    on conflict (service_id, weekday) do update
      set start_time = excluded.start_time, end_time = excluded.end_time, capacity = excluded.capacity`,
  [MASSAGE, COUPLES_MASSAGE, d3, d5])

  console.log('\nGym packages and stay access')
  const gymPackageCount = (await as(c1, "select count(*)::int n from public.gym_packages where active"))[0].n
  ok(gymPackageCount === 4, 'guests can see the four active gym packages')
  ok((await err(as(c1, "insert into public.gym_packages (slug, title) values ('day-pass', 'Unauthorized')")))?.includes('row-level security'),
    'customers cannot edit gym package prices')
  await as(adminU, `update public.gym_packages set price = case slug
    when 'day-pass' then 20 when 'monthly' then 80 when 'three-month' then 210 when 'yearly' then 720 end`)
  const monthlyPackage = (await admin("select id from public.gym_packages where slug = 'monthly'"))[0].id
  const threeMonthPackage = (await admin("select id from public.gym_packages where slug = 'three-month'"))[0].id
  const annualPackage = (await admin("select id from public.gym_packages where slug = 'yearly'"))[0].id
  const dayPassPackage = (await admin("select id from public.gym_packages where slug = 'day-pass'"))[0].id
  const gymRewardPoints = await admin('select slug, loyalty_points from public.gym_packages')
  ok(['day-pass:5', 'monthly:25', 'three-month:80', 'yearly:350'].every((entry) =>
    gymRewardPoints.some((item) => `${item.slug}:${item.loyalty_points}` === entry)),
  'standalone gym packages have the requested default point rewards')
  const dayPassAudit = await admin(
    "select details from public.audit_log where action = 'gym_packages.update' and entity_id = $1",
    [dayPassPackage],
  )
  ok(dayPassAudit.some(({ details }) => details.changed?.price?.to === 20),
    'admin gym package changes are audited')
  const dayPassCustomer = await mk('customer')
  const dayPassEntitlement = (await as(dayPassCustomer, 'select public.add_gym_package_to_cart($1) id', [dayPassPackage]))[0].id
  ok((await admin(
    "select ends_at = starts_at + interval '1 day' ok from public.entitlements where id = $1",
    [dayPassEntitlement],
  ))[0].ok, 'standalone day pass grants 24 hours of access')
  const threeMonthCustomer = await mk('customer')
  const threeMonthEntitlement = (await as(threeMonthCustomer, 'select public.add_gym_package_to_cart($1) id', [threeMonthPackage]))[0].id
  ok((await admin(
    "select ends_at > starts_at + interval '89 days' and ends_at < starts_at + interval '93 days' ok from public.entitlements where id = $1",
    [threeMonthEntitlement],
  ))[0].ok, 'three-month package uses a three-month access term')
  const annualCustomer = await mk('customer')
  const annualEntitlement = (await as(annualCustomer, 'select public.add_gym_package_to_cart($1) id', [annualPackage]))[0].id
  ok((await admin(
    "select ends_at > starts_at + interval '364 days' and ends_at < starts_at + interval '367 days' ok from public.entitlements where id = $1",
    [annualEntitlement],
  ))[0].ok, 'annual package uses a one-year access term')
  const gymMember = await mk('customer')
  const gymMembershipEntitlement = (await as(gymMember,
    'select public.add_gym_package_to_cart($1) id',
    [monthlyPackage],
  ))[0].id
  const gymMembership = (await admin(
    "select * from public.entitlements where id = $1 and service_type = 'gym'",
    [gymMembershipEntitlement],
  ))[0]
  ok(gymMembership.total === '80.00' && gymMembership.meta.package_slug === 'monthly'
    && (await admin('select ends_at > starts_at + interval \'27 days\' and ends_at < starts_at + interval \'32 days\' ok from public.entitlements where id = $1', [gymMembershipEntitlement]))[0].ok,
  'standalone monthly purchase uses the admin price and a one-month access term')
  await as(gymMember, "select public.checkout_cart('Gym', 'Member', 'gym.member@example.com', '555-1000', 'cash_on_arrival')")
  ok((await as(gymMember, 'select public.my_loyalty_balance() balance'))[0].balance === 25,
    'standalone gym membership awards its configured package points')
  ok((await as(gymMember, 'select * from public.gym_membership_status()')).length === 1,
    'confirmed active gym membership is recognized on the guest account')
  ok((await as(gymMember, 'select public.gym_access_covers_stay($1::date, $2::date) covered', [d10, d12]))[0].covered,
    'active membership hides the room add-on when it covers the stay')
  ok((await err(as(gymMember, 'select public.add_gym_package_to_cart($1)', [annualPackage])))?.includes('gym_membership_active'),
    'active members cannot purchase a duplicate membership')

  const gymStayCustomer = await mk('customer')
  const gymRoomEntitlement = (await as(gymStayCustomer,
    `select public.add_room_booking_to_cart(
      $1, $2::date, $3::date, 2, 1, '{}',
      'Gym', 'Guest', 'gym.guest@example.com', '555-1001', '', '{gym}'
    ) id`,
    [SUITE, d10, d12],
  ))[0].id
  ok((await as(gymStayCustomer,
    'select public.gym_access_covers_stay($1::date, $2::date) covered',
    [d10, d12],
  ))[0].covered === false, 'a saved gym interest does not grant access before setup and checkout')
  const gymStayEntitlement = (await as(gymStayCustomer,
    'select public.add_gym_access_to_room_cart($1, 1, 0) id',
    [gymRoomEntitlement],
  ))[0].id
  const gymStayItem = (await admin('select * from public.entitlements where id = $1', [gymStayEntitlement]))[0]
  ok(gymStayItem.total === '26.00' && gymStayItem.parent_entitlement_id === gymRoomEntitlement
    && gymStayItem.adults === 1 && gymStayItem.children === 0 && gymStayItem.meta.nights === 2
    && Number(gymStayItem.meta.hotel_discount_percent) === 35
    && Number(gymStayItem.meta.discount_amount) === 14,
  'room gym access applies a 35% discount for selected adults only')
  ok((await err(as(gymStayCustomer,
    'select public.add_gym_access_to_room_cart($1, 1, 1)',
    [gymRoomEntitlement],
  )))?.includes('gym_adults_only'), 'room gym access rejects child passes')
  ok((await err(as(gymStayCustomer,
    'select public.add_gym_access_to_room_cart($1, 1, 0)',
    [gymRoomEntitlement],
  )))?.includes('gym_item_in_cart'), 'a room cannot be charged twice for gym access')
  await as(gymStayCustomer, "select public.checkout_cart('Gym', 'Guest', 'gym.guest@example.com', '555-1001', 'cash_on_arrival')")
  ok((await as(gymStayCustomer, 'select public.my_loyalty_balance() balance'))[0].balance === 50,
    'room-linked gym access earns points per selected adult per stay night')
  ok((await as(gymStayCustomer, 'select public.gym_access_covers_stay($1::date, $2::date) covered', [d10, d12]))[0].covered,
    'checked-out stay pass is recognized as access for its exact reservation dates')
  ok((await as(staffGym, 'select * from public.staff_service_list($1, $2::date)', ['gym', d10]))
    .some((item) => item.title === 'Gym access for your stay'),
  'gym staff can see the gym access roster for the stay date')
  await admin(
    "update public.entitlements set eligible_from = now() - interval '1 hour', eligible_until = now() + interval '1 day' where id = $1",
    [gymStayEntitlement],
  )
  const gymPassToken = (await admin(
    "select token from public.qr_passes where reservation_id = (select reservation_id from public.entitlements where id = $1) and status = 'active'",
    [gymStayEntitlement],
  ))[0].token
  const gymScan = (await as(staffGym, "select public.scan_pass($1, 'gym') result", [gymPassToken]))[0].result
  ok(gymScan.state === 'valid' && gymScan.entitlements.some((item) => item.id === gymStayEntitlement),
    'gym staff can scan a gym pass without seeing unrelated services')
  ok((await as(staffGym, "select public.check_in($1, $2, 'gym') result", [gymPassToken, gymStayEntitlement]))[0].result.ok,
    'gym staff can check in an access entitlement')
  ok((await err(as(staffSpa, "select public.scan_pass($1, 'gym')", [gymPassToken])))?.includes('forbidden'),
    'staff without gym access cannot scan gym passes')

  console.log('\nAccess control (RLS)')
  ok((await err(as(c1, 'select public.add_event_to_cart($1, 1, 0)', [tourEvent.id])))?.includes('event_unavailable'), 'advertised tours cannot be booked')
  const hostInquiry = {
    category: 'cultural', event_type: 'Other', custom_event_type: 'Community gala',
    organization_name: 'Example Association', contact_name: 'Event Organizer', contact_title: 'Director',
    email: 'organizer@example.com', phone: '555-123-4567', website: '',
    preferred_date: d3, date_flexible: true, start_time: '18:00', end_time: '22:00',
    expected_guests: 120, spaces_requested: ['Banquet Hall', 'Other'], custom_space: 'Rooftop terrace',
    request_special_room_rates: true, estimated_room_count: 25, checkin_system: 'undecided',
    details: 'Please discuss room rates and event setup.',
  }
  const hostInquiryId = (await asAnon('select public.submit_host_event_inquiry($1::jsonb) id', [JSON.stringify(hostInquiry)]))[0].id
  ok(Boolean(hostInquiryId), 'anonymous guest can submit a hosted-event inquiry with custom event and venue details')
  ok((await as(c1, 'select id from public.host_event_inquiries where id = $1', [hostInquiryId])).length === 0,
    'customers cannot read hosted-event inquiries')
  ok((await as(adminU, 'select id from public.host_event_inquiries where id = $1', [hostInquiryId])).length === 1,
    'admin can review hosted-event inquiries')
  ok((await err(asAnon('select id from public.host_event_inquiries')))?.includes('permission denied'),
    'anonymous guests cannot read hosted-event inquiries')
  await asAnon(
    `insert into public.contact_inquiries (name, email, subject, message)
      values ($1, $2, $3, $4)`,
    ['Contact Guest', 'contact@example.test', 'Room question', 'Could you share more details about a room?'],
  )
  const contactInquiryId = (await admin(
    'select id from public.contact_inquiries where email = $1',
    ['contact@example.test'],
  ))[0].id
  ok(Boolean(contactInquiryId), 'anonymous guest can submit a contact inquiry')
  ok((await as(c1, 'select id from public.contact_inquiries where id = $1', [contactInquiryId])).length === 0,
    'customers cannot read contact inquiries')
  ok((await as(staffHotel, 'select id from public.contact_inquiries where id = $1', [contactInquiryId])).length === 0,
    'staff cannot read contact inquiries')
  ok((await as(adminU, 'select id from public.contact_inquiries where id = $1', [contactInquiryId])).length === 1,
    'admin can review contact inquiries')
  ok((await err(asAnon('select id from public.contact_inquiries')))?.includes('permission denied'),
    'anonymous guests cannot read contact inquiries')
  ok(Boolean(await err(asAnon(
    `insert into public.contact_inquiries (name, email, subject, message)
      values ($1, $2, $3, $4)`,
    ['x', 'not-an-email', 'Hi', 'short'],
  ))), 'contact inquiry fields are validated by the database')
  ok((await err(asAnon('select public.submit_host_event_inquiry($1::jsonb)', [
    JSON.stringify({ ...hostInquiry, checkin_system: null }),
  ])))?.includes('host_event_invalid_checkin_system'), 'submission rejects a missing check-in preference')
  ok((await admin("select 1 from public.audit_log where action = 'host_event_inquiry.submitted' and entity_id = $1", [hostInquiryId])).length === 1,
    'hosted-event inquiry submission is audited')
  ok((await as(c1, 'select 1 from public.audit_log limit 1')).length === 0, 'customer sees no audit log rows')
  ok((await err(as(c1, "insert into public.room_types (name, base_rate) values ('x', 1)")))?.includes('row-level security'), 'customer cannot write catalog')
  ok((await err(as(c1, "update public.profiles set role = 'admin' where id = $1", [c1])))?.includes('forbidden'), 'customer cannot self-promote to admin')
  ok((await err(as(pendingAdmin, 'update public.profiles set active = true where id = $1', [pendingAdmin])))?.includes('forbidden'), 'pending registrant cannot activate own account')
  ok((await err(as(pendingAdmin, "select public.scan_pass('unknown', 'hotel')")))?.includes('forbidden'), 'inactive pending registrant cannot use staff tools')
  ok((await admin("update public.profiles set role = 'admin', active = true where id = $1 and role = 'staff' and active = false returning id", [pendingAdmin])).length === 1, 'admin can approve pending registration')
  ok((await err(as(c1, "select public.admin_set_reservation_status(gen_random_uuid(), 'confirmed')")))?.includes('forbidden'), 'customer cannot call admin function')
  ok((await as(staffRest, 'select 1 from public.reservations')).length === 0, 'staff has no direct reservation access')
  ok((await as(c1, 'select 1 from public.profiles')).length === 1, 'customer only sees own profile')
  ok((await as(adminU, 'select 1 from public.profiles')).length >= 10, 'admin sees all profiles')
  ok((await err(as(c1, "select public.scan_pass('x', 'restaurant')")))?.includes('forbidden'), 'customer cannot scan')
  ok((await err(as(staffRest, "select public.scan_pass('x', 'spa')")))?.includes('forbidden'), 'restaurant staff cannot scan spa')
  ok((await err(as(c1, 'select public.release_expired_holds()')))?.includes('permission denied'), 'internal functions are not callable by clients')
  ok((await as(adminU, "update public.room_categories set description = 'edited' where name = 'Standard' returning id")).length === 1, 'admin can edit catalog')
  ok((await admin("select 1 from public.audit_log where action = 'room_categories.update'")).length === 1, 'admin catalog change is audited')

  console.log('\nRestaurant menu categories')
  const menuCategories = await admin("select id from public.menu_categories where name in ('Starters', 'Mains') order by name")
  const menuProductId = (await as(adminU,
    "select public.admin_save_menu_product(null, 'Multi-category test', '', 12, null, true, true, $1::uuid[]) id",
    [menuCategories.map((category) => category.id)],
  ))[0].id
  ok((await admin('select 1 from public.menu_product_categories where product_id = $1', [menuProductId])).length === 2, 'admin saves a menu product in multiple categories')
  ok((await as(c1, 'select 1 from public.menu_product_categories where product_id = $1', [menuProductId])).length === 2, 'guests can read active product category assignments')
  ok((await err(as(c1,
    "select public.admin_save_menu_product(null, 'Unauthorized', '', 1, null, true, true, '{}')",
  )))?.includes('forbidden'), 'customers cannot create menu products')
  ok((await admin("select count(*)::int n from public.audit_log where action = 'menu_products.create' and entity_id = $1", [menuProductId]))[0].n === 1, 'menu product creation is audited')

  console.log('\nConcurrency: restaurant table')
  let rs = await Promise.allSettled(customers.map((u) => as(u, 'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 2, 0)', [D1, d5, '19:00'])))
  ok(rpcMsgs(rs).filter((m) => m === 'OK').length === 1, 'exactly one of 6 simultaneous table bookings succeeds', JSON.stringify(rpcMsgs(rs)))
  ok(rpcMsgs(rs).filter((m) => m === 'slot_taken').length === 5, 'others receive slot_taken')
  ok((await err(admin("insert into public.table_reservations (entitlement_id, table_id, during, party_size) select entitlement_id, table_id, during, 1 from public.table_reservations limit 1")))?.includes('conflicting key'), 'exclusion constraint blocks raw double insert')
  ok((await err(as(c1,
    'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 2, 0)',
    [T1, d9, '12:00'],
  )))?.includes('table_size_mismatch'), 'two guests cannot reserve a Quartet table')
  ok((await err(as(c1,
    'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 3, 0)',
    [D1, d9, '12:00'],
  )))?.match(/table_size_mismatch|party_size_not_allowed/), 'three guests cannot reserve a Duo table')
  ok((await err(as(c1,
    'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 5, 0)',
    [T1, d9, '12:00'],
  )))?.includes('party_size_not_allowed'), 'five guests cannot reserve a Quartet table')
  const vipEntitlement = (await as(c1,
    'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 5, 0) id',
    ['00000000-0000-4000-8000-000000000503', d9, '12:00'],
  ))[0].id
  ok((await admin('select id from public.entitlements where id = $1 and meta ->> $2 = $3', [vipEntitlement, 'table_label', 'VIP-01'])).length === 1,
    'five guests can reserve an eight-seat VIP table')
  await as(c1, 'select public.remove_cart_item($1)', [vipEntitlement])
  const freeTableAvailability = (await as(c1,
    'select * from public.restaurant_availability($1::date, $2::time) where table_id = $3',
    [d6, '12:00', T1],
  ))[0]
  ok(freeTableAvailability && !freeTableAvailability.taken && freeTableAvailability.taken_seat_ids.length === 0,
    'table with no matching reservation remains available')

  console.log('\nStandalone free restaurant booking')
  const standaloneCustomer = await mk('customer')
  ok((await err(as(standaloneCustomer,
    `select public.confirm_standalone_restaurant_booking(
      $1, null, $2::date, $3::time, 2, 0, 'Alex', 'Guest', 'invalid-email', '555-1234', ''
    )`,
    [D1, d5, '12:00'],
  )))?.includes('invalid_details'), 'standalone booking validates guest details')
  const standaloneBooking = (await as(standaloneCustomer,
    `select public.confirm_standalone_restaurant_booking(
      $1, null, $2::date, $3::time, 2, 0, 'Alex', 'Guest', 'alex@example.com', '555-1234', ''
    ) booking`,
    [D1, d5, '12:00'],
  ))[0].booking
  const standaloneReservation = (await admin(
    'select * from public.reservations where id = $1',
    [standaloneBooking.reservation_id],
  ))[0]
  const standaloneEntitlement = (await admin(
    'select * from public.entitlements where reservation_id = $1 and service_type = $2',
    [standaloneBooking.reservation_id, 'restaurant'],
  ))[0]
  ok(standaloneBooking.status === 'confirmed' && standaloneReservation.status === 'confirmed'
    && standaloneReservation.first_name === 'Alex' && standaloneReservation.total === '0.00',
  'standalone table booking is immediately confirmed with guest details and a zero balance')
  ok(standaloneEntitlement.status === 'active' && standaloneEntitlement.total === '0.00'
    && (await admin('select 1 from public.table_reservations where entitlement_id = $1 and status = $2', [standaloneEntitlement.id, 'confirmed'])).length === 1,
  'standalone restaurant entitlement and table claim are confirmed without a hold')
  ok((await admin('select 1 from public.payments where reservation_id = $1', [standaloneBooking.reservation_id])).length === 0
    && (await admin("select 1 from public.reservations where customer_id = $1 and status = 'cart'", [standaloneCustomer])).length === 0,
  'free standalone booking creates neither a payment nor a cart')
  ok((await admin("select 1 from public.qr_passes where reservation_id = $1 and status = 'active'", [standaloneBooking.reservation_id])).length === 1,
    'standalone confirmed booking receives an active QR pass')
  const conflictingStandaloneCustomer = await mk('customer')
  ok((await err(as(conflictingStandaloneCustomer,
    `select public.confirm_standalone_restaurant_booking(
      $1, null, $2::date, $3::time, 2, 0, 'Sam', 'Guest', 'sam@example.com', '555-1234', ''
    )`,
    [D1, d5, '12:00'],
  )))?.includes('slot_taken')
    && (await admin('select 1 from public.reservations where customer_id = $1', [conflictingStandaloneCustomer])).length === 0,
  'standalone confirmation prevents table conflicts without leaving a partial reservation')

  console.log('\nConcurrency: bar seats')
  const seats = (await admin('select id from public.seats where table_id = $1 order by label', [BAR])).map((r) => r.id)
  rs = await Promise.allSettled([
    as(customers[0], 'select public.add_restaurant_to_cart($1, $2::uuid[], $3::date, $4::time, 4, 0)', [BAR, seats, d6, '20:00']),
    as(customers[1], 'select public.add_restaurant_to_cart($1, $2::uuid[], $3::date, $4::time, 4, 0)', [BAR, seats, d6, '20:00']),
    as(customers[2], 'select public.add_restaurant_to_cart($1, $2::uuid[], $3::date, $4::time, 4, 0)', [BAR, seats, d6, '20:00']),
  ])
  ok(rpcMsgs(rs).filter((m) => m === 'OK').length === 1, 'only one party can book all four bar seats', JSON.stringify(rpcMsgs(rs)))
  const taken = await admin("select seat_id, count(*)::int n from public.table_reservations where table_id = $1 and status <> 'released' group by 1", [BAR])
  ok(taken.every((t) => t.n === 1), 'no seat is held twice')
  const barAvailability = (await as(c1,
    'select * from public.restaurant_availability($1::date, $2::time) where table_id = $3',
    [d6, '20:00', BAR],
  ))[0]
  ok(barAvailability && !barAvailability.taken && barAvailability.taken_seat_ids.length === taken.length,
    'individual seat holds leave the rest of the table selectable')

  console.log('\nConcurrency: per-service spa capacity and hotel room (1 suite)')
  const slot = (await admin("select public.local_ts((current_date + 3), '11:00') s"))[0].s
  rs = await Promise.allSettled(customers.map((u) => as(u, 'select public.add_spa_to_cart($1, $2::timestamptz, 1, 0)', [MASSAGE, slot])))
  ok(rpcMsgs(rs).filter((m) => m === 'OK').length === 2, 'capacity 2 => exactly 2 of 6 simultaneous service bookings succeed', JSON.stringify(rpcMsgs(rs)))
  ok((await err(as(customers[5], 'select public.add_spa_to_cart($1, $2::timestamptz, 1, 0)', [MASSAGE, slot])))?.includes('slot_taken'),
    'full service slot rejects an additional booking')
  ok(!(await admin('select exists (select 1 from public.spa_available_slots($1, $2::date) where slot_start = $3) available', [MASSAGE, d3, slot]))[0].available,
    'a service slot disappears after its capacity is reached')
  ok((await admin('select exists (select 1 from public.spa_available_slots($1, $2::date) where slot_start = $3) available', [COUPLES_MASSAGE, d3, slot]))[0].available,
    'a full slot for one service does not affect another service')
  await as(customers[5], 'select public.add_spa_to_cart($1, $2::timestamptz, 1, 0)', [COUPLES_MASSAGE, slot])
  rs = await Promise.allSettled(customers.map((u) => as(u, 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 0)', [SUITE, d6, d8])))
  ok(rpcMsgs(rs).filter((m) => m === 'OK').length === 1 && rpcMsgs(rs).filter((m) => m === 'sold_out').length === 5, 'single suite: exactly one winner, others sold_out', JSON.stringify(rpcMsgs(rs)))
  ok((await err(as(c1, 'select public.add_room_to_cart($1, $2::date, $3::date, 4, 0)', ['00000000-0000-4000-8000-000000000201', d6, d8])))?.includes('occupancy_exceeded'), 'occupancy limits enforced server-side')
  ok((await err(as(c1, 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 0)', [SUITE, d6, d6])))?.includes('invalid_dates'), 'invalid dates rejected')

  console.log('\nRoom booking modal cart submission')
  const bookingEnt = (await as(c1,
    `select public.add_room_booking_to_cart(
      '00000000-0000-4000-8000-000000000201', $1::date, $2::date, 2, 1, '{}',
      'Avery', 'Guest', 'avery@example.com', '555-1000', 'Late arrival', '{restaurant,spa,event}'
    ) id`,
    [d6, d8],
  ))[0].id
  const bookingReservation = (await admin(
    'select r.* from public.reservations r join public.entitlements e on e.reservation_id = r.id where e.id = $1',
    [bookingEnt],
  ))[0]
  const linkedHoldFixtures = await admin(
    `insert into public.entitlements (
       reservation_id, service_type, title, starts_at, ends_at, eligible_from, eligible_until,
       adults, children, parent_entitlement_id, status, hold_expires_at
     ) values
       ($1, 'spa', 'Hold sync spa fixture', now() + interval '1 day', now() + interval '1 day 1 hour',
        now(), now() + interval '2 days', 2, 1, $2, 'held', now() + interval '30 minutes'),
       ($1, 'event', 'Hold sync event fixture', now() + interval '1 day', now() + interval '1 day 1 hour',
        now(), now() + interval '2 days', 2, 1, $2, 'held', now() + interval '30 minutes')
     returning id`,
    [bookingReservation.id, bookingEnt],
  )
  ok((await admin(
    `select count(*)::int n from public.entitlements child
       join public.entitlements room on room.id = child.parent_entitlement_id
      where child.id = any($1::uuid[]) and child.hold_expires_at = room.hold_expires_at`,
    [linkedHoldFixtures.map((item) => item.id)],
  ))[0].n === 2, 'room-linked spa and event holds inherit the room expiry')
  await admin('update public.entitlements set hold_expires_at = hold_expires_at + interval \'1 minute\' where id = $1', [bookingEnt])
  ok((await admin(
    `select count(*)::int n from public.entitlements child
       join public.entitlements room on room.id = child.parent_entitlement_id
      where child.id = any($1::uuid[]) and child.hold_expires_at = room.hold_expires_at`,
    [linkedHoldFixtures.map((item) => item.id)],
  ))[0].n === 2, 'room hold expiry changes propagate to linked spa and event holds')
  await admin('delete from public.entitlements where id = any($1::uuid[])', [linkedHoldFixtures.map((item) => item.id)])
  ok(bookingReservation.first_name === 'Avery' && bookingReservation.last_name === 'Guest'
    && bookingReservation.email === 'avery@example.com' && bookingReservation.phone === '555-1000'
    && bookingReservation.notes === 'Late arrival', 'room modal guest details are saved to the cart reservation')
  ok((await as(c1, 'select service_type from public.cart_service_interests where reservation_id = $1 and hotel_entitlement_id = $2', [bookingReservation.id, bookingEnt])).length === 3,
    'opted-in extras are scoped to their room booking')
  ok((await as(c2, 'select 1 from public.cart_service_interests where reservation_id = $1', [bookingReservation.id])).length === 0,
    'another customer cannot read cart service interests')
  await as(c1, "select public.set_cart_service_interest('spa', false, $1)", [bookingEnt])
  ok((await admin('select 1 from public.cart_service_interests where reservation_id = $1 and hotel_entitlement_id = $2 and service_type = $3', [bookingReservation.id, bookingEnt, 'spa'])).length === 0,
    'guest can remove a service interest from one room only')
  const secondBookingEnt = (await as(c1,
    `select public.add_room_booking_to_cart(
      '00000000-0000-4000-8000-000000000201', $1::date, $2::date, 2, 0, '{}',
      'Avery', 'Guest', 'avery@example.com', '555-1000', '', '{event}'
    ) id`,
    [d8, d9],
  ))[0].id
  ok((await admin('select 1 from public.cart_service_interests where reservation_id = $1 and hotel_entitlement_id = $2 and service_type = $3', [bookingReservation.id, bookingEnt, 'restaurant'])).length === 1
    && (await admin('select 1 from public.cart_service_interests where reservation_id = $1 and hotel_entitlement_id = $2 and service_type = $3', [bookingReservation.id, secondBookingEnt, 'event'])).length === 1,
    'adding another room preserves and isolates each room’s extra selections')
  ok((await admin('select 1 from public.restaurant_config where id = 1 and slot_minutes = 60')).length === 1,
    'restaurant reservations use hourly booking slots')

  console.log('\nMulti-room hotel booking')
  const multiRoomCustomer = await mk('customer')
  const retryMultiRoomCustomer = await mk('customer')
  const multiRoomType = randomUUID()
  const multiRoomNumbers = Array.from({ length: 3 }, (_, index) => `MR-${randomUUID().slice(0, 8)}-${index + 1}`)
  await admin(
    `insert into public.room_types (id, name, description, max_adults, max_children, max_occupancy, base_rate, min_nights, max_nights)
     values ($1, 'Multi-room test', '', 2, 2, 2, 100, 1, 30)`,
    [multiRoomType],
  )
  await admin(
    'insert into public.rooms (room_type_id, number) select $1, room_number from unnest($2::text[]) room_number',
    [multiRoomType, multiRoomNumbers],
  )
  const multiRoomStart = await day(40), multiRoomEnd = await day(42)
  const roomParties = [
    { adults: 1, children: 1, coupon_codes: [] },
    { adults: 1, children: 0, coupon_codes: [] },
  ]
  const multiRoomEntitlements = (await as(multiRoomCustomer,
    `select public.add_multi_room_booking_with_coupons_to_cart(
      $1, $2::date, $3::date, $4::jsonb, '{}',
      'Multi', 'Room', 'multi@example.com', '555-1212', '', '{}'
    ) ids`,
    [multiRoomType, multiRoomStart, multiRoomEnd, JSON.stringify(roomParties)],
  ))[0].ids
  const multiRoomTotals = (await admin(
    `select count(*)::int rooms, sum(adults)::int adults, sum(children)::int children,
            count(distinct meta->>'room_number')::int assigned_rooms, sum(total)::numeric total
       from public.entitlements where id = any($1::uuid[]) and service_type = 'hotel'`,
    [multiRoomEntitlements],
  ))[0]
  ok(multiRoomEntitlements.length === 2 && multiRoomTotals.rooms === 2
    && multiRoomTotals.adults === 2 && multiRoomTotals.children === 1
    && multiRoomTotals.assigned_rooms === 2 && Number(multiRoomTotals.total) === 400,
  'multi-room booking creates two distinct room entitlements with the party and price split correctly')
  const roomStayUpgradeId = randomUUID()
  const roomNightUpgradeId = randomUUID()
  const roomGuestUpgradeId = randomUUID()
  const upgradeTemplates = await admin(`select name, kind, active from public.room_addons
    where lower(name) = any(array['airport pickup', 'airport drop-off', 'early check-in', 'late checkout'])`)
  ok(['Airport pickup', 'Airport drop-off', 'Early check-in'].every((name) =>
    upgradeTemplates.some((upgrade) => upgrade.name === name && upgrade.kind === 'upgrade' && !upgrade.active))
    && upgradeTemplates.some((upgrade) => upgrade.name === 'Late checkout' && upgrade.kind === 'upgrade'),
  'airport transfer and early check-in templates are staged as upgrades, with late checkout moved out of add-ons')
  const defaultUpgradeIcons = await admin(`select name, icon from public.room_addons
    where lower(name) = any(array['airport pickup', 'airport drop-off', 'early check-in'])`)
  ok(defaultUpgradeIcons.length === 3
    && defaultUpgradeIcons.filter((upgrade) => upgrade.name.toLowerCase().includes('airport')).every((upgrade) => upgrade.icon === 'plane')
    && defaultUpgradeIcons.find((upgrade) => upgrade.name === 'Early check-in')?.icon === 'clock-3',
  'the icon migration assigns airplane and clock defaults to the matching upgrade templates')
  const orderedUpgradeTemplates = await admin(`select name, sort_order from public.room_addons
    where name in ('Airport pickup', 'Airport drop-off', 'Early check-in')`)
  ok(orderedUpgradeTemplates.find((upgrade) => upgrade.name === 'Airport pickup')?.sort_order
    < orderedUpgradeTemplates.find((upgrade) => upgrade.name === 'Airport drop-off')?.sort_order
    && orderedUpgradeTemplates.find((upgrade) => upgrade.name === 'Airport drop-off')?.sort_order
    < orderedUpgradeTemplates.find((upgrade) => upgrade.name === 'Early check-in')?.sort_order,
  'the upgrade-order migration assigns predictable initial positions to existing upgrade templates')
  const breakfastRoomAddon = (await admin("select id from public.room_addons where name = 'Breakfast' limit 1"))[0].id
  ok((await err(admin('update public.room_addons set room_type_id = $1 where id = $2', [multiRoomType, breakfastRoomAddon])))
    ?.includes('addon_room_type_requires_upgrade'),
  'regular add-ons cannot be assigned room-type-specific settings')
  await admin(`insert into public.room_addons (id, room_type_id, name, description, kind, price, pricing, active)
    values
      ($1, $2, 'Room-specific upgrade test', 'Only the test room type', 'upgrade', 45, 'per_stay', true),
      ($3, null, 'Per-night upgrade test', 'Charged per night per selected room', 'upgrade', 7, 'per_night', true),
      ($4, null, 'Per-guest upgrade test', 'Charged per guest in each selected room', 'upgrade', 3, 'per_guest', true)`,
  [roomStayUpgradeId, multiRoomType, roomNightUpgradeId, roomGuestUpgradeId])
  const roomUpgradeSelections = [
    { room_id: multiRoomEntitlements[0], upgrades: [
      { upgrade_id: roomStayUpgradeId, details: 'Airport pickup, flight MR123' },
      { upgrade_id: roomGuestUpgradeId, details: 'One child seat needed' },
    ] },
    { room_id: multiRoomEntitlements[1], upgrades: [
      { upgrade_id: roomNightUpgradeId, details: 'Late checkout request' },
      { upgrade_id: roomGuestUpgradeId, details: '' },
    ] },
  ]
  await as(multiRoomCustomer, 'select public.set_cart_room_upgrades($1::jsonb)', [JSON.stringify(roomUpgradeSelections)])
  const upgradedRoomTotals = await admin(
    `select id, total, meta->'room_upgrades' as upgrades from public.entitlements where id = any($1::uuid[])`,
    [multiRoomEntitlements],
  )
  const upgradedTotalsById = new Map(upgradedRoomTotals.map((room) => [room.id, room]))
  ok(Number(upgradedTotalsById.get(multiRoomEntitlements[0]).total) === 251
    && Number(upgradedTotalsById.get(multiRoomEntitlements[1]).total) === 217
    && upgradedTotalsById.get(multiRoomEntitlements[0]).upgrades.length === 2,
  'room upgrades use the selected room type, stay length, and guest count when calculating per-room prices')
  const updatedDetails = roomUpgradeSelections.map((selection) => ({
    ...selection,
    upgrades: selection.upgrades.map((upgrade) => ({ ...upgrade, details: `Updated: ${upgrade.details}` })),
  }))
  await as(multiRoomCustomer, 'select public.set_cart_room_upgrades($1::jsonb)', [JSON.stringify(updatedDetails)])
  const idempotentUpgradeTotals = await admin(
    `select id, total, meta->'room_upgrades' as upgrades from public.entitlements where id = any($1::uuid[])`,
    [multiRoomEntitlements],
  )
  ok(idempotentUpgradeTotals.every((room) => Number(room.total) === (room.id === multiRoomEntitlements[0] ? 251 : 217))
    && idempotentUpgradeTotals.some((room) => room.upgrades.some((upgrade) => upgrade.details === 'Updated: Airport pickup, flight MR123')),
  'saving upgrade details repeatedly does not double-charge and persists staff notes')
  ok((await err(as(multiRoomCustomer,
    'select public.add_room_to_cart($1, $2::date, $3::date, 1, 0, $4::uuid[])',
    [multiRoomType, multiRoomStart, multiRoomEnd, [roomStayUpgradeId]],
  )))?.includes('addon_unavailable'), 'room upgrades cannot be added through the regular room add-on flow')
  const crossTypeCartRooms = await admin(
    `select entitlement.id from public.entitlements entitlement
       join public.reservations reservation on reservation.id = entitlement.reservation_id
      where reservation.customer_id = $1 and reservation.status = 'cart'
        and entitlement.service_type = 'hotel' and entitlement.status in ('held', 'active')`,
    [c1],
  )
  const crossTypeSelections = crossTypeCartRooms.map((room, index) => ({
    room_id: room.id,
    upgrades: index === 0 ? [{ upgrade_id: roomStayUpgradeId, details: '' }] : [],
  }))
  ok((await err(as(c1, 'select public.set_cart_room_upgrades($1::jsonb)', [JSON.stringify(crossTypeSelections)])))
    ?.includes('upgrade_unavailable'),
  'room-type-specific upgrades cannot be selected for another room type')
  const upgradeOutsider = await mk('customer')
  ok((await err(as(upgradeOutsider, 'select public.set_cart_room_upgrades($1::jsonb)', [JSON.stringify(roomUpgradeSelections)])))
    ?.includes('cart_room_not_found'),
  'guests cannot change another guest’s room upgrades')
  const singleModalUpgradeCustomer = await mk('customer')
  const singleModalUpgradeStart = await day(43), singleModalUpgradeEnd = await day(44)
  const singleModalUpgradeEntitlement = (await as(singleModalUpgradeCustomer,
    `select public.add_room_booking_with_upgrades_to_cart(
      $1, $2::date, $3::date, 1, 0, '{}', 'Single', 'Upgrade',
      'single-upgrade@example.com', '555-1310', '', '{}', '{}', $4::jsonb
    ) id`,
    [multiRoomType, singleModalUpgradeStart, singleModalUpgradeEnd, JSON.stringify([
      { upgrade_id: roomStayUpgradeId, details: 'Single-modal pickup request' },
    ])],
  ))[0].id
  const singleModalUpgradeTotal = (await admin(
    `select total, meta->'room_upgrades' as upgrades from public.entitlements where id = $1`,
    [singleModalUpgradeEntitlement],
  ))[0]
  ok(Number(singleModalUpgradeTotal.total) === 145
    && singleModalUpgradeTotal.upgrades[0].details === 'Single-modal pickup request',
  'single-room booking saves and charges upgrades chosen in the booking flow')
  const multiModalUpgradeCustomer = await mk('customer')
  const multiModalUpgradeStart = await day(45), multiModalUpgradeEnd = await day(46)
  const multiModalUpgradeParties = [
    { adults: 1, children: 0, coupon_codes: [] },
    { adults: 1, children: 0, coupon_codes: [] },
  ]
  const multiModalUpgradeEntitlements = (await as(multiModalUpgradeCustomer,
    `select public.add_multi_room_booking_with_upgrades_to_cart(
      $1, $2::date, $3::date, $4::jsonb, '{}',
      'Multi', 'Upgrade', 'multi-upgrade@example.com', '555-1311', '', '{}', $5::jsonb
    ) ids`,
    [multiRoomType, multiModalUpgradeStart, multiModalUpgradeEnd, JSON.stringify(multiModalUpgradeParties), JSON.stringify([
      { upgrades: [{ upgrade_id: roomStayUpgradeId, details: 'Room one pickup' }] },
      { upgrades: [] },
    ])],
  ))[0].ids
  const multiModalUpgradeTotals = await admin(
    `select total, meta->'room_upgrades' as upgrades from public.entitlements where id = any($1::uuid[])`,
    [multiModalUpgradeEntitlements],
  )
  ok(multiModalUpgradeTotals.length === 2
    && multiModalUpgradeTotals.some((entitlement) => Number(entitlement.total) === 145
      && entitlement.upgrades[0].details === 'Room one pickup')
    && multiModalUpgradeTotals.some((entitlement) => Number(entitlement.total) === 100
      && entitlement.upgrades.length === 0),
  'multi-room booking applies selected upgrades only to the chosen rooms')
  const failedUpgradeCustomer = await mk('customer')
  const failedUpgradeDate = await day(47), failedUpgradeCheckout = await day(48)
  const failedUpgradeError = await err(as(failedUpgradeCustomer,
    `select public.add_room_booking_with_upgrades_to_cart(
      $1, $2::date, $3::date, 1, 0, '{}', 'Failed', 'Upgrade',
      'failed-upgrade@example.com', '555-1312', '', '{}', '{}', $4::jsonb
    )`,
    [multiRoomType, failedUpgradeDate, failedUpgradeCheckout, JSON.stringify([
      { upgrade_id: randomUUID(), details: '' },
    ])],
  ))
  const failedUpgradeCartCount = (await admin(
    "select count(*)::int as count from public.reservations where customer_id = $1 and status = 'cart'",
    [failedUpgradeCustomer],
  ))[0].count
  ok(failedUpgradeError?.includes('upgrade_unavailable') && failedUpgradeCartCount === 0,
    'failed upgrade validation rolls back the new room booking')
  const upgradeCheckout = (await as(multiRoomCustomer,
    "select public.checkout_cart('Multi', 'Room', 'multi@example.com', '555-1212', 'cash_on_arrival') r",
  ))[0].r
  const upgradeCheckoutTotals = (await admin(
    'select subtotal, total from public.reservations where id = $1',
    [upgradeCheckout.reservation_id],
  ))[0]
  ok(Number(upgradeCheckoutTotals.subtotal) === 468 && Number(upgradeCheckoutTotals.total) >= 468,
    'selected room upgrades are included in checkout subtotal and final charge')
  const multiRoomRetryError = await err(as(retryMultiRoomCustomer,
    `select public.add_multi_room_booking_with_coupons_to_cart(
      $1, $2::date, $3::date, $4::jsonb, '{}',
      'Retry', 'Room', 'retry@example.com', '555-1213', '', '{}'
    )`,
    [multiRoomType, multiRoomStart, multiRoomEnd, JSON.stringify(roomParties)],
  ))
  const retryCartCount = (await admin("select count(*)::int n from public.reservations where customer_id = $1 and status = 'cart'", [retryMultiRoomCustomer]))[0].n
  const roomsAvailableAfterRetry = (await admin(
    'select rooms_available from public.room_type_availability($1::date, $2::date) where room_type_id = $3',
    [multiRoomStart, multiRoomEnd, multiRoomType],
  ))[0].rooms_available
  ok(multiRoomRetryError?.includes('sold_out') && retryCartCount === 0 && roomsAvailableAfterRetry === 1,
    'multi-room booking rolls back all room holds if a later room cannot be assigned',
    JSON.stringify({ multiRoomRetryError, retryCartCount, roomsAvailableAfterRetry }))

  console.log('\nHotel loyalty points and coupons')
  const loyaltyCustomer = await mk('customer')
  const breakfastAddon = (await admin("select id from public.room_addons where name = 'Breakfast'"))[0].id
  const rewardRoomType = '00000000-0000-4000-8000-000000000201'
  await admin('update public.room_types set loyalty_free_night_points = 20 where id = $1', [rewardRoomType])
  const loyaltyStart = await day(25), loyaltyEnd = await day(27)
  const earnedEntitlement = (await as(loyaltyCustomer,
    `select public.add_room_booking_with_coupons_to_cart(
      $1, $2::date, $3::date, 2, 0, $4::uuid[], 'Loyalty', 'Guest',
      'loyalty@example.com', '555-1010', '', '{}', '{}'
    ) id`,
    [rewardRoomType, loyaltyStart, loyaltyEnd, [breakfastAddon]],
  ))[0].id
  await as(loyaltyCustomer, "select public.checkout_cart('Loyalty', 'Guest', 'loyalty@example.com', '555-1010', 'cash_on_arrival')")
  const earnedBalance = (await as(loyaltyCustomer, 'select public.my_loyalty_balance() balance'))[0].balance
  ok(earnedBalance === 45, 'confirmed room nights and add-ons award configurable points')
  ok((await as(loyaltyCustomer, "select 1 from public.loyalty_point_ledger where entry_type = 'earn'")).length === 2,
    'room night and room add-on awards are recorded separately')
  const loyaltyReservationId = (await admin('select reservation_id from public.entitlements where id = $1', [earnedEntitlement]))[0].reservation_id
  await admin('delete from public.loyalty_point_ledger where reservation_id = $1', [loyaltyReservationId])
  await admin("update public.reservations set status = 'completed' where id = $1", [loyaltyReservationId])
  const restoredBalance = (await as(loyaltyCustomer, 'select public.backfill_my_loyalty_points() balance'))[0].balance
  await as(loyaltyCustomer, 'select public.backfill_my_loyalty_points()')
  const backfilledEntries = (await admin(
    "select count(*)::int as entries, coalesce(sum(points), 0)::int as points from public.loyalty_point_ledger where reservation_id = $1 and entry_type = 'earn'",
    [loyaltyReservationId],
  ))[0]
  ok(restoredBalance === 45 && backfilledEntries.entries === 2 && backfilledEntries.points === 45
    && (await as(loyaltyCustomer, 'select public.my_loyalty_balance() balance'))[0].balance === 45,
  'guest points backfill restores eligible completed bookings once without duplicates')
  await as(c1, 'select public.backfill_my_loyalty_points()')
  ok((await as(c1, 'select public.my_loyalty_balance() balance'))[0].balance === 0
    && (await as(loyaltyCustomer, 'select public.my_loyalty_balance() balance'))[0].balance === 45,
  'each guest backfill is restricted to the signed-in customer and cannot affect another account')
  await admin("update public.profiles set birthday = '1990-02-01' where id = $1", [loyaltyCustomer])
  const unauthorizedBirthdayUpdate = await err(as(loyaltyCustomer,
    "update public.profiles set birthday = '1991-02-01' where id = $1",
    [loyaltyCustomer],
  ))
  ok(unauthorizedBirthdayUpdate?.includes('forbidden'),
    'guests cannot change the birthday recorded on their profile')

  const hotelDate = (await admin(
    "select to_char((now() at time zone public.hotel_tz())::date, 'YYYY-MM-DD') as today",
  ))[0].today
  const hotelYear = hotelDate.slice(0, 4)
  const hotelToday = hotelDate.slice(5)
  const birthdayValue = `2000-${hotelToday}`
  const birthdayGuest = await mk('customer')
  const deskBirthdayGuest = await mk('customer')
  await admin('update public.profiles set birthday = $1 where id = any($2::uuid[])',
    [birthdayValue, [birthdayGuest, deskBirthdayGuest]])
  const birthdayStatus = (await as(birthdayGuest, 'select * from public.my_birthday_reward_status()'))[0]
  ok(birthdayStatus.birthday_today && !birthdayStatus.already_claimed && birthdayStatus.can_claim,
    'birthday status uses the hotel-local date and marks an unclaimed birthday gift eligible')
  const birthdayBalance = (await as(birthdayGuest,
    'select public.claim_my_birthday_reward() as balance'))[0].balance
  ok(birthdayBalance === 100
    && (await admin(
      "select details ->> 'claim_method' as method from public.loyalty_point_ledger where customer_id = $1 and reference_key = $2",
      [birthdayGuest, `birthday:${birthdayGuest}:${hotelYear}`],
    )).some(({ method }) => method === 'guest'),
  'guest explicitly claims one 100-point birthday gift')
  ok((await err(as(birthdayGuest, 'select public.claim_my_birthday_reward()')))
    ?.includes('birthday_reward_already_claimed'),
  'guest cannot claim the birthday gift twice in one hotel year')
  const deskLookupForClaimedGuest = (await as(staffHotel,
    'select * from public.staff_find_birthday_guest($1)',
    [`${birthdayGuest}@example.com`],
  ))[0]
  ok(deskLookupForClaimedGuest?.already_claimed === true,
    'front desk lookup sees that the same annual gift was already claimed online')

  const deskLookup = (await as(staffHotel,
    'select * from public.staff_find_birthday_guest($1)',
    [`${deskBirthdayGuest}@example.com`],
  ))[0]
  ok(deskLookup?.birthday_today === true && deskLookup.already_claimed === false,
    'hotel staff can look up only the required birthday redemption details by exact email')
  const deskBalance = (await as(staffHotel,
    'select public.staff_award_birthday_reward($1) as balance',
    [deskBirthdayGuest],
  ))[0].balance
  ok(deskBalance === 100
    && (await admin(
      "select details ->> 'claim_method' as method from public.loyalty_point_ledger where customer_id = $1 and reference_key = $2",
      [deskBirthdayGuest, `birthday:${deskBirthdayGuest}:${hotelYear}`],
    )).some(({ method }) => method === 'front_desk'),
  'hotel staff explicitly redeems the same 100-point annual gift')
  ok((await err(as(staffHotel,
    'select public.staff_award_birthday_reward($1)',
    [deskBirthdayGuest],
  )))?.includes('birthday_reward_already_claimed'),
  'front desk cannot redeem a gift already issued for this year')
  ok((await err(as(staffRest,
    "select * from public.staff_find_birthday_guest($1)",
    [`${deskBirthdayGuest}@example.com`],
  )))?.includes('forbidden'),
  'non-hotel staff cannot access birthday guest lookup')
  const leapBirthdayChecks = (await admin(`select
    public._birthday_is_observed('2000-02-29', '2027-02-28') as february_28,
    public._birthday_is_observed('2000-02-29', '2027-03-01') as march_1,
    public._birthday_is_observed('2000-02-29', '2027-02-27') as wrong_date,
    public._birthday_is_observed('2000-02-29', '2028-02-29') as leap_day`))[0]
  ok(leapBirthdayChecks.february_28 && leapBirthdayChecks.march_1
    && !leapBirthdayChecks.wrong_date && leapBirthdayChecks.leap_day,
  'February 29 birthdays may redeem on either adjacent date in non-leap years and on leap day otherwise')
  ok((await err(as(birthdayGuest,
    "select public._birthday_is_observed('2000-02-29', '2027-02-28')",
  )))?.includes('permission denied'),
  'birthday date helper is not executable by guests')

  const returningGuest = await mk('customer')
  const cartOnlyGuest = await mk('customer')
  const returningEmail = `${returningGuest}@example.com`
  const cartOnlyEmail = `${cartOnlyGuest}@example.com`
  await admin(`insert into public.reservations (customer_id, status, email)
    values ($1, 'confirmed', $2), ($3, 'cart', $4)`,
  [returningGuest, returningEmail, cartOnlyGuest, cartOnlyEmail])
  const emailLookup = await admin(`select
    public.guest_has_prior_booking($1) as prior_booking,
    public.guest_has_prior_booking($2) as cart_only`,
  [returningEmail.toUpperCase(), cartOnlyEmail])
  ok(emailLookup[0].prior_booking === true && emailLookup[0].cart_only === false,
    'guest email check matches prior bookings case-insensitively and ignores open carts')
  ok((await err(asAnon('select public.guest_has_prior_booking($1)', [returningEmail])))
    ?.includes('permission denied')
    && (await admin(`select has_function_privilege(
      'service_role', 'public.guest_has_prior_booking(text)', 'EXECUTE'
    ) as service_role_only`))[0].service_role_only,
  'prior-booking lookup is callable only through the trusted server role')

  const newCoupons = await as(loyaltyCustomer, 'select * from public.redeem_loyalty_points($1, 2)', [rewardRoomType])
  const couponCodes = newCoupons.map((coupon) => coupon.coupon_code)
  ok(couponCodes.length === 2 && (await as(loyaltyCustomer, 'select public.my_loyalty_balance() balance'))[0].balance === 5,
    'one redemption can mint multiple room-specific coupons and deducts points atomically')
  const previewDiscount = (await as(loyaltyCustomer,
    'select public.preview_room_booking_coupon_discount($1, $2::date, $3::date, 1, $4::text[]) discount',
    [rewardRoomType, loyaltyStart, loyaltyEnd, couponCodes],
  ))[0].discount
  ok(Number(previewDiscount) === 280
    && (await admin("select count(*)::int n from public.loyalty_coupons where code = any($1::text[]) and status = 'available'", [couponCodes]))[0].n === 2,
  'coupon preview calculates the full discount without reserving or redeeming codes')
  ok((await as(c1, 'select id from public.loyalty_coupons where code = any($1::text[])', [couponCodes])).length === 0,
    'customers cannot read another guest’s coupons')
  const rejectedRulesUpdate = await as(c1,
    'update public.loyalty_settings set room_night_points = 999 where id = 1 returning id',
  )
  ok(rejectedRulesUpdate.length === 0 && (await admin('select room_night_points from public.loyalty_settings where id = 1'))[0].room_night_points === 20,
    'customers cannot change global loyalty rules')
  await as(adminU, 'update public.loyalty_settings set tour_booking_points = 11 where id = 1')
  const loyaltyRulesAudit = await admin("select details from public.audit_log where action = 'loyalty_settings.update'")
  ok(loyaltyRulesAudit.some(({ details }) => details.changed?.tour_booking_points?.to === 11),
    'admin loyalty rule changes are audited')
  await as(adminU, 'update public.loyalty_settings set tour_booking_points = 10 where id = 1')
  ok((await as(c1, 'select public.my_loyalty_balance() balance'))[0].balance === 0,
    'loyalty balance RPC is available to signed-in customers')
  ok((await err(as(loyaltyCustomer,
    `select public.add_room_booking_with_coupons_to_cart(
      $1, $2::date, $3::date, 2, 0, '{}', 'Loyalty', 'Guest',
      'loyalty@example.com', '555-1010', '', '{}', $4::text[]
    )`,
    ['00000000-0000-4000-8000-000000000202', loyaltyStart, loyaltyEnd, couponCodes],
  )))?.includes('loyalty_coupon_invalid'), 'coupons cannot be applied to a different room type')
  const couponEntitlement = (await as(loyaltyCustomer,
    `select public.add_room_booking_with_coupons_to_cart(
      $1, $2::date, $3::date, 2, 0, $4::uuid[], 'Loyalty', 'Guest',
      'loyalty@example.com', '555-1010', '', '{}', $5::text[]
    ) id`,
    [rewardRoomType, loyaltyStart, loyaltyEnd, [breakfastAddon], couponCodes],
  ))[0].id
  const couponReservation = (await admin('select reservation_id from public.entitlements where id = $1', [couponEntitlement]))[0].reservation_id
  ok((await admin(
    `select total = 36 and (meta ->> 'loyalty_discount')::numeric = 280
       and jsonb_array_length(meta -> 'loyalty_coupon_ids') = 2 ok
       from public.entitlements where id = $1`,
    [couponEntitlement],
  ))[0].ok, 'stacked coupons discount room nights without discounting add-ons')
  ok((await admin("select count(*)::int n from public.loyalty_coupons where code = any($1::text[]) and status = 'reserved' and reservation_id = $2", [couponCodes, couponReservation]))[0].n === 2,
    'adding coupons to a cart reserves them without redeeming them')
  await as(loyaltyCustomer, "select public.checkout_cart('Loyalty', 'Guest', 'loyalty@example.com', '555-1010', 'cash_on_arrival')")
  const couponPayment = (await admin(
    'select id, status from public.payments where reservation_id = $1 and entitlement_id is null',
    [couponReservation],
  ))[0]
  const couponsAfterUnpaidCheckout = (await admin(
    'select status, count(*)::int count from public.loyalty_coupons where code = any($1::text[]) and reservation_id = $2 group by status',
    [couponCodes, couponReservation],
  ))
  ok(couponPayment.status === 'unpaid'
    && couponsAfterUnpaidCheckout.length === 1
    && couponsAfterUnpaidCheckout[0].status === 'reserved' && couponsAfterUnpaidCheckout[0].count === 2,
  'confirmed cash-on-arrival bookings keep coupon codes reserved until payment')
  if (couponPayment.status !== 'unpaid' || couponsAfterUnpaidCheckout.length !== 1
      || couponsAfterUnpaidCheckout[0].status !== 'reserved' || couponsAfterUnpaidCheckout[0].count !== 2) {
    console.log('  coupon redemption diagnostic', JSON.stringify({ couponPayment, couponsAfterUnpaidCheckout }))
  }
  await admin("update public.payments set status = 'paid', paid_at = now() where id = $1", [couponPayment.id])
  ok((await admin("select count(*)::int n from public.loyalty_coupons where code = any($1::text[]) and status = 'redeemed' and reservation_id = $2", [couponCodes, couponReservation]))[0].n === 2,
    'coupons become redeemed only after the booking payment is confirmed')
  ok((await as(loyaltyCustomer, "select 1 from public.loyalty_point_ledger where reservation_id = $1 and entry_type = 'earn'", [couponReservation])).length === 1,
    'coupon-covered nights do not earn room-night points while paid add-ons still do')
  await as(loyaltyCustomer, 'select public.cancel_my_reservation($1, $2)', [couponReservation, 'Test cancellation'])
  ok((await admin("select count(*)::int n from public.loyalty_coupons where code = any($1::text[]) and status = 'available' and reservation_id is null", [couponCodes]))[0].n === 2,
    'cancelling a reservation restores its coupons')
  const cartCouponEntitlement = (await as(loyaltyCustomer,
    `select public.add_room_booking_with_coupons_to_cart(
      $1, $2::date, $3::date, 2, 0, '{}', 'Loyalty', 'Guest',
      'loyalty@example.com', '555-1010', '', '{}', '{}'
    ) id`,
    [rewardRoomType, loyaltyStart, loyaltyEnd],
  ))[0].id
  await as(loyaltyCustomer, 'select public.apply_cart_coupon($1)', [couponCodes[0]])
  await as(loyaltyCustomer, 'select public.apply_cart_coupon($1)', [couponCodes[1]])
  ok((await admin(`select total = 0
      and (meta->>'loyalty_discount')::numeric = 280
      and jsonb_array_length(meta->'loyalty_coupon_ids') = 2
      and (select count(*) from jsonb_object_keys(meta->'loyalty_coupon_allocations')) = 2 as ok
    from public.entitlements where id = $1`, [cartCouponEntitlement]))[0].ok,
  'cart coupon application stacks room-night discounts and updates the cart total')
  await as(loyaltyCustomer, 'select public.remove_cart_coupon($1)', [couponCodes[0]])
  ok((await admin(`select total = 140
      and (meta->>'loyalty_discount')::numeric = 140
      and jsonb_array_length(meta->'loyalty_coupon_ids') = 1 as ok
    from public.entitlements where id = $1`, [cartCouponEntitlement]))[0].ok
    && (await admin("select status from public.loyalty_coupons where code = $1", [couponCodes[0]]))[0].status === 'available',
  'removing a cart coupon restores its exact discount and makes the code available')
  await as(loyaltyCustomer, 'select public.remove_cart_coupon($1)', [couponCodes[1]])
  ok((await admin(`select total = 280
      and (meta->>'loyalty_discount')::numeric = 0
      and jsonb_array_length(meta->'loyalty_coupon_ids') = 0 as ok
    from public.entitlements where id = $1`, [cartCouponEntitlement]))[0].ok,
  'removing all cart coupons restores the full room-night total')
  await as(loyaltyCustomer, 'select public.remove_cart_item($1)', [cartCouponEntitlement])
  ok((await as(loyaltyCustomer, 'select public.my_loyalty_balance() balance'))[0].balance === 5,
    'cancellation reverses points earned on the cancelled booking')
  const adminBalanceRows = await as(adminU,
    'select * from public.admin_loyalty_customer_balances($1, $2, $3)',
    [null, 100, 0],
  )
  ok(adminBalanceRows.some((row) => row.customer_id === loyaltyCustomer && Number(row.points_balance) === 5 && Number(row.total_count) >= 1),
    'admins can see accurate customer point balances in the paginated tracker')
  ok(adminBalanceRows.some((row) => row.customer_id === adminU)
    && (await admin("select 1 from public.profiles where id = $1 and role = 'admin'", [adminU])).length === 1,
    'admin loyalty tracker includes admin accounts alongside guests')
  ok(adminBalanceRows.some((row) => row.customer_id === verifiedGuestId && Number(row.points_balance) === 25)
    && !adminBalanceRows.some((row) => row.customer_id === guestOwnerId),
  'claimed guest points appear once under the verified email account')
  const loyaltyAccounts = await as(adminU, 'select * from public.admin_loyalty_customer_accounts()')
  ok(loyaltyAccounts.some((row) => row.customer_id === loyaltyCustomer && row.role === 'customer')
    && loyaltyAccounts.some((row) => row.customer_id === adminU && row.role === 'admin')
    && !loyaltyAccounts.some((row) => row.customer_id === guestOwnerId),
  'coupon recipient list includes guests and admins without duplicate claimed guests')
  ok((await err(as(c1,
    'select * from public.admin_loyalty_customer_balances($1, $2, $3)',
    [null, 100, 0],
  )))?.includes('forbidden'), 'customers cannot read the admin loyalty tracker')
  const adjustedBalance = (await as(adminU,
    'select public.admin_adjust_loyalty_points($1, $2, $3) balance',
    [loyaltyCustomer, 25, 'Guest service recovery'],
  ))[0].balance
  ok(adjustedBalance === 30 && (await admin(
    "select 1 from public.loyalty_point_ledger where customer_id = $1 and entry_type = 'adjustment' and points = 25 and details ->> 'created_by' = $2 and details ->> 'reason' = $3",
    [loyaltyCustomer, adminU, 'Guest service recovery'],
  )).length === 1, 'admins can add audited points to a customer balance')
  const adminAccountBalanceBefore = Number((await admin(
    'select coalesce(sum(points), 0)::int balance from public.loyalty_point_ledger where customer_id = $1',
    [adminU],
  ))[0].balance)
  const adminAccountBalanceAfter = (await as(adminU,
    'select public.admin_adjust_loyalty_points($1, $2, $3) balance',
    [adminU, 7, 'Admin booking rewards'],
  ))[0].balance
  ok(adminAccountBalanceAfter === adminAccountBalanceBefore + 7,
    'admins can receive admin point adjustments on their own booking accounts')
  ok((await err(as(c1,
    'select public.admin_adjust_loyalty_points($1, $2, $3)',
    [loyaltyCustomer, 25, 'Unauthorized adjustment'],
  )))?.includes('forbidden'), 'customers cannot adjust loyalty points')
  const adminIssuedCoupons = await as(adminU,
    'select * from public.admin_issue_loyalty_coupons($1, $2, $3)',
    [loyaltyCustomer, rewardRoomType, 2],
  )
  const adminCouponCodes = adminIssuedCoupons.map((coupon) => coupon.coupon_code)
  ok(adminCouponCodes.length === 2 && new Set(adminCouponCodes).size === 2
    && (await admin("select count(*)::int n from public.loyalty_coupons where code = any($1::text[]) and issue_source = 'admin' and created_by = $2 and status = 'available'", [adminCouponCodes, adminU]))[0].n === 2
    && (await as(loyaltyCustomer, 'select public.my_loyalty_balance() balance'))[0].balance === adjustedBalance,
  'admins can issue complimentary free-night coupons without deducting customer points')
  const guestClaimCouponCode = `HIB-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`
  await admin(`insert into public.loyalty_coupons
    (code, customer_id, room_type_id, points_cost, issue_source, created_by)
    values ($1, $2, $3, 500, 'admin', $4)`,
  [guestClaimCouponCode, guestOwnerId, rewardRoomType, adminU])
  await as(verifiedGuestId, 'select public.claim_guest_reservations()')
  const claimedCoupon = (await admin(
    'select customer_id from public.loyalty_coupons where code = $1',
    [guestClaimCouponCode],
  ))[0]
  ok(claimedCoupon.customer_id === verifiedGuestId,
    'verified account receives complimentary coupons issued to its anonymous guest profile')
  const adminRecipientCoupons = await as(adminU,
    'select * from public.admin_issue_loyalty_coupons($1, $2, $3)',
    [adminU, rewardRoomType, 1],
  )
  ok(adminRecipientCoupons.length === 1 && (await admin(
    "select 1 from public.loyalty_coupons where code = $1 and customer_id = $2 and issue_source = 'admin'",
    [adminRecipientCoupons[0].coupon_code, adminU],
  )).length === 1, 'admins can receive complimentary coupons for their own booking accounts')
  ok((await err(as(c1,
    'select * from public.admin_issue_loyalty_coupons($1, $2, 1)',
    [loyaltyCustomer, rewardRoomType],
  )))?.includes('forbidden'), 'customers cannot issue loyalty coupons')

  ok((await err(as(c1,
    'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 2, 0)',
    [T1, d9, '12:30'],
  )))?.includes('invalid_time'), 'restaurant booking rejects off-hour times')
  ok((await err(as(c1,
    'select public.add_restaurant_dates_to_room_cart($1, $2, null, $3::date[], $4::time[], 1, 0)',
    [bookingEnt, T1, [d6, d7], ['12:00', '13:00']],
  )))?.includes('guest_count_mismatch'), 'room-linked dining uses the room booking guest counts')
  ok((await err(as(c1,
    'select public.add_restaurant_to_room_cart($1, $2, null, $3::date, $4::time, 2, 0)',
    [bookingEnt, T1, d6, '12:00'],
  )))?.includes('guest_count_mismatch'), 'single-date room-linked dining cannot bypass the fixed guest counts')
  ok((await err(as(c1,
    'select public.add_restaurant_to_room_cart($1, $2, null, $3::date, $4::time, 2, 1)',
    [bookingEnt, T1, d8, '12:00'],
  )))?.includes('date_outside_room_stay'), 'room-linked dining cannot be booked outside the stay')
  let attachedDiningIds = (await as(c1,
    'select public.add_restaurant_dates_to_room_cart($1, $2, null, $3::date[], $4::time[], 2, 1) ids',
    [bookingEnt, T1, [d6, d7], ['12:00', '13:00']],
  ))[0].ids
  let attachedDining = attachedDiningIds[0]
  ok(attachedDiningIds.length === 2, 'one room-linked request books each selected dining date')
  ok((await admin('select 1 from public.entitlements where id = $1 and parent_entitlement_id = $2', [attachedDining, bookingEnt])).length === 1,
    'restaurant booking is attached to the selected room')
  ok((await admin('select count(*)::int n from public.entitlements where id = any($1::uuid[]) and parent_entitlement_id = $2', [attachedDiningIds, bookingEnt]))[0].n === 2,
    'each selected dining date is attached to the same room')
  ok((await admin(
    `select count(*)::int n from public.entitlements dining
       join public.entitlements room on room.id = dining.parent_entitlement_id
      where dining.id = any($1::uuid[]) and dining.hold_expires_at = room.hold_expires_at`,
    [attachedDiningIds],
  ))[0].n === 2, 'room-linked dining holds expire with the room hold')
  ok((await err(as(c1,
    'select public.add_restaurant_dates_to_room_cart($1, $2, null, $3::date[], $4::time[], 2, 1)',
    [bookingEnt, T1, [d6, d7], ['12:00', '13:00']],
  )))?.includes('dining_already_set_up')
    && (await admin('select count(*)::int n from public.entitlements where parent_entitlement_id = $1 and service_type = $2', [bookingEnt, 'restaurant']))[0].n === 2,
    'a second dining setup cannot duplicate dates already configured for the room')
  await as(c1, 'select public.begin_restaurant_edit_for_room_cart($1)', [bookingEnt])
  ok((await admin('select 1 from public.entitlements where parent_entitlement_id = $1 and service_type = $2', [bookingEnt, 'restaurant'])).length === 0,
    'opening dining edit releases the old table holds')
  const editAvailability = (await as(c1,
    'select taken from public.restaurant_availability($1::date, $2::time) where table_id = $3',
    [d6, '12:00', T1],
  ))[0]
  ok(editAvailability && !editAvailability.taken, 'released dining table is selectable while editing')
  attachedDiningIds = (await as(c1,
    'select public.update_restaurant_dates_for_room_cart($1, $2, null, $3::date[], $4::time[], 2, 1) ids',
    [bookingEnt, T1, [d6, d7], ['12:00', '13:00']],
  ))[0].ids
  attachedDining = attachedDiningIds[0]
  const earlyState = (await admin(
    `select room.starts_at, room.eligible_from, room.meta,
            dining.ends_at, public.local_ts($2::date, settings.checkin_time) standard_checkin
       from public.entitlements room
       join public.entitlements dining on dining.id = $3
       cross join public.settings settings
      where room.id = $1 and settings.id = 1`,
    [bookingEnt, d6, attachedDining],
  ))[0]
  ok(earlyState.meta.early_checkin_guaranteed === true
    && Date.parse(earlyState.meta.early_checkin_at) === Date.parse(earlyState.ends_at)
    && Date.parse(earlyState.starts_at) === Date.parse(earlyState.ends_at)
    && Date.parse(earlyState.starts_at) < Date.parse(earlyState.standard_checkin),
    'arrival-day dining guarantees room access immediately after the meal')
  ok((await admin("select 1 from public.audit_log where action = 'early_checkin.guaranteed' and entity_id = $1", [bookingEnt])).length === 2,
    'early check-in guarantee is audited again after dining is edited')
  ok((await err(as(c2,
    'select public.add_restaurant_to_room_cart($1, $2, null, $3::date, $4::time, 2, 0)',
    [bookingEnt, T1, d7, '12:00'],
  )))?.includes('room_not_in_cart'), 'service booking cannot be attached to another guest’s room')
  for (const id of attachedDiningIds) await as(c1, 'select public.remove_cart_item($1)', [id])
  const restoredRoom = (await admin(
    `select room.starts_at, room.eligible_from, room.meta,
            public.local_ts($2::date, settings.checkin_time) standard_checkin
       from public.entitlements room cross join public.settings settings
      where room.id = $1 and settings.id = 1`,
    [bookingEnt, d6],
  ))[0]
  ok(restoredRoom.meta.early_checkin_guaranteed !== true
    && Date.parse(restoredRoom.starts_at) === Date.parse(restoredRoom.standard_checkin)
    && Date.parse(restoredRoom.eligible_from) === Date.parse(restoredRoom.standard_checkin),
    'removing arrival-day dining restores standard check-in')
  ok((await admin("select 1 from public.audit_log where action = 'early_checkin.reset' and entity_id = $1", [bookingEnt])).length === 2,
    'dining edits and removal audit each early check-in reset')
  const editedDiningIds = (await as(c1,
    'select public.update_restaurant_dates_for_room_cart($1, $2, null, $3::date[], $4::time[], 2, 1) ids',
    [bookingEnt, T1, [d7], ['14:00']],
  ))[0].ids
  ok(editedDiningIds.length === 1
    && (await admin('select count(*)::int n from public.entitlements where parent_entitlement_id = $1 and service_type = $2', [bookingEnt, 'restaurant']))[0].n === 1
    && (await admin('select (starts_at at time zone public.hotel_tz())::time::text t from public.entitlements where id = $1', [editedDiningIds[0]]))[0].t.startsWith('14:00'),
    'editing room dining replaces its previous holds with the selected dates and times')
  await as(c1,
    'select public.update_restaurant_dates_for_room_cart($1, null, null, $2::date[], $3::time[], 2, 1)',
    [bookingEnt, [], []],
  )
  ok((await admin('select 1 from public.entitlements where parent_entitlement_id = $1 and service_type = $2', [bookingEnt, 'restaurant'])).length === 0
    && (await admin('select 1 from public.cart_service_interests where reservation_id = $1 and hotel_entitlement_id = $2 and service_type = $3', [bookingReservation.id, bookingEnt, 'restaurant'])).length === 0,
    'removing every dining date clears the dining setup for that room')
  const expiringDining = (await as(c1,
    'select public.add_restaurant_to_room_cart($1, $2, null, $3::date, $4::time, 2, 1) id',
    [bookingEnt, T1, d6, '12:00'],
  ))[0].id
  await admin("update public.entitlements set hold_expires_at = now() - interval '1 minute' where id = $1", [expiringDining])
  await admin('select public.release_expired_holds()')
  const expiredRoom = (await admin('select starts_at, meta from public.entitlements where id = $1', [bookingEnt]))[0]
  ok(expiredRoom.meta.early_checkin_guaranteed !== true,
    'expired dining hold removes its early check-in guarantee')
  ok((await err(as(c1, "select public.set_cart_service_interest('invalid', true)")))?.includes('invalid_service_interest'),
    'service interest RPC rejects invalid service types')

  console.log('\nHold expiry / abandoned checkout')
  await admin("update public.entitlements set hold_expires_at = now() - interval '1 minute' where status = 'held'")
  const avail = await as(c2, 'select * from public.room_type_availability($1::date, $2::date)', [d6, d8])
  ok(avail.find((a) => a.room_type_id === SUITE).rooms_available === 1, 'expired hold no longer blocks availability')
  rs = await Promise.allSettled([as(customers[3], 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 0)', [SUITE, d6, d8])])
  ok(rpcMsgs(rs)[0] === 'OK', 'room can be booked after hold expired')
  ok((await admin("select 1 from public.entitlements e join public.reservations r on r.id = e.reservation_id where r.status = 'cart' and e.status = 'expired'")).length === 0,
    'expired entitlements are removed from carts after releasing their resources')
  await as(c1, 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 0)', [SUITE, d8, d10])
  const retriedCheckout = (await as(c1, "select public.checkout_cart('A','B','a@b.co','5551234','cash_on_arrival') r"))[0].r
  ok(retriedCheckout.status === 'confirmed', 'checkout succeeds after a guest re-adds items following hold expiry')

  console.log('\nCombined reservation: one QR pass, independent entitlements')
  const G = randomUUID()
  await admin("insert into auth.users (id, email) values ($1, 'guest@example.com')", [G])
  await as(G, 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 1)', ['00000000-0000-4000-8000-000000000201', d5, d6])
  await as(G, 'select public.add_restaurant_to_cart($1, null, $2::date, $3::time, 3, 0, $4::jsonb)', ['00000000-0000-4000-8000-000000000502', d5, '12:00', JSON.stringify([{ product_id: (await admin("select id from public.menu_products limit 1"))[0].id, qty: 2 }])])
  const slot2 = (await admin("select public.local_ts((current_date + 5), '15:00') s"))[0].s
  await as(G, 'select public.add_spa_to_cart($1, $2::timestamptz, 1, 0)', [MASSAGE, slot2])
  ok((await err(as(G, "select public.checkout_cart('Gu','Est','guest@example.com','555 1234','card')")))?.includes('card_payment_requires_server'),
    'direct guest card checkout is rejected and requires server-side authorization')
  await admin("update public.settings set payment_methods = jsonb_set(payment_methods, '{dev_test,enabled}', 'false')")
  ok((await err(as(G, "select public.checkout_cart('Gu','Est','guest@example.com','555 1234','dev_test')")))?.includes('payment_method_unavailable'), 'dev test payment unavailable unless explicitly enabled')
  ok((await err(as(G, "select public.checkout_cart('','Est','bad','1','cash_on_arrival')")))?.includes('invalid_details'), 'checkout validates guest details')
  const res = (await as(G, "select public.checkout_cart('Gu','Est','guest@example.com','555 1234','cash_on_arrival') r"))[0].r
  ok(res.status === 'confirmed', 'cash on arrival confirms reservation', JSON.stringify(res))
  const restaurantBookings = await as(staffRest,
    'select * from public.restaurant_reservations($1::date, $2::time, $3::time)',
    [d5, '12:00', '12:00'],
  )
  ok(restaurantBookings.some((booking) => booking.reference === res.reference
    && booking.table_label === 'Q-02' && booking.party_size === 3),
  'restaurant reservation list filters by date and time and includes assigned table')
  const codeFilteredBookings = await as(staffRest,
    'select * from public.restaurant_reservations($1::date, $2::time, $3::time, $4)',
    [d5, '12:00', '12:00', res.reference],
  )
  ok(codeFilteredBookings.length === 1 && codeFilteredBookings[0].reference === res.reference,
    'restaurant reservation list filters by reservation code')
  ok((await err(as(staffHotel,
    'select * from public.restaurant_reservations($1::date)',
    [d5],
  )))?.includes('forbidden'), 'non-restaurant staff cannot access the restaurant reservation list')
  const passes = await admin('select * from public.qr_passes where reservation_id = $1', [res.reservation_id])
  ok(passes.length === 1 && /^[0-9a-f]{64}$/.test(passes[0].token), 'exactly one opaque 64-hex QR pass issued')
  ok(!passes[0].token.includes('guest') && !passes[0].token.includes('Gu'), 'token contains no personal data')
  const pay = (await admin('select * from public.payments where reservation_id = $1', [res.reservation_id]))[0]
  ok(pay.status === 'unpaid' && pay.method === 'cash_on_arrival', 'payment status is separate (unpaid, due on arrival) from confirmed booking')
  const ents = await admin('select * from public.entitlements where reservation_id = $1 order by service_type', [res.reservation_id])
  ok(ents.length === 3, 'one pass covers 3 service entitlements (hotel, restaurant, spa)')
  const tot = (await admin('select subtotal, tax, fees, total from public.reservations where id = $1', [res.reservation_id]))[0]
  ok(Number(tot.total) > Number(tot.subtotal) && Number(tot.tax) > 0, 'taxes and fees applied', JSON.stringify(tot))

  console.log('\nLocal test card gateway')
  const cardGuest = await mk('customer')
  await as(cardGuest, 'select public.add_event_to_cart($1, 1, 0)', [demoEvent.id])
  await admin("update public.profiles set role = 'staff' where id = $1", [cardGuest])
  ok((await err(as(cardGuest,
    "select public.checkout_cart_test_card($1, 'Card', 'Guest', 'card@example.test', '5551234', '')",
    [cardGuest],
  )))?.includes('permission denied'),
  'authenticated guests cannot call the server-only card checkout function')
  const cardCheckout = (await asService(
    "select public.checkout_cart_test_card($1, 'Card', 'Guest', 'card@example.test', '5551234', '') r",
    [cardGuest],
  ))[0].r
  const cardPayment = (await admin(
    'select method, status, note from public.payments where reservation_id = $1',
    [cardCheckout.reservation_id],
  ))[0]
  ok(cardCheckout.status === 'confirmed' && cardCheckout.payment_status === 'paid'
    && cardPayment.method === 'card' && cardPayment.status === 'paid'
    && cardPayment.note.includes('LOCAL TEST GATEWAY')
    && !cardPayment.note.includes('card@example.test'),
  'server-authorized test card checkout accepts an authenticated cart owner regardless of profile role and records no card details')

  const token = passes[0].token
  const referenceScan = (await as(staffRest, "select public.scan_pass($1, 'restaurant') r", [res.reference]))[0].r
  ok(['valid', 'not_yet_eligible'].includes(referenceScan.state) && referenceScan.reservation.reference === res.reference
    && referenceScan.reservation.id === res.reservation_id
    && referenceScan.reservation.payment_status === 'unpaid' && referenceScan.entitlements.length === 1
    && Boolean(referenceScan.entitlements[0].eligible_from),
  'booking reference lookup returns the reservation id, service details, and payment status')
  // make everything eligible now (test setup only)
  await admin("update public.entitlements set eligible_from = now() - interval '1 hour', eligible_until = now() + interval '1 day' where reservation_id = $1 and service_type <> 'hotel'", [res.reservation_id])

  console.log('\nScanner states & check-in')
  let scan = (await as(staffRest, "select public.scan_pass($1, 'restaurant') r", [token]))[0].r
  ok(scan.state === 'valid' && scan.entitlements.length === 1 && scan.entitlements[0].meta.table_label === 'Q-02', 'restaurant scan shows only the restaurant reservation + table', JSON.stringify(scan))
  ok(!JSON.stringify(scan).includes('guest@example.com') && !JSON.stringify(scan).includes('555 1234'), 'scan reveals no email/phone to staff')
  scan = (await as(staffHotel, "select public.scan_pass($1, 'hotel') r", [token]))[0].r
  ok(scan.state === 'not_yet_eligible', 'hotel scan before arrival day => not_yet_eligible', scan.state)
  ok((await as(staffRest, "select public.scan_pass('nope-nope', 'restaurant') r"))[0].r.state === 'unknown', 'unknown token => unknown')
  const restEnt = ents.find((e) => e.service_type === 'restaurant').id
  const spaEnt = ents.find((e) => e.service_type === 'spa').id
  const hotelEnt = ents.find((e) => e.service_type === 'hotel').id

  const cr = await Promise.allSettled(Array.from({ length: 6 }, () => as(staffRest, "select public.check_in($1, $2, 'restaurant') r", [token, restEnt])))
  const results = cr.filter((r) => r.status === 'fulfilled').map((r) => r.value[0].r)
  ok(results.filter((r) => r.ok).length === 1 && results.filter((r) => r.state === 'already_checked_in').length === 5, '6 simultaneous scans: exactly one check-in, 5 already_checked_in', JSON.stringify(results.map((r) => r.state)))
  ok((await admin("select 1 from public.checkins where entitlement_id = $1", [restEnt])).length === 1, 'single check-in row')
  ok((await admin("select 1 from public.audit_log where action = 'checkin' and entity_id = $1", [restEnt])).length === 1, 'check-in produced exactly one audit record')
  const after = await admin('select service_type, checked_in_at from public.entitlements where reservation_id = $1', [res.reservation_id])
  ok(after.filter((e) => e.checked_in_at).length === 1 && after.find((e) => e.checked_in_at).service_type === 'restaurant', 'only restaurant entitlement used; hotel & spa untouched')
  ok((await err(as(staffRest, "select public.check_in($1, $2, 'restaurant')", [token, spaEnt])))=== null, 'check-in with wrong service id does not throw')
  ok((await admin('select checked_in_at from public.entitlements where id = $1', [spaEnt]))[0].checked_in_at === null, 'restaurant staff cannot check in a spa entitlement')
  const hs = (await as(staffHotel, "select public.check_in($1, $2, 'hotel') r", [token, hotelEnt]))[0].r
  ok(hs.ok === false && hs.state === 'not_yet_eligible', 'hotel check-in denied before eligibility and audited', JSON.stringify(hs))
  const sp = (await as(staffSpa, "select public.check_in($1, $2, 'spa') r", [res.reference, spaEnt]))[0].r
  ok(sp.ok === true, 'spa staff checks in the spa entitlement independently using its booking reference')
  ok((await admin("select count(*)::int n from public.audit_log where action = 'checkin'"))[0].n === 3, 'each service check-in, including gym, is audited')

  console.log('\nCancel / refund / reissue / revoke')
  const newTok = (await as(G, 'select public.reissue_pass($1) t', [res.reservation_id]))[0].t
  ok(newTok !== token, 'reissue creates a new token')
  ok((await as(staffRest, "select public.scan_pass($1, 'restaurant') r", [token]))[0].r.state === 'revoked', 'old pass is revoked')
  ok((await as(staffRest, "select public.scan_pass($1, 'restaurant') r", [newTok]))[0].r.state === 'already_checked_in', 'new pass keeps check-in state (cannot reuse)')
  await admin("update public.payments set status = 'paid', paid_at = now() where reservation_id = $1", [res.reservation_id])
  await as(adminU, "select public.refund_reservation($1, $2, 'test refund', true)", [res.reservation_id, pay.amount])
  ok((await admin('select status from public.payments where id = $1', [pay.id]))[0].status === 'refunded', 'full refund marks payment refunded')
  const sc2 = (await as(staffSpa, "select public.scan_pass($1, 'spa') r", [newTok]))[0].r
  ok(['revoked', 'refunded'].includes(sc2.state), 'refunded/cancelled pass cannot be used', sc2.state)
  ok((await as(staffHotel, "select public.check_in($1, $2, 'hotel') r", [newTok, hotelEnt]))[0].r.ok === false, 'check-in blocked after refund')
  ok((await admin("select 1 from public.room_stays where status <> 'released' and entitlement_id = $1", [hotelEnt])).length === 0, 'room released after cancellation')

  console.log('\nBank transfer + receipts')
  const B = randomUUID()
  await admin("insert into auth.users (id, email) values ($1, 'b@example.com')", [B])
  await as(B, 'select public.add_event_to_cart($1, 2, 1)', [demoEvent.id])
  const br = (await as(B, "select public.checkout_cart('B','Guest','b@example.com','5551234','bank_transfer') r"))[0].r
  ok(br.status === 'pending' && br.payment_status === 'awaiting_receipt', 'bank transfer stays pending until verified', JSON.stringify(br))
  ok((await admin('select 1 from public.qr_passes where reservation_id = $1', [br.reservation_id])).length === 0, 'no pass before payment is verified')
  ok((await err(as(B, "select public.attach_receipt($1, 'someone-else/x/r.pdf')", [br.reservation_id])))?.includes('forbidden'), 'cannot attach receipt path outside own folder')
  const bp = (await admin('select id from public.payments where reservation_id = $1', [br.reservation_id]))[0]
  await as(B, 'select public.attach_receipt($1, $2, $3)', [br.reservation_id, `${B}/${br.reservation_id}/receipt.pdf`, bp.id])
  const bpStatus = (await admin('select status from public.payments where id = $1', [bp.id]))[0].status
  ok(bpStatus === 'pending_verification', 'receipt upload => pending_verification (not paid)')
  await as(adminU, "select public.admin_set_payment_status($1, 'paid')", [bp.id])
  ok((await admin('select 1 from public.qr_passes where reservation_id = $1 and status = $2', [br.reservation_id, 'active'])).length === 1, 'verifying payment confirms booking and issues pass')
  ok((await err(as(c1, "select public.cancel_my_reservation($1)", [br.reservation_id])))?.includes('invalid_status'), "customers cannot cancel someone else's reservation")
  const cf = (await as(B, "select public.cancel_my_reservation($1, 'changed plans') r", [br.reservation_id]))[0].r
  ok(cf.cancellation_fee !== undefined, 'guest cancellation computes fee by policy', JSON.stringify(cf))
  ok((await admin("select 1 from public.event_bookings where status <> 'released' and entitlement_id in (select id from public.entitlements where reservation_id = $1)", [br.reservation_id])).length === 0, 'event seats released on cancel')

  console.log('\nEvent capacity')
  const ev = demoEvent.id
  rs = await Promise.allSettled(customers.map((u) => as(u, 'select public.add_event_to_cart($1, 8, 0)', [ev])))
  ok(rpcMsgs(rs).filter((m) => m === 'OK').length === 2, 'capacity 20 / 8 per booking => 2 of 6 succeed', JSON.stringify(rpcMsgs(rs)))

  console.log('\nRoom-aligned tour dates')
  const tourStart = await day(20), tourDate = await day(21), tourSecondDate = await day(22)
  const tourCheckout = await day(23), tourAvailableUntil = await day(24)
  const rangeTour = (await admin(`insert into public.events (
    provider_id, title, description, location, capacity, price, child_price, booking_enabled, active,
    available_from, available_until, departure_start, departure_end
  ) values ($1, 'Range tour test', 'Tour available during a date window.', 'Hotel lobby', 4, 35, 20, true, true,
    $2::date, $3::date, '09:00', '12:00') returning id`, [
    '00000000-0000-4000-8000-000000000901', tourDate, tourAvailableUntil,
  ]))[0].id
  const tourGuestA = await mk('customer'), tourGuestB = await mk('customer')
  const roomA = (await as(tourGuestA, 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 1) id',
    ['00000000-0000-4000-8000-000000000201', tourStart, tourCheckout]))[0].id
  const roomB = (await as(tourGuestB, 'select public.add_room_to_cart($1, $2::date, $3::date, 2, 1) id',
    ['00000000-0000-4000-8000-000000000201', tourStart, tourCheckout]))[0].id
  const roomTour = (await as(tourGuestA,
    'select public.add_event_to_room_cart($1, $2, $3::date, 2, 1) id',
    [roomA, rangeTour, tourDate],
  ))[0].id
  const roomTourDetails = (await admin(`select e.parent_entitlement_id, e.total, e.meta ->> 'tour_date' tour_date,
      b.booking_date::text booking_date
    from public.entitlements e join public.event_bookings b on b.entitlement_id = e.id where e.id = $1`, [roomTour]))[0]
  ok(roomTourDetails.parent_entitlement_id === roomA && roomTourDetails.booking_date === tourDate
    && roomTourDetails.tour_date === tourDate && Number(roomTourDetails.total) === 90,
  'tour is attached to its room and priced for the selected departure date')
  ok((await err(as(tourGuestA, 'select public.add_event_to_room_cart($1, $2, $3::date, 1, 0)',
    [roomA, rangeTour, tourStart])))?.includes('event_date_unavailable'),
  'tour cannot be booked before its configured availability window')
  ok((await err(as(tourGuestA, 'select public.add_event_to_room_cart($1, $2, $3::date, 1, 0)',
    [roomA, rangeTour, tourCheckout])))?.includes('event_date_outside_stay'),
  'tour cannot be booked on the room checkout date')
  ok((await err(as(tourGuestA, 'select public.add_event_to_cart($1, 1, 0)', [rangeTour])))?.includes('event_date_required'),
    'date-range tours cannot be booked without a room-stay date')
  ok((await err(as(tourGuestA, 'select public.add_event_to_room_cart($1, $2, $3::date, 3, 0)',
    [roomA, rangeTour, tourDate])))?.includes('event_guest_count_exceeds_room'),
  'tour guests cannot exceed the room reservation')
  ok((await err(as(tourGuestB, 'select public.add_event_to_room_cart($1, $2, $3::date, 2, 0)',
    [roomB, rangeTour, tourDate])))?.includes('event_full'),
  'tour capacity is enforced for the selected departure date')
  ok((await as(tourGuestB, 'select public.add_event_to_room_cart($1, $2, $3::date, 2, 0)',
    [roomB, rangeTour, tourSecondDate])).length === 1,
  'a separate date in the same tour availability window has its own capacity')

  console.log('\nTour bookings on confirmed room reservations')
  const roomTourCheckout = (await as(tourGuestA,
    "select public.checkout_cart('Tour', 'Guest', 'tour@example.com', '5551234', 'bank_transfer') r",
  ))[0].r
  const originalPayment = (await admin(
    'select id from public.payments where reservation_id = $1 order by created_at desc limit 1',
    [roomTourCheckout.reservation_id],
  ))[0]
  await as(adminU, "select public.admin_set_payment_status($1, 'paid')", [originalPayment.id])
  const originalPass = (await admin(
    "select token from public.qr_passes where reservation_id = $1 and status = 'active'",
    [roomTourCheckout.reservation_id],
  ))[0].token
  const directTour = (await as(tourGuestA,
    "select public.book_tour_for_room_stay($1, $2, $3::date, 1, 0, 'bank_transfer') r",
    [roomA, rangeTour, tourSecondDate],
  ))[0].r
  const directPayment = (await admin(
    'select id, entitlement_id, status, amount from public.payments where reservation_id = $1 order by created_at desc limit 1',
    [roomTourCheckout.reservation_id],
  ))[0]
  ok(directTour.reservation_id === roomTourCheckout.reservation_id
    && directTour.payment_status === 'awaiting_receipt'
    && directPayment.entitlement_id === directTour.entitlement_id
    && directPayment.status === 'awaiting_receipt',
  'booking a tour adds a separate bank-transfer charge to the confirmed room reservation')
  const preservedPayment = (await admin('select status from public.payments where id = $1', [originalPayment.id]))[0]
  const preservedPass = (await admin(
    "select token from public.qr_passes where reservation_id = $1 and status = 'active'",
    [roomTourCheckout.reservation_id],
  ))[0].token
  ok(preservedPayment.status === 'paid' && preservedPass === originalPass,
    'adding the tour preserves the paid room transfer and its existing QR pass')
  const scannedTour = (await as(staffEvents,
    "select public.scan_pass($1, 'events') r",
    [originalPass],
  ))[0].r
  const scannedEntitlement = scannedTour.entitlements.find((entitlement) => entitlement.id === directTour.entitlement_id)
  ok(scannedTour.reservation.payment_status === 'paid' && scannedEntitlement.payment_status === 'awaiting_receipt',
    'scanner keeps room payment paid while showing the tour transfer separately')
  ok((await err(as(tourGuestB,
    "select public.book_tour_for_room_stay($1, $2, $3::date, 1, 0, 'cash_on_arrival')",
    [roomA, rangeTour, tourSecondDate],
  )))?.includes('confirmed_room_required'),
  "tour booking cannot be attached to another guest's room")
  ok((await err(as(tourGuestA,
    "select public.book_tour_for_room_stay($1, $2, $3::date, 1, 0, 'cash_on_arrival')",
    [roomA, rangeTour, tourSecondDate],
  )))?.includes('event_already_booked'),
  'a room stay cannot book the same tour departure twice')
  await as(tourGuestA, 'select public.attach_receipt($1, $2, $3)', [
    roomTourCheckout.reservation_id,
    `${tourGuestA}/${roomTourCheckout.reservation_id}/tour-receipt.pdf`,
    directPayment.id,
  ])
  const paymentStatuses = await admin(
    'select id, status from public.payments where reservation_id = $1',
    [roomTourCheckout.reservation_id],
  )
  ok(paymentStatuses.find((payment) => payment.id === originalPayment.id)?.status === 'paid'
    && paymentStatuses.find((payment) => payment.id === directPayment.id)?.status === 'pending_verification',
  'tour receipt upload changes only its own payment record')
  await admin(
    "update public.entitlements set eligible_from = now() - interval '1 minute', eligible_until = now() + interval '1 hour' where id = $1",
    [directTour.entitlement_id],
  )
  const pendingCheckin = (await as(staffEvents,
    "select public.check_in($1, $2, 'events') r",
    [originalPass, directTour.entitlement_id],
  ))[0].r
  ok(!pendingCheckin.ok && pendingCheckin.state === 'payment_pending',
    'bank-transfer tours cannot be checked in until their own payment is verified')
  await as(adminU, "select public.admin_set_payment_status($1, 'paid')", [directPayment.id])
  const paidCheckin = (await as(staffEvents,
    "select public.check_in($1, $2, 'events') r",
    [originalPass, directTour.entitlement_id],
  ))[0].r
  ok(paidCheckin.ok === true, 'tour payment verification enables check-in using the original room QR pass')
  const cashTour = (await admin(`insert into public.events (
    provider_id, title, description, location, capacity, price, child_price, booking_enabled, active,
    available_from, available_until, departure_start, departure_end
  ) values ($1, 'Cash tour test', 'Cash-on-arrival tour test.', 'Hotel lobby', 4, 35, 20, true, true,
    $2::date, $3::date, '09:00', '12:00') returning id`, [
    '00000000-0000-4000-8000-000000000901', tourSecondDate, tourAvailableUntil,
  ]))[0].id
  const cashBooking = (await as(tourGuestA,
    "select public.book_tour_for_room_stay($1, $2, $3::date, 1, 0, 'cash_on_arrival') r",
    [roomA, cashTour, tourSecondDate],
  ))[0].r
  const cashPayment = (await admin(
    'select method, status from public.payments where entitlement_id = $1',
    [cashBooking.entitlement_id],
  ))[0]
  await admin(
    "update public.entitlements set eligible_from = now() - interval '1 minute', eligible_until = now() + interval '1 hour' where id = $1",
    [cashBooking.entitlement_id],
  )
  const cashCheckin = (await as(staffEvents,
    "select public.check_in($1, $2, 'events') r",
    [originalPass, cashBooking.entitlement_id],
  ))[0].r
  ok(cashPayment.method === 'cash_on_arrival' && cashPayment.status === 'unpaid'
    && cashCheckin.ok === true,
  'cash-on-arrival tour charges remain separate and check-in eligible using the same QR pass')

  const cardTour = (await admin(`insert into public.events (
    provider_id, title, description, location, capacity, price, child_price, booking_enabled, active,
    available_from, available_until, departure_start, departure_end
  ) values ($1, 'Card tour test', 'Local test-card tour test.', 'Hotel lobby', 4, 35, 20, true, true,
    $2::date, $3::date, '09:00', '12:00') returning id`, [
    '00000000-0000-4000-8000-000000000901', tourSecondDate, tourAvailableUntil,
  ]))[0].id
  const cardTourBooking = (await asService(
    'select public.book_tour_for_room_stay_test_card($1, $2, $3, $4::date, 1, 0) r',
    [tourGuestA, roomA, cardTour, tourSecondDate],
  ))[0].r
  const cardTourPayment = (await admin(
    'select method, status, note from public.payments where entitlement_id = $1',
    [cardTourBooking.entitlement_id],
  ))[0]
  const cardTourAudit = (await admin(
    "select details from public.audit_log where action = 'tour.booked_for_room' and entity_id = $1",
    [cardTourBooking.entitlement_id],
  ))[0]
  ok(cardTourBooking.payment_status === 'paid'
    && cardTourPayment.method === 'card' && cardTourPayment.status === 'paid'
    && cardTourPayment.note.includes('LOCAL TEST GATEWAY')
    && cardTourAudit.details.payment_method === 'card',
  'server-authorized tour card checkout records its paid method in both payment and audit data')

  console.log('\nAdmin guest deletion')
  const deletionGuestId = randomUUID()
  const deletionOtherGuestId = randomUUID()
  const deletionReservationId = randomUUID()
  const deletionOtherReservationId = randomUUID()
  const deletionEntitlementId = randomUUID()
  const deletionOtherEntitlementId = randomUUID()
  const deletionPaymentId = randomUUID()
  const deletionOtherPaymentId = randomUUID()
  const deletionPassId = randomUUID()
  const deletionRefundId = randomUUID()
  const deletionGuestEmail = `delete-${deletionGuestId}@example.test`
  await admin(`insert into auth.users (id, email, is_anonymous)
    values ($1, $2, false), ($3, $4, false)`,
  [deletionGuestId, deletionGuestEmail, deletionOtherGuestId, `other-${deletionGuestId}@example.test`])
  await admin(`insert into public.reservations (id, customer_id, status, email)
    values ($1, $2, 'confirmed', $3), ($4, $5, 'confirmed', $6)`,
  [deletionReservationId, deletionGuestId, deletionGuestEmail,
    deletionOtherReservationId, deletionOtherGuestId, `other-${deletionGuestId}@example.test`])
  await admin(`insert into public.entitlements (
    id, reservation_id, service_type, title, starts_at, ends_at, eligible_from, eligible_until
  ) values
    ($1, $2, 'hotel', 'Guest deletion stay', now(), now() + interval '1 day', now(), now() + interval '1 day'),
    ($3, $4, 'hotel', 'Other guest stay', now(), now() + interval '1 day', now(), now() + interval '1 day')`,
  [deletionEntitlementId, deletionReservationId, deletionOtherEntitlementId, deletionOtherReservationId])
  await admin(`insert into public.payments (
    id, reservation_id, method, status, amount, currency, verified_by
  ) values
    ($1, $2, 'bank_transfer', 'paid', 100, 'USD', null),
    ($3, $4, 'bank_transfer', 'paid', 50, 'USD', $5)`,
  [deletionPaymentId, deletionReservationId, deletionOtherPaymentId, deletionOtherReservationId, deletionGuestId])
  await admin(`insert into public.refunds (id, payment_id, amount, created_by)
    values ($1, $2, 10, $3)`,
  [deletionRefundId, deletionPaymentId, deletionGuestId])
  await admin(`insert into public.qr_passes (id, reservation_id, token)
    values ($1, $2, $3)`,
  [deletionPassId, deletionReservationId, `guest-delete-${deletionGuestId}-opaque-pass-token`])
  await admin(`insert into public.checkins (entitlement_id, pass_id, staff_id, area)
    values ($1, $2, $3, 'hotel'), ($4, null, $3, 'hotel')`,
  [deletionEntitlementId, deletionPassId, deletionGuestId, deletionOtherEntitlementId])
  await admin(`insert into public.loyalty_point_ledger (
    customer_id, reference_key, entry_type, points, description
  ) values ($1, $2, 'earn', 10, 'Guest deletion test')`,
  [deletionGuestId, `delete-guest-${deletionGuestId}`])
  const deletionRoomTypeId = (await admin(
    'insert into public.room_types (name, base_rate) values ($1, 100) returning id',
    [`Deletion test ${deletionGuestId}`],
  ))[0].id
  const deletionCouponCode = `HIB-${deletionGuestId.replaceAll('-', '').slice(0, 16).toUpperCase()}`
  await admin(`insert into public.loyalty_coupons (code, customer_id, room_type_id, points_cost)
    values ($1, $2, $3, 100)`,
  [deletionCouponCode, deletionGuestId, deletionRoomTypeId])
  const deletionNotificationId = (await admin(`insert into public.notifications (
    reservation_id, kind, to_email, subject, body
  ) values ($1, 'confirmation', $2, 'Guest deletion test', 'Personal notification body')
  returning id`, [deletionReservationId, deletionGuestEmail]))[0].id
  const deletionEventLeadId = (await admin(`insert into public.event_leads (
    name, email, assigned_to
  ) values ('Assigned guest', $1, $2) returning id`, [deletionGuestEmail, deletionGuestId]))[0].id

  ok((await err(as(deletionOtherGuestId,
    'select public.admin_delete_guest_records($1)',
    [deletionGuestId],
  )))?.includes('permission denied'), 'customers cannot invoke the guest-deletion database function')
  ok((await err(admin(
    'select public.admin_delete_guest_records($1)',
    [adminU],
  )))?.includes('guest_account_unavailable'), 'the guest-deletion function refuses non-customer accounts')
  await admin('select public.admin_delete_guest_records($1)', [deletionGuestId])
  const deletedGuestRows = await admin(`select
    (select count(*)::int from public.reservations where customer_id = $1) as reservations,
    (select count(*)::int from public.entitlements where id = $2) as entitlements,
    (select count(*)::int from public.payments where id = $3) as payments,
    (select count(*)::int from public.refunds where id = $4) as refunds,
    (select count(*)::int from public.qr_passes where id = $5) as passes,
    (select count(*)::int from public.checkins where staff_id = $1 or entitlement_id = $2) as checkins,
    (select count(*)::int from public.loyalty_point_ledger where customer_id = $1) as points,
    (select count(*)::int from public.loyalty_coupons where customer_id = $1) as coupons,
    (select count(*)::int from public.notifications where id = $6) as notifications,
    (select count(*)::int from public.audit_log where actor_id = $1) as audit_as_actor`,
  [deletionGuestId, deletionEntitlementId, deletionPaymentId, deletionRefundId, deletionPassId, deletionNotificationId])
  ok(Object.values(deletedGuestRows[0]).every((count) => count === 0),
    'guest reservations, payment/refund history, passes, check-ins, loyalty, notifications and actor audit data are removed')
  const preservedOtherGuestPayment = (await admin(
    'select verified_by from public.payments where id = $1',
    [deletionOtherPaymentId],
  ))[0]
  const preservedOtherGuestEntitlement = (await admin(
    'select checked_in_by from public.entitlements where id = $1',
    [deletionOtherEntitlementId],
  ))[0]
  const preservedEventLead = (await admin(
    'select assigned_to from public.event_leads where id = $1',
    [deletionEventLeadId],
  ))[0]
  ok(preservedOtherGuestPayment?.verified_by === null
    && preservedOtherGuestEntitlement?.checked_in_by === null
    && preservedEventLead?.assigned_to === null,
  'other guests’ records are kept while references to the deleted guest are removed')
  ok((await admin(
    "select 1 from public.audit_log where (entity_type = 'event_leads' and entity_id = $1) or (entity_type = 'payments' and entity_id = $2)",
    [deletionEventLeadId, deletionOtherPaymentId],
  )).length === 0, 'audit snapshots containing the deleted guest reference are removed')
  ok((await admin('select 1 from public.profiles where id = $1 and role = $2', [deletionGuestId, 'customer'])).length === 1,
    'the database cleanup leaves account deletion to Supabase Auth')
  await admin('delete from auth.users where id = $1', [deletionGuestId])
  await admin("delete from public.audit_log where entity_type = 'profiles' and entity_id = $1", [deletionGuestId])
  ok((await admin('select 1 from public.profiles where id = $1', [deletionGuestId])).length === 0
    && (await admin('select 1 from auth.users where id = $1', [deletionGuestId])).length === 0,
  'the guest profile and Auth user can be deleted after linked data cleanup')

  console.log('\nAdmin and staff account deletion')
  const deletionAdminId = randomUUID()
  const deletionAdminReservationId = randomUUID()
  const deletionAdminEntitlementId = randomUUID()
  const deletionAdminPaymentId = randomUUID()
  const deletionAdminNotificationId = randomUUID()
  await admin('insert into auth.users (id, email, is_anonymous) values ($1, $2, false)',
    [deletionAdminId, `delete-admin-${deletionAdminId}@example.test`])
  await admin("update public.profiles set role = 'admin' where id = $1", [deletionAdminId])
  await admin(`insert into public.reservations (id, customer_id, status, email)
    values ($1, $2, 'confirmed', $3)`,
  [deletionAdminReservationId, deletionAdminId, `delete-admin-${deletionAdminId}@example.test`])
  await admin(`insert into public.entitlements (
    id, reservation_id, service_type, title, starts_at, ends_at, eligible_from, eligible_until
  ) values ($1, $2, 'hotel', 'Admin deletion stay', now(), now() + interval '1 day', now(), now() + interval '1 day')`,
  [deletionAdminEntitlementId, deletionAdminReservationId])
  await admin(`insert into public.payments (
    id, reservation_id, method, status, amount, currency
  ) values ($1, $2, 'bank_transfer', 'paid', 100, 'USD')`,
  [deletionAdminPaymentId, deletionAdminReservationId])
  await admin('insert into public.checkins (entitlement_id, staff_id, area) values ($1, $2, $3)',
    [deletionAdminEntitlementId, deletionAdminId, 'hotel'])
  await admin(`insert into public.notifications (id, reservation_id, kind, to_email, subject, body)
    values ($1, $2, 'confirmation', $3, 'Admin deletion test', 'Personal notification body')`,
  [deletionAdminNotificationId, deletionAdminReservationId, `delete-admin-${deletionAdminId}@example.test`])
  await admin(`insert into public.loyalty_point_ledger (
    customer_id, reference_key, entry_type, points, description
  ) values ($1, $2, 'earn', 10, 'Admin deletion test')`,
  [deletionAdminId, `delete-admin-${deletionAdminId}`])
  await admin(`insert into public.loyalty_coupons (code, customer_id, room_type_id, points_cost)
    values ($1, $2, $3, 100)`,
  [`HIB-${deletionAdminId.replaceAll('-', '').slice(0, 16).toUpperCase()}`, deletionAdminId, deletionRoomTypeId])
  await admin('update public.payments set verified_by = $1 where id = $2',
    [deletionAdminId, deletionOtherPaymentId])
  await admin('update public.event_leads set assigned_to = $1 where id = $2',
    [deletionAdminId, deletionEventLeadId])

  ok((await err(as(deletionOtherGuestId,
    'select public.admin_delete_account_records($1)',
    [deletionAdminId],
  )))?.includes('permission denied'), 'customers cannot invoke the account-deletion database function')
  await asService('select public.admin_delete_account_records($1)', [deletionAdminId])
  const deletedAdminRows = await admin(`select
    (select count(*)::int from public.reservations where id = $1) as reservations,
    (select count(*)::int from public.entitlements where id = $2) as entitlements,
    (select count(*)::int from public.payments where id = $3) as payments,
    (select count(*)::int from public.checkins where staff_id = $4) as checkins,
    (select count(*)::int from public.loyalty_point_ledger where customer_id = $4) as points,
    (select count(*)::int from public.loyalty_coupons where customer_id = $4) as coupons,
    (select count(*)::int from public.notifications where id = $5) as notifications`,
  [deletionAdminReservationId, deletionAdminEntitlementId, deletionAdminPaymentId, deletionAdminId, deletionAdminNotificationId])
  ok(Object.values(deletedAdminRows[0]).every((count) => count === 0),
    'admin reservations, payment records, check-ins, loyalty data and notifications are removed')
  const clearedAdminReferences = await admin(`select
    (select verified_by from public.payments where id = $1) as verifier,
    (select assigned_to from public.event_leads where id = $2) as assignee`,
  [deletionOtherPaymentId, deletionEventLeadId])
  ok(clearedAdminReferences[0].verifier === null && clearedAdminReferences[0].assignee === null,
    'other customers’ records remain while references to the deleted admin are cleared')
  await admin('delete from auth.users where id = $1', [deletionAdminId])
  await admin("delete from public.audit_log where entity_type = 'profiles' and entity_id = $1", [deletionAdminId])
  ok((await admin('select 1 from public.profiles where id = $1', [deletionAdminId])).length === 0,
    'an admin profile can be deleted after linked data cleanup')

  console.log('\nCancelled reservation deletion')
  const cancelledDeleteReservationId = randomUUID()
  const cancelledDeleteEntitlementId = randomUUID()
  const cancelledDeletePaymentId = randomUUID()
  const cancelledDeletePassId = randomUUID()
  const cancelledDeleteNotificationId = randomUUID()
  await admin(`insert into public.reservations (id, customer_id, status, email)
    values ($1, $2, 'cancelled', $3)`,
  [cancelledDeleteReservationId, deletionOtherGuestId, `other-${deletionGuestId}@example.test`])
  await admin(`insert into public.entitlements (
    id, reservation_id, service_type, title, starts_at, ends_at, eligible_from, eligible_until
  ) values ($1, $2, 'hotel', 'Cancelled deletion test', now(), now() + interval '1 day', now(), now() + interval '1 day')`,
  [cancelledDeleteEntitlementId, cancelledDeleteReservationId])
  await admin(`insert into public.payments (id, reservation_id, method, status, amount, currency)
    values ($1, $2, 'bank_transfer', 'paid', 100, 'USD')`,
  [cancelledDeletePaymentId, cancelledDeleteReservationId])
  await admin(`insert into public.refunds (payment_id, amount, reason)
    values ($1, 10, 'Cancelled booking test')`,
  [cancelledDeletePaymentId])
  await admin(`insert into public.qr_passes (id, reservation_id, token)
    values ($1, $2, $3)`,
  [cancelledDeletePassId, cancelledDeleteReservationId, `cancelled-delete-${cancelledDeleteReservationId}-opaque-pass`])
  await admin('insert into public.checkins (entitlement_id, pass_id, staff_id, area) values ($1, $2, $3, $4)',
    [cancelledDeleteEntitlementId, cancelledDeletePassId, adminU, 'hotel'])
  await admin(`insert into public.notifications (id, reservation_id, kind, to_email, subject, body)
    values ($1, $2, 'cancellation', $3, 'Cancelled deletion test', 'Personal notification body')`,
  [cancelledDeleteNotificationId, cancelledDeleteReservationId, `other-${deletionGuestId}@example.test`])
  await admin(`insert into public.loyalty_point_ledger (
    customer_id, reservation_id, reference_key, entry_type, points, description
  ) values ($1, $2, $3, 'reversal', -10, 'Cancelled deletion test')`,
  [deletionOtherGuestId, cancelledDeleteReservationId, `cancelled-delete-${cancelledDeleteReservationId}`])
  await admin(`insert into public.audit_log (action, entity_type, entity_id, details)
    values ('reservations.cancelled', 'reservations', $1, '{}'::jsonb),
           ('payments.refunded', 'payments', $2, '{}'::jsonb),
           ('checkins.create', 'checkins', $3, '{}'::jsonb)`,
  [cancelledDeleteReservationId, cancelledDeletePaymentId, (await admin(
    'select id from public.checkins where entitlement_id = $1', [cancelledDeleteEntitlementId],
  ))[0].id])

  ok((await err(as(deletionOtherGuestId,
    'select public.admin_delete_cancelled_reservation($1)',
    [cancelledDeleteReservationId],
  )))?.includes('forbidden'), 'customers cannot delete cancelled reservations')
  ok((await err(as(adminU,
    'select public.admin_delete_cancelled_reservation($1)',
    [deletionOtherReservationId],
  )))?.includes('reservation_not_cancelled'), 'only cancelled reservations can be permanently deleted')
  await as(adminU, 'select public.admin_delete_cancelled_reservation($1)', [cancelledDeleteReservationId])
  const deletedCancelledRows = await admin(`select
    (select count(*)::int from public.reservations where id = $1) as reservations,
    (select count(*)::int from public.entitlements where id = $2) as entitlements,
    (select count(*)::int from public.payments where id = $3) as payments,
    (select count(*)::int from public.refunds where payment_id = $3) as refunds,
    (select count(*)::int from public.qr_passes where id = $4) as passes,
    (select count(*)::int from public.checkins where entitlement_id = $2) as checkins,
    (select count(*)::int from public.notifications where id = $5) as notifications,
    (select count(*)::int from public.loyalty_point_ledger where reservation_id = $1) as points,
    (select count(*)::int from public.audit_log where entity_id in ($1::text, $3::text)) as audit_rows`,
  [cancelledDeleteReservationId, cancelledDeleteEntitlementId, cancelledDeletePaymentId, cancelledDeletePassId, cancelledDeleteNotificationId])
  ok(Object.values(deletedCancelledRows[0]).every((count) => count === 0),
    'deleting a cancelled reservation removes its booking, payments, refunds, passes, check-ins, notifications, loyalty entries and audit rows',
    JSON.stringify(deletedCancelledRows[0]))

  console.log(`\n${passed} passed, ${failed} failed`)
}

main().catch((e) => { console.error(e); failed++ }).finally(async () => {
  await server.stop().catch(() => {})
  fs.rmSync(dir, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
})
