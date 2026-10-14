import Link from 'next/link'
import { getCart, getSettings } from '@/lib/data'
import { createClient } from '@/lib/supabase/server'
import { Notice } from '@/components/ui'
import RoomUpgradesForm, { type RoomUpgradeOption, type UpgradeRoom } from '@/components/RoomUpgradesForm'

export default async function RoomUpgradesPage() {
  const [cart, settings] = await Promise.all([getCart(), getSettings()])
  const rooms = (cart?.items ?? [])
    .filter((item) => item.service_type === 'hotel')
    .map((item): UpgradeRoom => {
      const meta = item.meta ?? {}
      const roomTypeId = typeof meta.room_type_id === 'string' ? meta.room_type_id : ''
      if (!roomTypeId) throw new Error(`Room booking ${item.id} is missing its room type; cannot calculate upgrade availability.`)
      const currentUpgrades = Array.isArray(meta.room_upgrades) ? meta.room_upgrades : []
      return {
        id: item.id,
        title: item.title,
        adults: item.adults,
        children: item.children,
        room_type_id: roomTypeId,
        nights: Number(meta.nights) > 0 ? Number(meta.nights) : 1,
        current_upgrades: currentUpgrades.filter((upgrade: any) => typeof upgrade?.id === 'string').map((upgrade: any) => ({
          id: upgrade.id,
          name: String(upgrade.name ?? 'Room upgrade'),
          description: typeof upgrade.description === 'string' ? upgrade.description : undefined,
          total: Number(upgrade.total) || 0,
          details: typeof upgrade.details === 'string' ? upgrade.details : null,
        })),
      }
    })

  const supabase = await createClient()
  const { data, error } = await supabase.from('room_addons')
    .select('id, room_type_id, name, description, icon, price, pricing, active, room_types(name)')
    .eq('kind', 'upgrade')
    .eq('active', true)
    .order('sort_order')
    .order('name')
  if (error) throw new Error(`Unable to load room upgrades: ${error.message}`)

  return (
    <div className="stack">
      <ol className="steps"><li className="done">1 · Choose room</li><li className="on">2 · Room upgrades</li><li>3 · Cart & pay</li></ol>
      <div className="row between">
        <h1 style={{ margin: 0 }}>Room upgrades</h1>
        <Link className="btn secondary" href="/book/cart">Skip upgrades · Go to cart →</Link>
      </div>
      {rooms.length === 0
        ? <Notice tone="info">Add a room to your cart before selecting upgrades. <Link href="/">Choose a room</Link>.</Notice>
        : <RoomUpgradesForm rooms={rooms} upgrades={(data ?? []).map((upgrade: any) => ({
          ...upgrade,
          room_type_name: upgrade.room_types?.name ?? null,
        })) as RoomUpgradeOption[]} currency={settings.currency} />}
    </div>
  )
}
