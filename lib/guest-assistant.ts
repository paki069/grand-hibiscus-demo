import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { money } from '@/lib/format'

export class GuestAssistantContextError extends Error {
  constructor(readonly source: string, message: string) {
    super(message)
    this.name = 'GuestAssistantContextError'
  }
}

export type GuestAssistantResponseStyle = 'trinidadian' | 'standard'
export type GuestAssistantSpeechVoice = 'autumn' | 'diana' | 'hannah'

export interface GuestAssistantSpeechSettings {
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  speechVoice: GuestAssistantSpeechVoice
}

export async function loadGuestAssistantResponseStyle(): Promise<GuestAssistantResponseStyle> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('settings').select('concierge_response_style').eq('id', 1).single()
  if (error) throw new GuestAssistantContextError('hotel settings', error.message)
  if (!data || (data.concierge_response_style !== 'trinidadian' && data.concierge_response_style !== 'standard')) {
    throw new GuestAssistantContextError('hotel settings', 'Petal’s response style is unavailable.')
  }
  return data.concierge_response_style
}

export async function loadGuestAssistantSpeechSettings(): Promise<GuestAssistantSpeechSettings> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('settings')
    .select('concierge_voice_input_enabled, concierge_voice_output_enabled, concierge_speech_voice')
    .eq('id', 1)
    .single()
  if (error) throw new GuestAssistantContextError('hotel settings', error.message)
  const voice = data?.concierge_speech_voice
  if (!data
    || typeof data.concierge_voice_input_enabled !== 'boolean'
    || typeof data.concierge_voice_output_enabled !== 'boolean'
    || (voice !== 'autumn' && voice !== 'diana' && voice !== 'hannah')) {
    throw new GuestAssistantContextError('hotel settings', 'Petal’s speech settings are unavailable.')
  }
  return {
    voiceInputEnabled: data.concierge_voice_input_enabled,
    voiceOutputEnabled: data.concierge_voice_output_enabled,
    speechVoice: voice,
  }
}

const safeText = (value: unknown, limit = 240) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : ''

const safePrice = (value: unknown, currency: string) =>
  value === null || value === undefined ? 'price not listed' : money(Number(value), currency)

export interface GuestTourDetails {
  name: string
  location: string
  dates: string
  departures: string
  adultPrice?: string
  childPrice?: string
}

export interface GuestGymPackage {
  name: string
  description: string
  benefits: string[]
  price: string
  pointsEarned: number
}

export interface GuestLoyaltyGuide {
  currency: string
  room_night_points: number
  room_addon_points: number
  spa_spend_block_amount: number
  spa_spend_block_points: number
  gym_points_per_guest_day: number
  tour_booking_points: number
  room_type_free_night_rewards: { room_type: string; points_per_night: number }[]
  gym_package_rewards: { package: string; points: number }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredNumber(record: Record<string, unknown>, key: string, allowDecimal = false) {
  const value = Number(record[key])
  if (!Number.isFinite(value) || value < 0 || (!allowDecimal && !Number.isSafeInteger(value))) {
    throw new GuestAssistantContextError('loyalty guide', `Invalid ${key} value.`)
  }
  return value
}

export async function loadGuestLoyaltyGuide(): Promise<GuestLoyaltyGuide> {
  const supabase = await createClient()
  const [guideResult, settingsResult] = await Promise.all([
    supabase.rpc('guest_loyalty_guide'),
    supabase.from('settings').select('currency').eq('id', 1).single(),
  ])
  if (guideResult.error) throw new GuestAssistantContextError('loyalty guide', guideResult.error.message)
  if (settingsResult.error) throw new GuestAssistantContextError('hotel settings', settingsResult.error.message)
  if (!isRecord(guideResult.data)) throw new GuestAssistantContextError('loyalty guide', 'The loyalty guide is unavailable.')
  if (!settingsResult.data) throw new GuestAssistantContextError('hotel settings', 'Hotel settings are unavailable.')

  const roomRewards = guideResult.data.room_type_free_night_rewards
  const gymRewards = guideResult.data.gym_package_rewards
  if (!Array.isArray(roomRewards) || !Array.isArray(gymRewards)) {
    throw new GuestAssistantContextError('loyalty guide', 'The reward lists are unavailable.')
  }

  return {
    currency: safeText(settingsResult.data.currency, 3) || 'USD',
    room_night_points: requiredNumber(guideResult.data, 'room_night_points'),
    room_addon_points: requiredNumber(guideResult.data, 'room_addon_points'),
    spa_spend_block_amount: requiredNumber(guideResult.data, 'spa_spend_block_amount', true),
    spa_spend_block_points: requiredNumber(guideResult.data, 'spa_spend_block_points'),
    gym_points_per_guest_day: requiredNumber(guideResult.data, 'gym_points_per_guest_day'),
    tour_booking_points: requiredNumber(guideResult.data, 'tour_booking_points'),
    room_type_free_night_rewards: roomRewards.flatMap((item) => {
      if (!isRecord(item) || typeof item.room_type !== 'string') return []
      const points = Number(item.points_per_night)
      return Number.isSafeInteger(points) && points > 0
        ? [{ room_type: safeText(item.room_type, 100), points_per_night: points }]
        : []
    }).slice(0, 20),
    gym_package_rewards: gymRewards.flatMap((item) => {
      if (!isRecord(item) || typeof item.package !== 'string') return []
      const points = Number(item.points)
      return Number.isSafeInteger(points) && points >= 0
        ? [{ package: safeText(item.package, 100), points }]
        : []
    }).slice(0, 20),
  }
}

function hotelDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium', timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(`2000-01-01T${value.slice(0, 5)}:00Z`))
}

