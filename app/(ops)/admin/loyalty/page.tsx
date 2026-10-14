import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { fmtDateTime } from '@/lib/format'
import LoyaltySettingsForm from '@/components/LoyaltySettingsForm'
import { LoyaltyCouponForm, LoyaltyPointAdjustment } from '@/components/LoyaltyAdminActions'

interface LoyaltyPageProps {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; page?: string }>
}

interface LoyaltyCustomerBalance {
  customer_id: string
  email: string | null
  first_name: string
  last_name: string
  phone: string
  points_balance: number
  total_count: number
}

interface LoyaltyAccountOption {
  customer_id: string
  email: string | null
  first_name: string
  last_name: string
  phone: string
  role: 'customer' | 'admin'
}

function pageHref(tab: string, page: number, search: string, status?: string) {
  const params = new URLSearchParams({ tab, page: String(page) })
  if (search) params.set('q', search)
  if (status) params.set('status', status)
  return `/admin/loyalty?${params.toString()}`
}

export default async function LoyaltyPage({ searchParams }: LoyaltyPageProps) {
  const { tab, q, status, page: requestedPage } = await searchParams
  const activeTab = tab === 'coupons' ? 'coupons' : 'customers'
  const search = (q ?? '').trim()
  const pageSize = 100
  const parsedPage = Number.parseInt(requestedPage ?? '1', 10)
  const currentPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const supabase = await createClient()
  const { data: rules, error: rulesError } = await supabase.from('loyalty_settings')
    .select('room_night_points, room_addon_points, spa_spend_block_amount, spa_spend_block_points, gym_points_per_guest_day, tour_booking_points')
    .eq('id', 1)
    .single()
  if (rulesError) throw new Error(`Could not load loyalty settings: ${rulesError.message}`)

  const customerChoicesQuery = supabase.rpc('admin_loyalty_customer_accounts')

  let content
  if (activeTab === 'coupons') {
    const couponQuery = supabase.from('loyalty_coupons')
      .select('id, code, customer_id, room_type_id, points_cost, status, issue_source, created_by, reservation_id, reserved_until, redeemed_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((currentPage - 1) * pageSize, currentPage * pageSize - 1)
    const codeSearch = search.replace(/[%,()]/g, '').toUpperCase()
    if (codeSearch) couponQuery.ilike('code', `%${codeSearch}%`)
    if (status === 'available' || status === 'reserved' || status === 'redeemed') couponQuery.eq('status', status)

    const [{ data: coupons, error: couponError, count: couponCount }, { data: customerChoices, error: customersError }, { data: activeRooms, error: roomsError }] = await Promise.all([
      couponQuery,
      customerChoicesQuery,
      supabase.from('room_types').select('id, name, loyalty_free_night_points').eq('active', true).order('name'),
    ])
    if (couponError) throw new Error(`Could not load loyalty coupons: ${couponError.message}`)
    if (customersError) throw new Error(`Could not load loyalty accounts: ${customersError.message}`)
    if (roomsError) throw new Error(`Could not load room rewards: ${roomsError.message}`)

    const customerIds = [...new Set((coupons ?? []).map((coupon) => coupon.customer_id))]
    const roomIds = [...new Set((coupons ?? []).map((coupon) => coupon.room_type_id))]
    const reservationIds = [...new Set((coupons ?? []).flatMap((coupon) => coupon.reservation_id ? [coupon.reservation_id] : []))]
    const [couponCustomersResult, couponRoomsResult, reservationsResult] = await Promise.all([
      customerIds.length
        ? supabase.from('profiles').select('id, email, first_name, last_name, role').in('id', customerIds)
        : Promise.resolve({ data: [], error: null }),
      roomIds.length
        ? supabase.from('room_types').select('id, name').in('id', roomIds)
        : Promise.resolve({ data: [], error: null }),
      reservationIds.length
        ? supabase.from('reservations').select('id, reference').in('id', reservationIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (couponCustomersResult.error) throw new Error(`Could not load coupon customers: ${couponCustomersResult.error.message}`)
    if (couponRoomsResult.error) throw new Error(`Could not load coupon room types: ${couponRoomsResult.error.message}`)
    if (reservationsResult.error) throw new Error(`Could not load coupon reservations: ${reservationsResult.error.message}`)
    const couponCustomers = new Map((couponCustomersResult.data ?? []).map((customer) => [customer.id, customer]))
    const couponRooms = new Map((couponRoomsResult.data ?? []).map((room) => [room.id, room.name]))
    const reservationRefs = new Map((reservationsResult.data ?? []).map((reservation) => [reservation.id, reservation.reference]))
    const couponCustomersForForm = ((customerChoices ?? []) as LoyaltyAccountOption[]).map((customer) => ({
      id: customer.customer_id,
      name: `${customer.first_name} ${customer.last_name}`.trim() || 'Unnamed account',
      email: customer.email,
      role: customer.role,
    }))

    content = (
      <div className="stack">
        <LoyaltyCouponForm
          customers={couponCustomersForForm}
          roomTypes={activeRooms ?? []}
        />
        <form className="row" action="/admin/loyalty" style={{ alignItems: 'end' }}>
          <input type="hidden" name="tab" value="coupons" />
          <label className="field">Search coupon code
            <input name="q" defaultValue={search} placeholder="HIB-…" />
          </label>
          <label className="field">Status
            <select name="status" defaultValue={status ?? ''}>
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved in cart</option>
              <option value="redeemed">Redeemed</option>
            </select>
          </label>
          <button className="btn secondary">Filter</button>
          <Link className="btn secondary" href="/admin/loyalty?tab=coupons">Clear</Link>
        </form>
        {(coupons ?? []).length === 0 ? <div className="empty">No coupons match this filter.</div> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Coupon</th><th>Guest or admin</th><th>Room type</th><th>Issued</th><th>Status</th><th>Created</th><th>Used</th></tr></thead>
            <tbody>{(coupons ?? []).map((coupon) => {
              const customer = couponCustomers.get(coupon.customer_id)
              const customerName = `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim() || customer?.email || 'Account unavailable'
              return <tr key={coupon.id}>
                <td><strong>{coupon.code}</strong><br /><span className="small muted">{coupon.points_cost.toLocaleString()} point value</span></td>
                <td>{customerName} {customer && <span className="pill">{customer.role === 'admin' ? 'Admin' : 'Guest'}</span>}<br /><span className="small muted">{customer?.email}</span></td>
                <td>{couponRooms.get(coupon.room_type_id) ?? 'Room type unavailable'}</td>
                <td>{coupon.issue_source === 'admin' ? 'Complimentary' : 'Points redemption'}</td>
                <td>{coupon.status === 'reserved' ? 'Reserved in cart' : coupon.status === 'redeemed' ? 'Redeemed' : 'Available'}</td>
                <td>{fmtDateTime(coupon.created_at)}</td>
                <td>{coupon.redeemed_at
                  ? <>{fmtDateTime(coupon.redeemed_at)}{coupon.reservation_id && <><br /><span className="small muted">{reservationRefs.get(coupon.reservation_id) ?? 'Booking'}</span></>}</>
                  : coupon.status === 'reserved' && coupon.reserved_until
                    ? <>In cart until {fmtDateTime(coupon.reserved_until)}{coupon.reservation_id && <><br /><span className="small muted">{reservationRefs.get(coupon.reservation_id) ?? 'Booking hold'}</span></>}</>
                    : '—'}</td>
              </tr>
            })}</tbody>
          </table></div>
        )}
        {(couponCount ?? 0) > pageSize && <div className="row between">
          <span className="small muted">{(couponCount ?? 0).toLocaleString()} coupons · Page {currentPage} of {Math.ceil((couponCount ?? 0) / pageSize)}</span>
          <div className="row">
            {currentPage > 1 && <Link className="btn secondary" href={pageHref('coupons', currentPage - 1, search, status)}>Previous</Link>}
            {currentPage < Math.ceil((couponCount ?? 0) / pageSize) && <Link className="btn secondary" href={pageHref('coupons', currentPage + 1, search, status)}>Next</Link>}
          </div>
        </div>}
      </div>
    )
  } else {
    const customerSearch = search.replace(/[%,()]/g, '')
    const { data: customers, error: customersError } = await supabase.rpc('admin_loyalty_customer_balances', {
      p_search: customerSearch || null,
      p_limit: pageSize,
      p_offset: (currentPage - 1) * pageSize,
    })
    if (customersError) throw new Error(`Could not load loyalty customers: ${customersError.message}`)
    const customerRows: LoyaltyCustomerBalance[] = customers ?? []
    const customerCount = Number(customerRows[0]?.total_count ?? 0)
    const accountIds = customerRows.map((customer) => customer.customer_id)
    const { data: accountProfiles, error: accountProfilesError } = accountIds.length
      ? await supabase.from('profiles').select('id, role').in('id', accountIds)
      : { data: [], error: null }
    if (accountProfilesError) throw new Error(`Could not load loyalty account roles: ${accountProfilesError.message}`)
    const accountRoles = new Map((accountProfiles ?? []).map((profile) => [profile.id, profile.role]))

    content = (
      <div className="stack">
        <form className="row" action="/admin/loyalty" style={{ alignItems: 'end' }}>
          <input type="hidden" name="tab" value="customers" />
          <label className="field">Search guests and admins
            <input name="q" defaultValue={search} maxLength={100} placeholder="Name, email, or phone" />
          </label>
          <button className="btn secondary">Search</button>
          <Link className="btn secondary" href="/admin/loyalty?tab=customers">Clear</Link>
        </form>
        {customerRows.length === 0 ? <div className="empty">No guests or admins found.</div> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Account</th><th>Email</th><th>Phone</th><th className="right">Points balance</th><th>Add points</th></tr></thead>
            <tbody>{customerRows.map((customer) => (
              <tr key={customer.customer_id}>
                <td>{customer.first_name} {customer.last_name} <span className="pill">{accountRoles.get(customer.customer_id) === 'admin' ? 'Admin' : 'Guest'}</span></td>
                <td>{customer.email ?? '—'}</td>
                <td>{customer.phone || '—'}</td>
                <td className="right"><strong>{Number(customer.points_balance).toLocaleString()}</strong></td>
                <td><LoyaltyPointAdjustment customerId={customer.customer_id} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {customerCount > pageSize && <div className="row between">
          <span className="small muted">{customerCount.toLocaleString()} accounts · Page {currentPage} of {Math.ceil(customerCount / pageSize)}</span>
          <div className="row">
            {currentPage > 1 && <Link className="btn secondary" href={pageHref('customers', currentPage - 1, search)}>Previous</Link>}
            {currentPage < Math.ceil(customerCount / pageSize) && <Link className="btn secondary" href={pageHref('customers', currentPage + 1, search)}>Next</Link>}
          </div>
        </div>}
        <details className="card stack">
          <summary><strong>Loyalty earning rules</strong></summary>
          <p className="small muted">These settings control points earned through confirmed bookings. Admin adjustments above are recorded separately.</p>
          <LoyaltySettingsForm initial={rules} />
        </details>
      </div>
    )
  }

  return (
    <div className="stack">
      <h1>Loyalty rewards</h1>
      <p className="muted small">Track guest and admin point balances, issue complimentary free-night coupons, and see when coupon codes are used.</p>
      <div className="tabs" role="tablist" aria-label="Loyalty management">
        <Link href="/admin/loyalty?tab=customers" className={activeTab === 'customers' ? 'active' : ''} role="tab" aria-selected={activeTab === 'customers'}>Guests & admins · points</Link>
        <Link href="/admin/loyalty?tab=coupons" className={activeTab === 'coupons' ? 'active' : ''} role="tab" aria-selected={activeTab === 'coupons'}>Coupons</Link>
      </div>
      {content}
    </div>
  )
}
