import AdminSection, { type Tab } from '@/components/AdminSection'
import SpaWeeklyAvailability from '@/components/SpaWeeklyAvailability'
import { createClient } from '@/lib/supabase/server'

const tabs: Tab[] = [
  { key: 'services', label: 'Services', selects: { category_id: { table: 'spa_categories', label: 'name' } }, config: { table: 'spa_services', title: 'Spa services', orderBy: 'name', fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'category_id', label: 'Category', type: 'select', nullable: true },
    { key: 'duration_min', label: 'Duration (min)', type: 'number', required: true, defaultValue: 60, help: 'Appointment length and interval between available start times.' },
    { key: 'price', label: 'Price', type: 'number', step: '0.01', nullable: true, help: 'Leave empty if price is settled at the spa.' },
    { key: 'max_guests', label: 'Max guests per booking', type: 'number', required: true, defaultValue: 1 },
    { key: 'description', label: 'Description', type: 'textarea' }, { key: 'photos', label: 'Photos', type: 'images' }, { key: 'active', label: 'Active', type: 'checkbox' },
  ] } },
  { key: 'categories', label: 'Categories', config: { table: 'spa_categories', title: 'Spa categories', orderBy: 'sort_order', fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'sort_order', label: 'Order', type: 'number', defaultValue: 0, required: true }, { key: 'active', label: 'Active', type: 'checkbox' },
  ] } },
  { key: 'availability', label: 'Weekly availability', config: { table: 'spa_service_availability', title: 'Weekly service hours', fields: [] } },
]

export default async function Spa({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  let availabilityEditor
  if (tab === 'availability') {
    const supabase = await createClient()
    const { data, error } = await supabase.from('spa_services').select('id, name, duration_min').order('name')
    if (error) throw new Error(`Could not load spa services: ${error.message}`)
    availabilityEditor = <SpaWeeklyAvailability services={data ?? []} />
  }
  return <AdminSection title="Spa" base="/admin/spa" tabs={tabs} tab={tab} intro="Set recurring weekly hours for each service. Capacity applies separately to every duration-based start time; do not record health information in notes." customContent={availabilityEditor} />
}
