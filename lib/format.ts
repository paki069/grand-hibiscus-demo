export interface Settings {
  hotel_name: string
  concierge_response_style: 'trinidadian' | 'standard'
  concierge_voice_input_enabled: boolean
  concierge_voice_output_enabled: boolean
  concierge_speech_voice: 'autumn' | 'diana' | 'hannah'
  currency: string
  timezone: string
  checkin_time: string
  checkout_time: string
  tax_rate: number
  service_fee_rate: number
  hold_minutes: number
  unpaid_expiry_hours: number
  free_cancel_hours: number
  late_cancel_fee_percent: number
  cancellation_policy: string
  booking_policy: string
  payment_methods: Record<string, { enabled: boolean; label?: string; instructions?: string }>
  notification_settings: { confirmation_email: boolean; reminder_email: boolean; reminder_hours_before: number; staff_notify_email: string }
}

export const DEFAULT_TZ = 'UTC'

export const money = (n: number | string | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(Number(n ?? 0))

export const fmtDate = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  iso ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: tz }).format(new Date(iso)) : '—'
export const fmtTime = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  iso ? new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: tz }).format(new Date(iso)) : '—'
export const fmtDateTime = (iso: string | null | undefined, tz = DEFAULT_TZ) =>
  iso ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso)) : '—'

export const todayISO = () => new Date().toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

