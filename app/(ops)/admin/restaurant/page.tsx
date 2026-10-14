import AdminSection, { type Tab } from '@/components/AdminSection'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import MenuProductsManager from '@/components/MenuProductsManager'

const tabs: Tab[] = [
  { key: 'products', label: 'Menu products', config: { table: 'menu_products', title: 'Menu products', fields: [] } },
  { key: 'categories', label: 'Menu categories', config: { table: 'menu_categories', title: 'Menu categories', orderBy: 'sort_order', fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'sort_order', label: 'Order', type: 'number', defaultValue: 0, required: true }, { key: 'active', label: 'Active', type: 'checkbox' },
  ] } },
  { key: 'config', label: 'Hours & booking rules', config: { table: 'restaurant_config', title: 'Restaurant hours & rules', orderBy: 'id', canCreate: false, canDelete: false, fields: [
    { key: 'open_time', label: 'Opens', type: 'time', required: true }, { key: 'close_time', label: 'Closes', type: 'time', required: true },
    { key: 'dwell_minutes', label: 'Table time (min)', type: 'number', required: true },
    { key: 'deposit_per_guest', label: 'Deposit / guest', type: 'number', step: '0.01', required: true }, { key: 'closed_weekdays', label: 'Closed on', type: 'weekdays' },
  ] } },
]

export default async function Restaurant({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const isProductsTab = !tab || tab === 'products'
  const [settings, categoryResult] = await Promise.all([
    getSettings(),
    isProductsTab ? (await createClient()).from('menu_categories').select('id,name').eq('active', true).order('name') : Promise.resolve({ data: [], error: null }),
  ])
  if (categoryResult.error) throw new Error(`Could not load menu categories: ${categoryResult.error.message}`)
  return (
    <>
      <AdminSection title="Restaurant" base="/admin/restaurant" tabs={tabs} tab={tab} intro="Table reservations start hourly during restaurant opening hours. Menu orders (products) are separate from table reservations and appear in Reservations → filter by restaurant."
        customContent={isProductsTab ? <MenuProductsManager categories={categoryResult.data ?? []} currency={settings.currency} /> : undefined} />
      <p className="small" style={{ marginTop: '1rem' }}><Link href="/admin/restaurant/seating">Open the seating-map editor →</Link></p>
    </>
  )
}
