'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, fmtDate, money, type Settings } from '@/lib/format'
import { groupRoomUpgrades, RoomUpgradeIcon } from '@/lib/room-upgrades'
import { DetailsFields, detailsValid, type Details } from '@/components/Checkout'

export interface RoomVM {
  id: string; name: string; description: string; photos: string[]; amenities: string[]; category: string | null
  max_adults: number; max_children: number; max_occupancy: number; min_nights: number; max_nights: number; policies: string
  rooms_available: number; total: number
}
export interface AddonVM {
  id: string; room_type_id: string | null; name: string; description: string; kind: string; price: number; pricing: string
  icon?: string | null
}
export interface Search { checkin: string; checkout: string; adults: number; children: number; nights: number }
export interface Profile { first_name: string; last_name: string; email: string; phone: string }
type ExtraInterest = 'restaurant' | 'spa' | 'event' | 'gym'

type RoomParty = { adults: number; children: number }

function planRoomParties(room: RoomVM, search: Search): RoomParty[] | null {
  if (room.max_occupancy < 1 || room.max_adults < 1 || (search.children > 0 && room.max_children < 1)) return null

  const totalGuests = search.adults + search.children
  const minRooms = Math.max(
    1,
    Math.ceil(search.adults / room.max_adults),
    Math.ceil(search.adults / room.max_occupancy),
    Math.ceil(totalGuests / room.max_occupancy),
    search.children > 0 ? Math.ceil(search.children / room.max_children) : 1,
  )

  for (let count = minRooms; count <= Math.min(search.adults, 20); count += 1) {
    let adultsLeft = search.adults
    let childrenLeft = search.children
    const adultsPerRoom: number[] = []

    for (let index = 0; index < count; index += 1) {
      const roomsLeft = count - index
      const adults = Math.ceil(adultsLeft / roomsLeft)
      if (adults < 1 || adults > room.max_adults || adults > room.max_occupancy) break
      adultsLeft -= adults
      adultsPerRoom.push(adults)
    }
    if (adultsPerRoom.length !== count || adultsLeft !== 0) continue

    const childrenPerRoom = Array<number>(count).fill(0)
    const roomOrder = adultsPerRoom.map((_, index) => index).sort((a, b) => adultsPerRoom[a] - adultsPerRoom[b])
    for (const index of roomOrder) {
      const childCapacity = Math.min(room.max_children, room.max_occupancy - adultsPerRoom[index])
      const children = Math.min(childrenLeft, childCapacity)
      childrenLeft -= children
      childrenPerRoom[index] = children
    }

    if (childrenLeft === 0) {
      return adultsPerRoom.map((adults, index) => ({ adults, children: childrenPerRoom[index] }))
    }
  }
  return null
}