export async function loadBookableGuestTours(includePrices = false): Promise<GuestTourDetails[]> {
  const supabase = await createClient()
  const [settingsResult, toursResult] = await Promise.all([
    supabase.from('settings').select('currency, timezone').eq('id', 1).single(),
    supabase.from('public_events')
      .select('title, location, price, child_price, booking_enabled, available_from, available_until, departure_start, departure_end')
      .eq('booking_enabled', true)
      .order('sort_order')
      .order('title')
      .limit(32),
  ])
  if (settingsResult.error) throw new GuestAssistantContextError('hotel settings', settingsResult.error.message)
  if (toursResult.error) throw new GuestAssistantContextError('tour catalog', toursResult.error.message)
  if (!settingsResult.data) throw new GuestAssistantContextError('hotel settings', 'Hotel settings are unavailable.')

  let today: string
  try {
    today = hotelDate(new Date(), settingsResult.data.timezone)
  } catch {
    throw new GuestAssistantContextError('hotel timezone', 'The hotel timezone is invalid.')
  }
  const currency = settingsResult.data.currency.trim() || 'USD'
  return (toursResult.data ?? [])
    .filter((tour) =>
      Boolean(tour.available_from && tour.available_until && tour.departure_start && tour.departure_end)
      && (tour.available_until ?? '') >= today)
    .map((tour) => ({
      name: safeText(tour.title, 120),
      location: safeText(tour.location, 100),
      dates: `${dateLabel(tour.available_from!)} – ${dateLabel(tour.available_until!)}`,
      departures: `${timeLabel(tour.departure_start!)} – ${timeLabel(tour.departure_end!)}`,
      ...(includePrices ? {
        adultPrice: safePrice(tour.price, currency),
        childPrice: safePrice(tour.child_price ?? tour.price, currency),
      } : {}),
    }))
}

export async function loadGuestGymPackages(): Promise<GuestGymPackage[]> {
  const supabase = await createClient()
  const [settingsResult, packagesResult] = await Promise.all([
    supabase.from('settings').select('currency').eq('id', 1).single(),
    supabase.from('gym_packages')
      .select('title, description, benefits, price, loyalty_points')
      .eq('active', true)
      .order('sort_order')
      .limit(32),
  ])
  if (settingsResult.error) throw new GuestAssistantContextError('hotel settings', settingsResult.error.message)
  if (packagesResult.error) throw new GuestAssistantContextError('gym catalog', packagesResult.error.message)
  if (!settingsResult.data) throw new GuestAssistantContextError('hotel settings', 'Hotel settings are unavailable.')
  const currency = safeText(settingsResult.data.currency, 3) || 'USD'
  return (packagesResult.data ?? []).map((gymPackage) => ({
    name: safeText(gymPackage.title, 100),
    description: safeText(gymPackage.description),
    benefits: Array.isArray(gymPackage.benefits)
      ? gymPackage.benefits.map((benefit) => safeText(benefit, 100)).filter(Boolean).slice(0, 8)
      : [],
    price: safePrice(gymPackage.price, currency),
    pointsEarned: Number(gymPackage.loyalty_points ?? 0),
  }))
}

