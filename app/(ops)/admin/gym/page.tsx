import AdminSection, { type Tab } from '@/components/AdminSection'

const tabs: Tab[] = [{
  key: 'packages',
  label: 'Packages',
  config: {
    table: 'gym_packages',
    title: 'Gym packages',
    orderBy: 'sort_order',
    canCreate: false,
    canDelete: false,
    fields: [
      { key: 'title', label: 'Package name', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'benefits', label: 'Included details', type: 'tags', help: 'Separate each detail with a comma.' },
      { key: 'price', label: 'Price', type: 'number', step: '0.01', nullable: true, help: 'Leave blank to keep this package unavailable for online purchase.' },
      { key: 'loyalty_points', label: 'Standalone purchase points', type: 'number', required: true, help: 'Points awarded when this package is purchased on its own.' },
      { key: 'active', label: 'Visible to guests', type: 'checkbox' },
    ],
  },
}]

export default async function GymAdmin({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  return (
    <AdminSection
      title="Gym packages"
      base="/admin/gym"
      tabs={tabs}
      tab={tab}
      intro="Edit the four fixed gym offers shown to guests. Standalone prices remain unchanged; a 35% discount is automatically applied to day-pass access added to a hotel stay."
    />
  )
}