const partyCost = (addon: AddonVM, search: Search, party: RoomParty) => (
  addon.pricing === 'per_night'
    ? addon.price * search.nights
    : addon.pricing === 'per_guest'
      ? addon.price * (party.adults + party.children)
      : addon.price
)
const countLabel = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`
const partyLabel = (adults: number, children: number) => [
  adults > 0 ? countLabel(adults, 'adult') : null,
  children > 0 ? countLabel(children, 'child', 'children') : null,
].filter(Boolean).join(' and ') || 'no guests'

function roomCapacityLabel(room: RoomVM) {
  const examples = [
    room.max_adults > 0 ? countLabel(Math.min(room.max_adults, room.max_occupancy), 'adult') : null,
    room.max_children > 0 ? countLabel(Math.min(room.max_children, room.max_occupancy), 'child', 'children') : null,
  ].filter((example): example is string => example !== null)
  if (room.max_occupancy >= 2 && room.max_adults > 0 && room.max_children > 0) examples.push('1 of each')

  const choices = examples.length === 0
    ? ''
    : examples.length === 1
      ? examples[0]
      : examples.length === 2
        ? `${examples[0]} or ${examples[1]}`
        : `${examples.slice(0, -1).join(', ')}, or ${examples[examples.length - 1]}`
  const examplesSentence = choices ? ` That could be ${choices}.` : ''

  return `This room sleeps up to ${countLabel(room.max_occupancy, 'guest')} in total, adults and children combined.${examplesSentence}`
}

export default function RoomCard({ room, addons, upgrades, search, settings, profile, gymAccessCovered, isLoggedIn }: {
  room: RoomVM; addons: AddonVM[]; upgrades: AddonVM[]; search: Search; settings: Settings; profile: Profile | null; gymAccessCovered: boolean; isLoggedIn: boolean
}) {
  const [modal, setModal] = useState(false)
  const [bookingProfile, setBookingProfile] = useState<Profile | null>(profile)
  const [bookingRoomParties, setBookingRoomParties] = useState<RoomParty[]>([])
  const [startingBooking, setStartingBooking] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const router = useRouter()

  const roomPlan = planRoomParties(room, search)
  const fits = roomPlan?.length === 1
  const nightsOk = search.nights >= room.min_nights && search.nights <= room.max_nights
  const soldOut = room.rooms_available < 1
  const totalGuests = search.adults + search.children
  const canBookMultiple = !fits && nightsOk && roomPlan !== null && roomPlan.length > 1 && roomPlan.length <= room.rooms_available
  const bookingNotice = roomPlan
    ? roomPlan.length > room.rooms_available
      ? `Your group of ${countLabel(totalGuests, 'guest')} needs ${countLabel(roomPlan.length, 'room')} of this type, but only ${room.rooms_available} ${room.rooms_available === 1 ? 'is' : 'are'} available for these dates. Try another room or dates.`
      : `This room fits up to ${countLabel(room.max_occupancy, 'guest')} in total, adults and kids included. Your group of ${countLabel(totalGuests, 'guest')} can book together in ${countLabel(roomPlan.length, 'room')} of this type.`
    : `This room type cannot accommodate your group of ${partyLabel(search.adults, search.children)} across multiple rooms. Try a different room type or adjust the guest count.`
  const blocked = !fits
    ? bookingNotice
    : !nightsOk ? `Stay must be ${room.min_nights}–${room.max_nights} nights.`
      : soldOut ? 'Sold out for these dates.' : null

  async function openBooking(roomParties: RoomParty[]) {
    if (startingBooking) return
    setBookingError(null)
    setBookingRoomParties(roomParties)
    if (profile) {
      setBookingProfile(profile)
      setModal(true)
      return
    }

    setStartingBooking(true)
    try {
      const supabase = createClient()
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError && authError.name !== 'AuthSessionMissingError') {
        setBookingError(`Unable to start your booking: ${authError.message}`)
        return
      }
      if (auth.user && !auth.user.is_anonymous) {
        setBookingError('Your account is not available for booking. Please contact the hotel for help.')
        return
      }

      let user = auth.user
      if (!user) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) {
          setBookingError(friendlyError(error))
          return
        }
        user = data.user
      }
      if (!user) {
        setBookingError('We could not start a guest booking. Please try again.')
        return
      }

      setBookingProfile({ first_name: '', last_name: '', email: '', phone: '' })
      setModal(true)
      router.refresh()
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : 'Unable to start your booking. Please try again.')
    } finally {
      setStartingBooking(false)
    }
  }

  return (
    <article className="card stack" aria-label={room.name}>
      {room.photos[0] ? <img className="cover" src={room.photos[0]} alt={room.name} loading="lazy" /> : <div className="ph">No photo yet</div>}
      <div className="row between">
        <h3 style={{ margin: 0 }}>{room.name}</h3>
        {room.category && <span className="pill">{room.category}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{room.description}</p>
      <div className="small">{roomCapacityLabel(room)}</div>
      {room.amenities.length > 0 && <div className="row" style={{ gap: '.3rem' }}>{room.amenities.map((a) => <span key={a} className="pill">{a}</span>)}</div>}
      <div className="row between">
        <div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{money(room.total, settings.currency)}</div>
          <div className="small muted">{search.nights} night{search.nights > 1 ? 's' : ''} · {fmtDate(search.checkin + 'T12:00:00Z')} → {fmtDate(search.checkout + 'T12:00:00Z')} · before taxes & fees</div>
          {!soldOut && room.rooms_available <= 3 && <div className="small" style={{ color: 'var(--warn)' }}>Only {room.rooms_available} left</div>}
        </div>
      </div>
      {room.policies && <details className="small"><summary>Room policies</summary>{room.policies}</details>}
      {blocked && <div className="notice warn small">{blocked}</div>}
      {canBookMultiple && roomPlan && <div className="small muted">
        Estimated total for {countLabel(roomPlan.length, 'room')}: <strong>{money(room.total * roomPlan.length, settings.currency)}</strong> before add-ons, taxes, and fees.
      </div>}
      <div className="row">
        <button className="btn" disabled={!!blocked || startingBooking} onClick={() => openBooking([{ adults: search.adults, children: search.children }])}>{startingBooking ? <span className="spinner" /> : 'Book now'}</button>
        {canBookMultiple && roomPlan && <button className="btn secondary" disabled={startingBooking} onClick={() => openBooking(roomPlan)}>
          {startingBooking ? <span className="spinner" /> : `Book ${roomPlan.length} rooms`}
        </button>}
      </div>
      {canBookMultiple && roomPlan && <div className="notice info small" aria-label="Proposed room assignments">
        <strong>Proposed room assignments</strong>
        <ul style={{ margin: '.35rem 0', paddingLeft: '1.25rem' }}>
          {roomPlan.map((party, index) => <li key={index}>Room {index + 1}: {partyLabel(party.adults, party.children)}</li>)}
        </ul>
        Every room includes at least one adult; children are not assigned to a room by themselves.
      </div>}
      {bookingError && <div className="notice bad small" role="alert">{bookingError}</div>}
      {modal && bookingProfile && (
        <RoomBookingModal room={room} addons={addons} upgrades={upgrades} search={search} settings={settings} profile={bookingProfile} roomParties={bookingRoomParties} gymAccessCovered={gymAccessCovered} isLoggedIn={isLoggedIn} onClose={() => setModal(false)} />
      )}
    </article>
  )
}

const STEPS = ['Guest details', 'Add-ons', 'Room upgrades', 'Extras', 'Review stay']
const EXTRA_OPTIONS: { id: ExtraInterest; name: string; description: string }[] = [
  { id: 'restaurant', name: 'Dining', description: 'Choose a date, time, and table after your room is in the cart.' },
  { id: 'spa', name: 'Spa', description: 'Browse treatments and choose an available time from the cart.' },
  { id: 'gym', name: 'Gym access', description: 'Save 35% on adult gym access when added to your stay.' },
  { id: 'event', name: 'Tours', description: 'Browse tours and ask about exclusive hotel guest offers.' },
]

function RoomBookingModal({ room, addons, upgrades, search, settings, profile, roomParties, gymAccessCovered, isLoggedIn, onClose }: {
  room: RoomVM; addons: AddonVM[]; upgrades: AddonVM[]; search: Search; settings: Settings; profile: Profile; roomParties: RoomParty[]; gymAccessCovered: boolean; isLoggedIn: boolean; onClose: () => void
}) {
  useEffect(() => {
    const bodyOverflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = bodyOverflow
      document.documentElement.style.overflow = rootOverflow
    }
  }, [])

  const [step, setStep] = useState(0)
  const [d, setD] = useState<Details>({ ...profile, notes: '' })
  const [showErr, setShowErr] = useState(false)
  const [addonIds, setAddonIds] = useState<string[]>([])
  const [upgradeAssignments, setUpgradeAssignments] = useState<Record<string, Record<string, string>>>({})
  const [interests, setInterests] = useState<ExtraInterest[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const selectedAddons = addons.filter((a) => addonIds.includes(a.id))
  const availableUpgrades = upgrades.filter((upgrade) => upgrade.room_type_id === null || upgrade.room_type_id === room.id)
  const upgradeGroups = groupRoomUpgrades(availableUpgrades)
  const selectedUpgrades = availableUpgrades.flatMap((upgrade) => Object.entries(upgradeAssignments[upgrade.id] ?? {})
    .map(([roomIndex, details]) => ({ ...upgrade, roomIndex: Number(roomIndex), details })))
  const roomAndAddonsTotal = Number(room.total) * roomParties.length + selectedAddons.reduce(
    (sum, addon) => sum + roomParties.reduce((roomSum, party) => roomSum + partyCost(addon, search, party), 0),
    0,
  )
  const upgradeTotal = selectedUpgrades.reduce((sum, upgrade) =>
    sum + partyCost(upgrade, search, roomParties[upgrade.roomIndex]), 0)
  const extraOptions = gymAccessCovered ? EXTRA_OPTIONS.filter((option) => option.id !== 'gym') : EXTRA_OPTIONS
  const total = roomAndAddonsTotal + upgradeTotal
  const selectedInterests = extraOptions.filter((option) => interests.includes(option.id)).map((option) => option.name)

  function setUpgradeSelected(upgradeId: string, roomIndex: number, selected: boolean) {
    setUpgradeAssignments((current) => {
      const roomKey = String(roomIndex)
      const sharedDetails = Object.values(current).find((assignments) => Object.hasOwn(assignments, roomKey))?.[roomKey] ?? ''
      const assignments = { ...(current[upgradeId] ?? {}) }
      if (selected) assignments[roomKey] ??= sharedDetails
      else delete assignments[roomKey]
      return { ...current, [upgradeId]: assignments }
    })
  }

  function setUpgradeDetails(roomIndex: number, details: string) {
    const roomKey = String(roomIndex)
    setUpgradeAssignments((current) => Object.fromEntries(Object.entries(current).map(([upgradeId, assignments]) => [
      upgradeId,
      Object.hasOwn(assignments, roomKey) ? { ...assignments, [roomKey]: details } : assignments,
    ])))
  }

  async function addToCart() {
    setBusy(true); setError(null)
    const supabase = createClient()
    const common = {
      p_room_type: room.id,
      p_checkin: search.checkin,
      p_checkout: search.checkout,
      p_addons: addonIds,
      p_first: d.first_name.trim(),
      p_last: d.last_name.trim(),
      p_email: d.email.trim(),
      p_phone: d.phone.trim(),
      p_notes: d.notes.trim(),
      p_interests: interests,
    }
    const roomUpgradeChoices = roomParties.map((_, roomIndex) => ({
      upgrades: selectedUpgrades
        .filter((upgrade) => upgrade.roomIndex === roomIndex)
        .map((upgrade) => ({ upgrade_id: upgrade.id, details: upgrade.details })),
    }))
    const { error: rpcError } = roomParties.length === 1
      ? await supabase.rpc('add_room_booking_with_upgrades_to_cart', {
        ...common,
        p_adults: roomParties[0].adults,
        p_children: roomParties[0].children,
        p_coupon_codes: [],
        p_upgrades: roomUpgradeChoices[0].upgrades,
      })
      : await supabase.rpc('add_multi_room_booking_with_upgrades_to_cart', {
        ...common,
        p_room_parties: roomParties,
        p_room_upgrades: roomUpgradeChoices,
      })
    setBusy(false)
    if (rpcError) return setError(friendlyError(rpcError))
    router.push('/book/cart')
  }

  return (
    <div className="modal-back room-booking-modal-back" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal stack room-booking-modal" role="dialog" aria-modal="true" aria-labelledby="room-booking-title">
        <div className="row between"><h2 id="room-booking-title" style={{ margin: 0 }}>Book {roomParties.length > 1 ? `${roomParties.length} rooms · ` : ''}{room.name}</h2><button className="btn sm secondary" onClick={onClose} aria-label="Close">✕</button></div>
        <ol className="steps">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</li>)}</ol>
        {error && <div className="notice bad" role="alert">{error}</div>}

        {step === 0 && <>
          <DetailsFields value={d} onChange={setD} showErrors={showErr} showNotesHelp={false} isLoggedIn={isLoggedIn} />
          <div className="row between"><span /><button className="btn" onClick={() => (detailsValid(d) ? (setShowErr(false), setStep(1)) : setShowErr(true))}>Continue</button></div>
        </>}
        {step === 1 && <>
          {addons.length === 0 ? <div className="notice info">There are no room add-ons available for these dates.</div> : <fieldset className="stack" style={{ border: '1px solid var(--line)', borderRadius: 6 }}>
            <legend className="small" style={{ fontWeight: 600 }}>Available room add-ons</legend>
            {roomParties.length > 1 && <p className="small muted">Selected add-ons apply to each room; per-guest prices follow that room’s guest count.</p>}
            {addons.map((a) => (
              <label key={a.id} className="row small" style={{ gap: '.5rem' }}>
                <input type="checkbox" checked={addonIds.includes(a.id)} onChange={(e) => setAddonIds(e.target.checked ? [...addonIds, a.id] : addonIds.filter((id) => id !== a.id))} />
                <span>{a.name} <span className="muted">· {money(roomParties.reduce((sum, party) => sum + partyCost(a, search, party), 0), settings.currency)}{roomParties.length > 1 ? ' total' : ''}</span></span>
              </label>
            ))}
          </fieldset>}
          <div className="small muted">{countLabel(roomParties.length, 'room')} and selected add-ons: <strong>{money(roomAndAddonsTotal, settings.currency)}</strong> before taxes, fees, and coupons.</div>
          <div className="row between"><button className="btn secondary" onClick={() => setStep(0)}>Back</button><button className="btn" onClick={() => setStep(2)}>Continue</button></div>
        </>}
        {step === 2 && <>
          {availableUpgrades.length === 0
            ? <div className="notice info">There are no room upgrades available for {room.name} at this time.</div>
            : <>
              <div className="room-upgrade-list">
                {upgradeGroups.map((group) => {
                  const isSingleOption = group.upgrades.length === 1 && !group.combined
                  const hasSelection = group.upgrades.some((upgrade) =>
                    Object.keys(upgradeAssignments[upgrade.id] ?? {}).length > 0)
                  return <section key={group.id} className="room-upgrade-card">
                    <header className="room-upgrade-card-header">
                      <span className={`room-upgrade-icon${hasSelection ? ' is-selected' : ''}`}><RoomUpgradeIcon name={group.icon} /></span>
                      <h3>{group.name}</h3>
                    </header>
                    <div className="room-upgrade-card-options">
                      {group.upgrades.map((upgrade) => {
                        return <div key={upgrade.id} className="room-upgrade-choice">
                          {!isSingleOption && <div className="room-upgrade-choice-header">
                            <span className="room-upgrade-choice-title">
                              <RoomUpgradeIcon name={upgrade.icon} />
                              <strong>{upgrade.name}</strong>
                            </span>
                          </div>}
                          <div className="room-upgrade-assignments">
                            {roomParties.map((party, roomIndex) => {
                              const selected = Object.hasOwn(upgradeAssignments[upgrade.id] ?? {}, String(roomIndex))
                              return <div key={roomIndex} className="room-upgrade-assignment">
                                <label className={`room-upgrade-room${selected ? ' is-selected' : ''}`}>
                                  <input type="checkbox" checked={selected} onChange={(event) => setUpgradeSelected(upgrade.id, roomIndex, event.target.checked)} />
                                  <span>Room {roomIndex + 1} · {partyLabel(party.adults, party.children)}</span>
                                </label>
                                <span className="room-upgrade-price"><small>per room</small><strong>{money(partyCost(upgrade, search, party), settings.currency)}</strong></span>
                              </div>
                            })}
                          </div>
                        </div>
                      })}
                    </div>
                  </section>
                })}
                {roomParties.map((party, roomIndex) => {
                  const selectedRoomUpgrades = availableUpgrades.filter((upgrade) =>
                    Object.hasOwn(upgradeAssignments[upgrade.id] ?? {}, String(roomIndex)))
                  if (selectedRoomUpgrades.length === 0) return null
                  const detailsId = `upgrade-details-${roomIndex}`
                  const selectedNames = [...new Set(selectedRoomUpgrades.map((upgrade) => upgrade.name))]
                  const details = upgradeAssignments[selectedRoomUpgrades[0].id]?.[String(roomIndex)] ?? ''
                  return <div key={roomIndex} className="room-upgrade-details">
                    {roomParties.length > 1 && <div className="small muted">Room {roomIndex + 1} · {partyLabel(party.adults, party.children)}</div>}
                    <label className="field small" htmlFor={detailsId}>Enter details for {selectedNames.join(', ')}</label>
                    <textarea id={detailsId} maxLength={1000} value={details}
                      onChange={(event) => setUpgradeDetails(roomIndex, event.target.value)}
                      placeholder="e.g., flight number, arrival time, preferred check-in time" />
                  </div>
                })}
              </div>
            </>}
          <div className="small muted">Stay total for {countLabel(roomParties.length, 'room')}: <strong>{money(roomAndAddonsTotal + upgradeTotal, settings.currency)}</strong> before taxes, fees, and coupons.</div>
          <div className="row between"><button className="btn secondary" onClick={() => setStep(1)}>Back</button><button className="btn" onClick={() => setStep(3)}>Continue</button></div>
        </>}
        {step === 3 && <>
          {roomParties.length > 1 && <div className="notice info small">Your dining, spa, gym, and tour interests will be saved for each room.</div>}
          <div className="grid">
            {gymAccessCovered && <div className="notice info small">Your active gym membership covers these stay dates, so there is no need to add gym access.</div>}
            {extraOptions.map((option) => {
              const checked = interests.includes(option.id)
              return <button
                key={option.id}
                type="button"
                className="card stack"
                aria-pressed={checked}
                onClick={() => setInterests(checked ? interests.filter((interest) => interest !== option.id) : [...interests, option.id])}
                style={{ textAlign: 'left', borderColor: checked ? 'var(--brand)' : undefined, cursor: 'pointer' }}
              >
                <span className="row between"><strong>{option.name}</strong><span className={`pill ${checked ? 'ok' : ''}`}>{checked ? 'Added' : 'Add'}</span></span>
                <span className="small muted">{option.description}</span>
              </button>
            })}
          </div>
          <div className="small muted">Stay total for {countLabel(roomParties.length, 'room')}: <strong>{money(total, settings.currency)}</strong> before taxes, fees, and coupons.</div>
          <div className="row between"><button className="btn secondary" onClick={() => setStep(2)} disabled={busy}>Back</button><button className="btn" onClick={() => setStep(4)} disabled={busy}>Review stay</button></div>
        </>}
        {step === 4 && <>
          <section className="room-booking-review" aria-label="Stay booking preview">
            <header className="room-booking-review-heading">
              <h3>{roomParties.length > 1 ? `${roomParties.length} × ` : ''}{room.name}</h3>
              <p>{fmtDate(search.checkin + 'T12:00:00Z')} – {fmtDate(search.checkout + 'T12:00:00Z')} · {search.nights} night{search.nights === 1 ? '' : 's'} · {partyLabel(search.adults, search.children)}</p>
            </header>
            <dl className="room-booking-review-details">
              {roomParties.length > 1 && <div><dt>Guest split</dt><dd>{roomParties.map((party, index) => `Room ${index + 1}: ${partyLabel(party.adults, party.children)}`).join(' · ')}</dd></div>}
              <div><dt>Interests</dt><dd>{selectedInterests.length > 0 ? selectedInterests.join(', ') : 'None selected'}</dd></div>
              <div><dt>Guest</dt><dd>{d.first_name} {d.last_name}</dd></div>
              <div><dt>Email</dt><dd>{d.email}</dd></div>
              <div><dt>Phone</dt><dd>{d.phone}</dd></div>
            </dl>
            <div className="room-booking-review-total">
              <div><span>Room, add-ons &amp; upgrades</span><strong>{money(total, settings.currency)}</strong></div>
              {selectedAddons.length > 0 && <div className="room-booking-review-addons"><span>Add-ons</span><strong>{selectedAddons.map((addon) => addon.name).join(', ')}</strong></div>}
              {selectedUpgrades.length > 0 && <div className="room-booking-review-addons">
                <span>Room upgrades</span>
                <strong>{selectedUpgrades.map((upgrade) => `${upgrade.name} · Room ${upgrade.roomIndex + 1}`).join(', ')}</strong>
              </div>}
              <div className="room-booking-review-due"><strong>Estimated total before taxes and fees</strong><strong>{money(total, settings.currency)}</strong></div>
              <p>No charge is made now. Taxes, fees, and final savings are shown in your cart.</p>
            </div>
            <p className="room-booking-review-note">
              Your dining, spa, and gym choices are saved and can be finalized in your cart. Tours are for browsing only; ask about guest offers while planning your stay.
            </p>
            <div className="room-booking-review-policy">
              <strong>Cancellation policy</strong>
              <p>{settings.cancellation_policy}</p>
            </div>
          </section>
          <div className="row between">
            <button className="btn secondary" onClick={() => setStep(3)} disabled={busy}>Back</button>
            <button className="btn accent" onClick={addToCart} disabled={busy}>{busy ? <span className="spinner" /> : `Add ${countLabel(roomParties.length, 'room')} to cart`}</button>
          </div>
        </>}
      </section>
    </div>
  )
}