const ERRORS: Record<string, string> = {
  not_authenticated: 'Please sign in to continue.',
  forbidden: 'You do not have permission to do that.',
  sold_out: 'Sorry, that room was just taken. Try other dates or another room type.',
  slot_taken: 'Sorry, that table or time slot was just taken. Please pick another.',
  dining_already_set_up: 'Dining is already set up for this day. Edit the existing dining booking instead.',
  room_type_unavailable: 'That room type is not available.',
  invalid_dates: 'Please choose valid dates.',
  stay_length_not_allowed: 'That stay length is not allowed for this room type.',
  occupancy_exceeded: 'That many guests do not fit in this room.',
  addon_unavailable: 'One of the selected add-ons is no longer available.',
  invalid_upgrade_selection: 'Your room upgrade selection could not be matched to the rooms in your cart. Refresh and try again.',
  upgrade_unavailable: 'That upgrade is no longer available for this room. Refresh the page and try again.',
  cart_room_not_found: 'A room in your cart could not be found. Refresh the page and try again.',
  cart_not_found: 'Add a room to your cart before applying a coupon.',
  addon_room_type_requires_upgrade: 'Room-type-specific prices are available for upgrades, not regular add-ons.',
  invalid_party: 'Please check the number of guests.',
  gym_package_unavailable: 'That gym package is no longer available. Refresh the page and try again.',
  gym_price_unavailable: 'This gym package is not ready for online purchase. Please contact the hotel.',
  gym_adults_only: 'Gym access is for adults only. Children must stay in supervised childcare.',
  gym_membership_active: 'Your existing gym access already covers these dates.',
  gym_item_in_cart: 'Gym membership is already in your cart.',
  loyalty_invalid_quantity: 'Choose between 1 and 20 free-night coupons.',
  loyalty_reward_unavailable: 'That room type is not currently available for rewards.',
  loyalty_insufficient_points: 'You do not have enough points for that reward.',
  loyalty_coupon_invalid: 'That coupon is invalid, already used, or does not match a room in your cart.',
  loyalty_coupon_duplicate: 'The same coupon code was entered more than once.',
  loyalty_coupon_nights_exceeded: 'You cannot apply more than one free-night coupon per room night.',
  loyalty_coupon_unavailable: 'That coupon has just been used. Refresh your cart and try again.',
  loyalty_admin_adjustment_invalid: 'Enter a positive point amount and a reason of 1 to 250 characters.',
  loyalty_admin_coupon_invalid: 'Choose a customer, room type, and between 1 and 20 coupons.',
  loyalty_admin_search_invalid: 'Search text must be 100 characters or fewer.',
  loyalty_customer_unavailable: 'That customer could not be found.',
  host_event_invalid_submission: 'Please complete the event inquiry form and try again.',
  host_event_invalid_category: 'Choose one of the event categories to continue.',
  host_event_invalid_type: 'Choose an event type from the selected category.',
  host_event_custom_type_required: 'Describe the custom event type you have in mind.',
  host_event_invalid_contact: 'Check the contact name, email, phone, and optional business details.',
  host_event_invalid_date: 'Choose a valid preferred date.',
  host_event_invalid_time_range: 'The end time must be later than the start time.',
  host_event_invalid_guest_count: 'Enter an estimated guest count greater than zero.',
  host_event_invalid_spaces: 'Choose one or more valid hotel spaces.',
  host_event_custom_space_required: 'Describe the other hotel space you would like us to consider.',
  host_event_invalid_room_count: 'Enter a valid estimated room count.',
  host_event_invalid_checkin_system: 'Choose a check-in preference.',
  host_event_invalid_details: 'Add a short description of the event you are planning.',
  invalid_stay: 'The room stay dates are missing or invalid. Refresh your cart and try again.',
  guest_count_mismatch: 'Dining guest counts must match the guests in this room booking.',
  date_outside_room_stay: 'Dining dates must fall within this room stay.',
  invalid_date: 'Please choose a valid date (the restaurant may be closed that day).',
  invalid_time: 'Please choose a valid time.',
  table_unavailable: 'That table is not available.',
  seats_not_selectable: 'Seats cannot be chosen at this table.',
  seats_required: 'Please choose seats at this table.',
  invalid_seats: 'The number of seats must match your party size.',
  party_size_not_allowed: 'Your party size does not fit this table.',
  table_size_mismatch: 'Choose a Duo for 1–2 guests, a Quartet for 3–4, or a VIP table for 5–8.',
  product_unavailable: 'A menu item is no longer available.',
  service_unavailable: 'That service is not available.',
  event_unavailable: 'That event is not open for booking.',
  event_past: 'That event has already started.',
  event_full: 'Not enough places left for that event.',
  event_date_required: 'Choose a tour date that falls within your room stay.',
  event_date_unavailable: 'That tour is not available on the selected date.',
  event_date_outside_stay: 'Tour dates must fall between check-in and checkout.',
  event_guest_count_exceeds_room: 'Tour guest counts cannot exceed the guests in this room booking.',
  event_already_booked: 'This tour is already attached to that room stay on the selected date.',
  confirmed_room_required: 'Choose an upcoming confirmed room reservation from your account.',
  settings_unavailable: 'Tour booking is temporarily unavailable. Please refresh and try again.',
  cart_empty: 'Your cart is empty.',
  cart_items_expired: 'Some items in your cart were held too long and have been released. Remove them and add them again.',
  invalid_time_range: 'The end time must be later than the start time.',
  invalid_details: 'Please enter a first name, last name, valid email and phone number.',
  payment_method_unavailable: 'That payment method is not available.',
  card_not_configured: 'Card payments are not set up on this site.',
  card_payment_requires_server: 'Credit card checkout must be completed through the secure checkout form.',
  invalid_status: 'That action is not allowed in the current status.',
  already_used: 'Part of this reservation has already been used, so it cannot be cancelled online. Please contact us.',
  not_found: 'Not found.',
  nothing_to_refund: 'There is no paid payment to refund.',
  invalid_amount: 'Invalid refund amount.',
}

export function friendlyError(e: unknown): string {
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '')
  if (ERRORS[msg]) return ERRORS[msg]
  if (/row-level security|permission denied/i.test(msg)) return 'You do not have permission to do that.'
  if (/duplicate key|unique/i.test(msg)) return 'That value already exists.'
  if (/foreign key/i.test(msg)) return 'This record is in use by other data and cannot be changed that way. Consider deactivating it instead.'
  if (/events_availability_window_check/.test(msg)) return 'The availability end date must be the same as or later than its start date.'
  if (/events_departure_time_check/.test(msg)) return 'The departure end time must be later than its start time.'
  if (/events_bookable_requires_schedule/.test(msg)) return 'Add an availability date range and departure times before enabling online tour bookings.'
  if (/conflicting key value violates exclusion/i.test(msg)) return 'That overlaps with an existing entry.'
  return msg || 'Something went wrong. Please try again.'
}
