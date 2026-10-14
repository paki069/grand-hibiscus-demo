'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money } from '@/lib/format'
import { groupRoomUpgrades, RoomUpgradeIcon } from '@/lib/room-upgrades'

type UpgradePricing = 'per_stay' | 'per_night' | 'per_guest'
export interface RoomUpgradeOption {
  id: string
  room_type_id: string | null
  room_type_name?: string | null
  name: string
  description: string
  icon?: string | null
  price: number | string
  pricing: UpgradePricing
  active: boolean
}
export interface UpgradeRoom {
  id: string
  title: string
  adults: number
  children: number
  room_type_id: string
  nights: number
  current_upgrades: { id: string; name: string; description?: string; total: number; details?: string | null }[]
}

type SelectionState = Record<string, Record<string, string>>

const initialSelections = (rooms: UpgradeRoom[]): SelectionState => Object.fromEntries(
  rooms.map((room) => [room.id, Object.fromEntries(
    room.current_upgrades.map((upgrade) => [upgrade.id, upgrade.details ?? '']),
  )]),
)

function roomPrice(upgrade: RoomUpgradeOption, room: UpgradeRoom) {
  const saved = room.current_upgrades.find((current) => current.id === upgrade.id)
  if (saved) return Number(saved.total) || 0
  const price = Number(upgrade.price)
  if (upgrade.pricing === 'per_night') return price * room.nights
  if (upgrade.pricing === 'per_guest') return price * (room.adults + room.children)
  return price
}

