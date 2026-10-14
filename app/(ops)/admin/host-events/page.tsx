import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { Empty } from '@/components/ui'

const categories: Record<string, string> = {
  personal: 'Personal celebrations',
  cultural: 'Cultural & entertainment events',
  corporate: 'Corporate events',
}

const checkinSystems: Record<string, string> = {
  hotel: 'Hotel check-in system requested',
  own: 'Organizer will use their own system',
  undecided: 'Not decided — discuss with organizer',
  not_needed: 'No check-in system needed',
}

type HostEventInquiry = {
  id: string
  category: string
  event_type: string
  custom_event_type: string | null
  organization_name: string
  contact_name: string
  contact_title: string
  email: string
  phone: string
  website: string
  preferred_date: string
  date_flexible: boolean
  start_time: string | null
  end_time: string | null
  expected_guests: number
  spaces_requested: string[]
  custom_space: string
  request_special_room_rates: boolean
  estimated_room_count: number | null
  checkin_system: string
  details: string
  created_at: string
}

export default async function HostEventInquiriesPage() {
  const supabase = await createClient()
  const [settings, result] = await Promise.all([
    getSettings(),
    supabase.from('host_event_inquiries')
      .select('id, category, event_type, custom_event_type, organization_name, contact_name, contact_title, email, phone, website, preferred_date, date_flexible, start_time, end_time, expected_guests, spaces_requested, custom_space, request_special_room_rates, estimated_room_count, checkin_system, details, created_at')
      .order('created_at', { ascending: false }),
  ])
  if (result.error) throw new Error(`Could not load hosted-event inquiries: ${result.error.message}`)
  const inquiries: HostEventInquiry[] = result.data ?? []

  return (
    <div className="stack">
      <h1>Event inquiries</h1>
      <p className="muted small">Review hosted-event requests and follow up with organizers directly. These submissions are inquiries only; there is no approval or booking workflow.</p>
      {inquiries.length === 0 ? <Empty>No hosted-event inquiries yet.</Empty> : (
        <div className="stack">
          {inquiries.map((inquiry) => (
            <article key={inquiry.id} className="card stack host-event-admin-card">
              <div className="row between">
                <div>
                  <p className="home-eyebrow home-eyebrow-dark" style={{ marginBottom: '.35rem' }}>{categories[inquiry.category] ?? 'Event inquiry'}</p>
                  <h2 style={{ margin: 0 }}>{inquiry.event_type === 'Other' ? inquiry.custom_event_type : inquiry.event_type}</h2>
                  {inquiry.organization_name && <p className="small muted" style={{ margin: '.3rem 0 0' }}>{inquiry.organization_name}</p>}
                </div>
                <div className="small muted">Received {fmtDateTime(inquiry.created_at, settings.timezone)}</div>
              </div>

              <div className="host-event-admin-grid">
                <div><strong>Organizer</strong><div>{inquiry.contact_name}{inquiry.contact_title && ` · ${inquiry.contact_title}`}</div><a href={`mailto:${inquiry.email}`}>{inquiry.email}</a><div><a href={`tel:${inquiry.phone}`}>{inquiry.phone}</a></div>{inquiry.website && <div className="small">{inquiry.website}</div>}</div>
                <div><strong>Preferred date</strong><div>{fmtDate(`${inquiry.preferred_date}T12:00:00Z`, settings.timezone)}{inquiry.date_flexible && ' · flexible'}</div><div>{[inquiry.start_time?.slice(0, 5), inquiry.end_time?.slice(0, 5)].filter(Boolean).join('–') || 'Time not specified'}</div><div>{inquiry.expected_guests.toLocaleString()} expected guests</div></div>
                <div><strong>Requested spaces</strong><div>{inquiry.spaces_requested.filter((space) => space !== 'Other').join(', ') || '—'}</div>{inquiry.custom_space && <div>Other: {inquiry.custom_space}</div>}</div>
                <div><strong>Guest arrangements</strong><div>{inquiry.request_special_room_rates ? `Special attendee rates requested${inquiry.estimated_room_count ? ` · approx. ${inquiry.estimated_room_count} rooms` : ''}` : 'No special room-rate request'}</div><div>{checkinSystems[inquiry.checkin_system] ?? 'Check-in preference not provided'}</div></div>
              </div>
              <div><strong>Event details</strong><p className="host-event-admin-details">{inquiry.details}</p></div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