export async function loadGuestAssistantContext() {
  const supabase = await createClient()
  const [
    settingsResult,
    roomsResult,
    addOnsResult,
    spaResult,
    gymResult,
    toursResult,
    diningResult,
  ] = await Promise.all([
    supabase.from('settings')
      .select('hotel_name, currency, checkin_time, checkout_time, cancellation_policy')
      .eq('id', 1)
      .single(),
    supabase.from('room_types')
      .select('name, description, amenities, base_rate, max_adults, max_children, min_nights, max_nights, loyalty_free_night_points')
      .eq('active', true)
      .order('base_rate')
      .limit(12),
    supabase.from('room_addons')
      .select('name, description, price, kind, pricing')
      .eq('active', true)
      .order('name')
      .limit(16),
    supabase.from('spa_services')
      .select('name, description, duration_min, price')
      .eq('active', true)
      .order('name')
      .limit(16),
    supabase.from('gym_packages')
      .select('title, description, benefits, price, loyalty_points')
      .eq('active', true)
      .order('sort_order')
      .limit(32),
    supabase.from('public_events')
      .select('title, description, location, price, child_price, booking_enabled, available_from, available_until, departure_start, departure_end')
      .order('sort_order')
      .order('title')
      .limit(16),
    supabase.from('menu_products')
      .select('name, description, price')
      .eq('active', true)
      .eq('available', true)
      .order('name')
      .limit(16),
  ])

  const results = [
    ['hotel settings', settingsResult],
    ['room catalog', roomsResult],
    ['room add-ons', addOnsResult],
    ['spa catalog', spaResult],
    ['gym catalog', gymResult],
    ['tour catalog', toursResult],
    ['dining menu', diningResult],
  ] as const
  for (const [source, result] of results) {
    if (result.error) throw new GuestAssistantContextError(source, result.error.message)
  }
  if (!settingsResult.data) throw new GuestAssistantContextError('hotel settings', 'Hotel settings are unavailable.')

  const settings = settingsResult.data
  const currency = settings.currency.trim() || 'USD'

  const textList = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => safeText(item, 80)).filter(Boolean).slice(0, 8) : []

  const context = {
    hotel: {
      name: safeText(settings.hotel_name, 100),
      overview: 'A hotel and restaurant in Piarco, Trinidad and Tobago, offering guest stays, dining, wellness, tours, and event hosting.',
      address: 'Golden Grove Road, Piarco, Trinidad and Tobago.',
      contact_email: 'book@grandhibiscus.com',
      contact_phone: '+1-868-33-GRAND',
      contact_details_note: 'The email and phone are demonstration placeholders and are not verified contact channels.',
      accepted_payment_methods: ['cash', 'bank transfer', 'card'],
      currency,
      check_in_time: safeText(settings.checkin_time, 20),
      check_out_time: safeText(settings.checkout_time, 20),
      cancellation_policy: safeText(settings.cancellation_policy, 500),
      gym_hours: 'Open 24 hours a day.',
      childcare_hours: '9:00 AM to 9:00 PM.',
      hosted_events: 'Hotel-hosted events are inquiries for the team to follow up on, not online purchases or bookings.',
      qr_passes: 'Guests can show their reservation QR pass to hotel staff to verify a booking or eligible service access. Keep the pass private.',
    },
    rooms: (roomsResult.data ?? []).map((room) => ({
      name: safeText(room.name, 100),
      description: safeText(room.description),
      amenities: textList(room.amenities),
      starting_rate: safePrice(room.base_rate, currency),
      max_adults: room.max_adults,
      max_children: room.max_children,
      minimum_nights: room.min_nights,
      maximum_nights: room.max_nights,
      points_per_free_night: room.loyalty_free_night_points,
    })),
    room_add_ons: (addOnsResult.data ?? []).map((item) => ({
      name: safeText(item.name, 100),
      description: safeText(item.description),
      price: safePrice(item.price, currency),
      kind: item.kind,
      pricing: item.pricing,
    })),
    spa_services: (spaResult.data ?? []).map((item) => ({
      name: safeText(item.name, 100),
      description: safeText(item.description),
      duration_minutes: item.duration_min,
      price: safePrice(item.price, currency),
    })),
    gym_packages: (gymResult.data ?? []).map((item) => ({
      name: safeText(item.title, 100),
      description: safeText(item.description),
      benefits: textList(item.benefits),
      price: safePrice(item.price, currency),
      points_earned: item.loyalty_points,
    })),
    tours: (toursResult.data ?? []).map((item) => ({
      name: safeText(item.title, 120),
      description: safeText(item.description, 300),
      location: safeText(item.location, 100),
      adult_price: safePrice(item.price, currency),
      child_price: safePrice(item.child_price ?? item.price, currency),
      bookable_online: item.booking_enabled,
      available_from: item.available_from,
      available_through: item.available_until,
      departure_start: item.departure_start,
      departure_end: item.departure_end,
    })),
    dining_items: (diningResult.data ?? []).map((item) => ({
      name: safeText(item.name, 100),
      description: safeText(item.description),
      price: safePrice(item.price, currency),
    })),
  }

  const serialized = JSON.stringify(context)
  if (serialized.length > 32_000) throw new GuestAssistantContextError('hotel context', 'The public service catalog is too large.')
  return serialized
}

export async function loadCustomerLoyaltyBalance() {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError && userError.name !== 'AuthSessionMissingError') {
    throw new GuestAssistantContextError('guest authentication', userError.message)
  }
  if (!userData.user) return null

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) throw new GuestAssistantContextError('guest profile', profileError.message)
  if (profile?.role !== 'customer') return null

  const { data, error } = await supabase.rpc('my_loyalty_balance')
  if (error) throw new GuestAssistantContextError('customer loyalty balance', error.message)
  const balance = Number(data ?? 0)
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw new GuestAssistantContextError('customer loyalty balance', 'The balance response was invalid.')
  }
  return balance
}
