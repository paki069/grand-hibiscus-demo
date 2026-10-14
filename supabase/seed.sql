-- ============================================================
-- DEMO / DEVELOPMENT DATA ONLY.  Applied by `supabase db reset` locally.
-- Never run this against production. Everything here is labelled DEMO.
-- ============================================================
update public.settings set
  hotel_name = 'The Grand Hibiscus', timezone = 'America/New_York', currency = 'USD', tax_rate = 8.00, service_fee_rate = 2.00,
  payment_methods = jsonb_set(payment_methods, '{dev_test}', '{"enabled": true, "label": "DEV ONLY – test payment (no money moves)"}');

insert into public.room_categories (id, name, description, sort_order) values
  ('00000000-0000-4000-8000-000000000101', 'Standard', 'DEMO category – comfortable essentials', 1),
  ('00000000-0000-4000-8000-000000000102', 'Suites', 'DEMO category – extra space', 2);

insert into public.room_types (id, category_id, name, description, amenities, max_adults, max_children, max_occupancy, base_rate, min_nights, max_nights, policies) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'DEMO Classic Double', 'Queen bed, city view.', '{WiFi,"Air conditioning",TV}', 2, 1, 3, 140, 1, 14, 'No smoking.'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000101', 'DEMO Twin Room', 'Two single beds.', '{WiFi,TV}', 2, 2, 3, 120, 1, 14, 'No smoking.'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000102', 'DEMO Harbor Suite', 'Separate lounge, harbor view.', '{WiFi,"Air conditioning",Balcony,Minibar}', 3, 2, 4, 280, 2, 14, 'Minimum 2 nights.');

insert into public.rooms (room_type_id, number) values
  ('00000000-0000-4000-8000-000000000201', '101'), ('00000000-0000-4000-8000-000000000201', '102'), ('00000000-0000-4000-8000-000000000201', '103'),
  ('00000000-0000-4000-8000-000000000202', '201'), ('00000000-0000-4000-8000-000000000202', '202'),
  ('00000000-0000-4000-8000-000000000203', '301');

insert into public.room_addons (room_type_id, name, description, kind, price, pricing) values
  (null, 'Breakfast', 'DEMO – buffet breakfast', 'addon', 18, 'per_guest'),
  (null, 'Late checkout', 'DEMO – until 15:00', 'upgrade', 40, 'per_stay'),
  ('00000000-0000-4000-8000-000000000201', 'Upgrade to high floor', 'DEMO – higher floor, better view', 'upgrade', 25, 'per_night');

update public.restaurant_config set open_time = '12:00', close_time = '22:00', slot_minutes = 60, dwell_minutes = 90, deposit_per_guest = 0;
insert into public.menu_categories (id, name, sort_order) values
  ('00000000-0000-4000-8000-000000000301', 'Starters', 1), ('00000000-0000-4000-8000-000000000302', 'Mains', 2);
insert into public.menu_products (category_id, name, description, price) values
  ('00000000-0000-4000-8000-000000000301', 'DEMO Soup of the day', 'Seasonal.', 9),
  ('00000000-0000-4000-8000-000000000302', 'DEMO Grilled sea bass', 'Lemon butter, greens.', 28),
  ('00000000-0000-4000-8000-000000000302', 'DEMO Mushroom risotto', 'Vegetarian.', 22);

insert into public.seating_areas (id, name, width, height) values
  ('00000000-0000-4000-8000-000000000401', 'DEMO Main Dining', 800, 500),
  ('00000000-0000-4000-8000-000000000402', 'DEMO Terrace', 800, 300);
insert into public.seating_tables (id, area_id, label, shape, x, y, w, h, capacity, seat_selectable) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401', 'Q-01', 'round', 60, 60, 90, 90, 4, false),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000401', 'Q-02', 'round', 220, 60, 90, 90, 4, false),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000401', 'VIP-01', 'rect', 380, 60, 160, 80, 8, false),
  ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000401', 'Bar', 'rect', 60, 340, 360, 50, 4, true),
  ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000402', 'D-01', 'round', 80, 80, 90, 90, 2, false);
insert into public.seats (table_id, label, x, y) values
  ('00000000-0000-4000-8000-000000000504', 'B1', 40, 25), ('00000000-0000-4000-8000-000000000504', 'B2', 140, 25),
  ('00000000-0000-4000-8000-000000000504', 'B3', 220, 25), ('00000000-0000-4000-8000-000000000504', 'B4', 320, 25);

insert into public.spa_categories (id, name, sort_order) values
  ('00000000-0000-4000-8000-000000000601', 'Massage', 1), ('00000000-0000-4000-8000-000000000602', 'Facials', 2);
insert into public.spa_services (id, category_id, name, description, duration_min, buffer_min, price, max_guests) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000601', 'DEMO Relaxing Massage', '60 minutes of relaxation.', 60, 15, 90, 1),
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000601', 'DEMO Couples Massage', 'Side by side.', 60, 15, 85, 2),
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000602', 'DEMO Express Facial', '30 minutes.', 30, 10, null, 1);
insert into public.spa_resources (id, name) values
  ('00000000-0000-4000-8000-000000000801', 'DEMO Treatment Room A'), ('00000000-0000-4000-8000-000000000802', 'DEMO Treatment Room B');
insert into public.spa_service_resources (service_id, resource_id)
  select s.id, r.id from public.spa_services s cross join public.spa_resources r;
insert into public.spa_schedules (resource_id, weekday, start_time, end_time, slot_minutes)
  select r.id, d, '10:00', '18:00', 30 from public.spa_resources r cross join generate_series(0, 6) d;

insert into public.event_providers (id, name, contact_name, email, phone) values
  ('00000000-0000-4000-8000-000000000901', 'DEMO Harbor Tours Co.', 'Sam Provider', 'demo-provider@example.com', '+1 555 0100');
insert into public.events (provider_id, title, description, includes, location, starts_at, ends_at, capacity, price, child_price, booking_enabled, active) values
  ('00000000-0000-4000-8000-000000000901', 'DEMO Sunset Harbor Cruise', 'Two-hour evening cruise.', 'Guided harbor cruise and welcome drink.', 'Pier 4', now() + interval '10 days', now() + interval '10 days 2 hours', 20, 45, 25, false, false),
  ('00000000-0000-4000-8000-000000000901', 'DEMO Wine Tasting Night', 'Local wines.', 'A guided tasting of five local wines.', 'Hotel Terrace', now() + interval '20 days', now() + interval '20 days 3 hours', 12, 60, null, false, false);
