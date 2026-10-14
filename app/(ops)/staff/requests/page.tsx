import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Empty, Pill } from '@/components/ui'
import { allowedAreas, requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/data'
import { fmtDateTime } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

interface RoomRequest {
  entitlement_id: string
  reservation_reference: string
  guest_name: string
  room_title: string
  room_number: string | null
  checkin: string
  checkout: string
  reservation_status: string
  request_kind: 'addon' | 'upgrade'
  request_name: string
  request_details: string | null
}

interface ContactInquiry {
  id: string
  name: string
  email: string
  subject: string
  message: string
  created_at: string
}

export default async function StaffRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab: requestedTab }, me] = await Promise.all([
    searchParams,
    requireRole(['admin', 'staff'], '/staff/requests'),
  ])
  if (!allowedAreas(me).includes('hotel')) redirect('/staff')
  if (requestedTab === 'inquiries' && me.role !== 'admin') redirect('/staff/requests')

  const tab = requestedTab === 'inquiries' ? 'inquiries' : requestedTab === 'upgrades' ? 'upgrades' : 'addons'
  const [settings, supabase] = await Promise.all([getSettings(), createClient()])
  let requests: RoomRequest[] = []
  let inquiries: ContactInquiry[] = []
  let error: string | null = null
  let addons: RoomRequest[] = []
  let upgrades: RoomRequest[] = []
  if (tab === 'inquiries') {
    const result = await supabase
      .from('contact_inquiries')
      .select('id, name, email, subject, message, created_at')
      .order('created_at', { ascending: false })
    if (result.error) error = result.error.message
    else inquiries = (result.data ?? []) as ContactInquiry[]
  } else {
    const result = await supabase.rpc('staff_room_requests')
    if (result.error) error = result.error.message
    else requests = (result.data ?? []) as RoomRequest[]
    addons = requests.filter((request) => request.request_kind === 'addon')
    upgrades = requests.filter((request) => request.request_kind === 'upgrade')
  }
  const visibleRequests = tab === 'upgrades' ? upgrades : addons
  const selectedLabel = tab === 'upgrades' ? 'Upgrade' : 'Add-on'

  return (
    <div className="stack">
      <h1>Requests</h1>
      <p className="muted">{tab === 'inquiries' ? 'Messages guests submitted through the Contact form.' : 'Upcoming add-ons and upgrades booked for guest rooms.'}</p>
      <nav className="tabs" aria-label="Request type">
        <Link href="/staff/requests?tab=addons" className={tab === 'addons' ? 'active' : ''} aria-current={tab === 'addons' ? 'page' : undefined}>
          Add-ons{tab !== 'inquiries' ? ` (${addons.length})` : ''}
        </Link>
        <Link href="/staff/requests?tab=upgrades" className={tab === 'upgrades' ? 'active' : ''} aria-current={tab === 'upgrades' ? 'page' : undefined}>
          Upgrades{tab !== 'inquiries' ? ` (${upgrades.length})` : ''}
        </Link>
        {me.role === 'admin' && <Link href="/staff/requests?tab=inquiries" className={tab === 'inquiries' ? 'active' : ''} aria-current={tab === 'inquiries' ? 'page' : undefined}>
          Inquiries{tab === 'inquiries' ? ` (${inquiries.length})` : ''}
        </Link>}
      </nav>
      {error ? <div className="notice bad" role="alert">Could not load {tab === 'inquiries' ? 'contact inquiries' : 'upcoming room requests'}: {error}</div>
        : tab === 'inquiries' ? inquiries.length === 0 ? <Empty>No contact inquiries yet.</Empty>
          : <div className="table-wrap"><table className="data">
            <thead><tr><th>Received</th><th>From</th><th>Subject</th><th>Message</th></tr></thead>
            <tbody>{inquiries.map((inquiry) => (
              <tr key={inquiry.id}>
                <td className="nowrap">{fmtDateTime(inquiry.created_at, settings.timezone)}</td>
                <td><strong>{inquiry.name}</strong><div className="small"><a href={`mailto:${inquiry.email}`}>{inquiry.email}</a></div></td>
                <td>{inquiry.subject}</td>
                <td><details className="inquiry-detail">
                  <summary className="btn secondary sm">View</summary>
                  <div className="inquiry-detail-content"><strong>Message from {inquiry.name}</strong><p>{inquiry.message}</p></div>
                </details></td>
              </tr>
            ))}</tbody>
          </table></div>
          : visibleRequests.length === 0 ? <Empty>No upcoming {tab === 'upgrades' ? 'upgrade' : 'add-on'} requests.</Empty>
            : <div className="table-wrap"><table className="data">
              <thead><tr><th>Guest</th><th>Room</th><th>Stay</th><th>{selectedLabel}</th><th>Booking</th></tr></thead>
              <tbody>{visibleRequests.map((request, index) => (
                <tr key={`${request.entitlement_id}-${request.request_kind}-${index}`}>
                  <td>{request.guest_name}<div className="small muted">{request.reservation_reference}</div></td>
                  <td>{request.room_number ? <><strong>Room {request.room_number}</strong><div className="small muted">{request.room_title}</div></> : request.room_title}</td>
                  <td className="nowrap">{fmtDateTime(request.checkin, settings.timezone)}<div className="small muted">to {fmtDateTime(request.checkout, settings.timezone)}</div></td>
                  <td><strong>{request.request_name}</strong>{request.request_details && <div className="small muted">Details: {request.request_details}</div>}</td>
                  <td><Pill value={request.reservation_status} /></td>
                </tr>
              ))}</tbody>
            </table></div>}
    </div>
  )
}