export default function RoomUpgradesForm({ rooms, upgrades, currency }: {
  rooms: UpgradeRoom[]
  upgrades: RoomUpgradeOption[]
  currency: string
}) {
  const router = useRouter()
  const [selections, setSelections] = useState<SelectionState>(() => initialSelections(rooms))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const upgradesById = useMemo(() => new Map(upgrades.map((upgrade) => [upgrade.id, upgrade])), [upgrades])
  const upgradeGroups = useMemo(() => groupRoomUpgrades(upgrades), [upgrades])
  const unlistedExisting = rooms.flatMap((room) => room.current_upgrades
    .filter((upgrade) => !upgradesById.has(upgrade.id))
    .map((upgrade) => ({ room, upgrade })))

  function setSelected(roomId: string, upgradeId: string, selected: boolean) {
    setSaved(false)
    setSelections((current) => {
      const roomSelections = { ...(current[roomId] ?? {}) }
      const sharedDetails = Object.values(roomSelections)[0] ?? ''
      if (selected) roomSelections[upgradeId] ??= sharedDetails
      else delete roomSelections[upgradeId]
      return { ...current, [roomId]: roomSelections }
    })
  }

  function setDetails(roomId: string, details: string) {
    setSaved(false)
    setSelections((current) => {
      const roomSelections = Object.fromEntries(Object.keys(current[roomId] ?? {}).map((upgradeId) => [upgradeId, details]))
      return { ...current, [roomId]: roomSelections }
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    const payload = rooms.map((room) => ({
      room_id: room.id,
      upgrades: Object.entries(selections[room.id] ?? {}).map(([upgrade_id, details]) => ({ upgrade_id, details })),
    }))
    try {
      const { error: saveError } = await createClient().rpc('set_cart_room_upgrades', { p_room_selections: payload })
      if (saveError) {
        setError(friendlyError(saveError))
        return
      }
      setSaved(true)
      router.refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save room upgrades. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const addedTotal = rooms.reduce((total, room) => total + Object.entries(selections[room.id] ?? {}).reduce((roomTotal, [upgradeId]) => {
    const option = upgradesById.get(upgradeId)
    if (option) return roomTotal + roomPrice(option, room)
    return roomTotal + (room.current_upgrades.find((upgrade) => upgrade.id === upgradeId)?.total ?? 0)
  }, 0), 0)

  return (
    <div className="stack">
      {unlistedExisting.length > 0 && <div className="notice warn">
        Some previously selected upgrades are no longer in the active catalog. They are included below so you can remove them if needed.
      </div>}
      {upgrades.length === 0 && unlistedExisting.length === 0
        ? <div className="empty">There are no room upgrades available right now.</div>
        : <div className="room-upgrade-list">
          {upgradeGroups.map((group) => {
            const groupUpgrades = group.upgrades.map((upgrade) => ({
              upgrade,
              eligibleRooms: rooms.filter((room) => upgrade.room_type_id === null
                || upgrade.room_type_id === room.room_type_id
                || room.current_upgrades.some((current) => current.id === upgrade.id)),
            })).filter(({ eligibleRooms }) => eligibleRooms.length > 0)
            if (groupUpgrades.length === 0) return null
            const isSingleOption = groupUpgrades.length === 1 && !group.combined
            const hasSelection = groupUpgrades.some(({ upgrade, eligibleRooms }) =>
              eligibleRooms.some((room) => Object.hasOwn(selections[room.id] ?? {}, upgrade.id)))
            return (
              <section className="room-upgrade-card" key={group.id}>
                <header className="room-upgrade-card-header">
                  <span className={`room-upgrade-icon${hasSelection ? ' is-selected' : ''}`}><RoomUpgradeIcon name={group.icon} /></span>
                  <h3>{group.name}</h3>
                </header>
                <div className="room-upgrade-card-options">
                  {groupUpgrades.map(({ upgrade, eligibleRooms }) => {
                    return <div className="room-upgrade-choice" key={upgrade.id}>
                      {!isSingleOption && <div className="room-upgrade-choice-header">
                        <span className="room-upgrade-choice-title">
                          <RoomUpgradeIcon name={upgrade.icon} />
                          <strong>{upgrade.name}</strong>
                        </span>
                      </div>}
                      <div className="room-upgrade-assignments">
                        {eligibleRooms.map((room) => {
                          const selected = Object.hasOwn(selections[room.id] ?? {}, upgrade.id)
                          const amount = roomPrice(upgrade, room)
                          return <div className="room-upgrade-assignment" key={room.id}>
                              <label className={`room-upgrade-room${selected ? ' is-selected' : ''}`}>
                                <input type="checkbox" checked={selected} disabled={!upgrade.active && !selected}
                                  onChange={(event) => setSelected(room.id, upgrade.id, event.target.checked)} />
                                <span>{room.title} · {room.adults + room.children} guest{room.adults + room.children === 1 ? '' : 's'}</span>
                              </label>
                              <span className="room-upgrade-price"><small>per room</small><strong>{money(amount, currency)}</strong></span>
                            </div>
                        })}
                      </div>
                    </div>
                  })}
                </div>
              </section>
            )
          })}
          {rooms.map((room) => {
            const selectedRoomUpgrades = upgrades.filter((upgrade) => Object.hasOwn(selections[room.id] ?? {}, upgrade.id))
            if (selectedRoomUpgrades.length === 0) return null
            const detailsId = `cart-upgrade-details-${room.id}`
            const selectedNames = [...new Set(selectedRoomUpgrades.map((upgrade) => upgrade.name))]
            const details = selections[room.id]?.[selectedRoomUpgrades[0].id] ?? ''
            return <div key={room.id} className="room-upgrade-details">
              {rooms.length > 1 && <div className="small muted">{room.title}</div>}
              <label className="field small" htmlFor={detailsId}>Enter details for {selectedNames.join(', ')}</label>
              <textarea id={detailsId} maxLength={1000} value={details}
                onChange={(event) => setDetails(room.id, event.target.value)}
                placeholder="e.g., flight number, arrival time, preferred check-in time" />
            </div>
          })}
        </div>}
      {unlistedExisting.map(({ room, upgrade }) => {
        const selected = Object.hasOwn(selections[room.id] ?? {}, upgrade.id)
        return (
          <section className="card stack" key={`${room.id}:${upgrade.id}`}>
            <div className="row between">
              <strong>{upgrade.name} · {room.title}</strong>
              <span>{money(upgrade.total, currency)}</span>
            </div>
            <label className="row small">
              <input type="checkbox" checked={selected} onChange={(event) => setSelected(room.id, upgrade.id, event.target.checked)} />
              Keep this previously selected upgrade
            </label>
            {selected && <label className="field small">
              {upgrade.name}
              <textarea maxLength={1000} value={selections[room.id]?.[upgrade.id] ?? ''}
                onChange={(event) => setDetails(room.id, event.target.value)} />
            </label>}
          </section>
        )
      })}
      <div className="card row between">
        <div>
          <strong>Selected upgrades: {money(addedTotal, currency)}</strong>
          <div className="small muted">Added to your room total and charged at checkout.</div>
        </div>
        <button className="btn accent" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : 'Save upgrades'}</button>
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {saved && <div className="row between">
        <div className="notice ok" role="status">Your room upgrades have been saved.</div>
        <Link className="btn accent" href="/book/cart">Continue to cart →</Link>
      </div>}
    </div>
  )
}
