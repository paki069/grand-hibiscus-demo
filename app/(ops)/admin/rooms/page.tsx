import AdminSection, { type Tab } from '@/components/AdminSection'

const tabs: Tab[] = [
  { key: 'types', label: 'Room types', selects: { category_id: { table: 'room_categories', label: 'name' } }, config: { table: 'room_types', title: 'Room types', orderBy: 'name', fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'category_id', label: 'Category', type: 'select', nullable: true },
    { key: 'base_rate', label: 'Base rate / night', type: 'number', step: '0.01', required: true, defaultValue: 100 },
    { key: 'loyalty_free_night_points', label: 'Free-night coupon cost (points)', type: 'number', required: true, defaultValue: 500, help: 'Points required for one free night in this room type.' },
    { key: 'max_adults', label: 'Max adults', type: 'number', required: true, defaultValue: 2, help: 'Maximum adults allowed; the total guest limit also applies.' }, { key: 'max_children', label: 'Max children', type: 'number', required: true, defaultValue: 1, help: 'Maximum children allowed; children count toward the total guest limit.' },
    { key: 'max_occupancy', label: 'Max guests total', type: 'number', required: true, defaultValue: 3, help: 'Total guests allowed, counting adults and children together.' },
    { key: 'min_nights', label: 'Min nights', type: 'number', required: true, defaultValue: 1 }, { key: 'max_nights', label: 'Max nights', type: 'number', required: true, defaultValue: 30 },
    { key: 'description', label: 'Description', type: 'textarea', hideInTable: true, help: 'Describe room features; capacity is displayed from the limits above.' }, { key: 'amenities', label: 'Amenities', type: 'tags', hideInTable: true },
    { key: 'photos', label: 'Photos', type: 'images' }, { key: 'policies', label: 'Booking rules / policies', type: 'textarea' }, { key: 'active', label: 'Active', type: 'checkbox' },
  ] } },
  { key: 'categories', label: 'Categories', config: { table: 'room_categories', title: 'Room categories', orderBy: 'sort_order', fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'description', label: 'Description', type: 'textarea' }, { key: 'sort_order', label: 'Order', type: 'number', defaultValue: 0, required: true }, { key: 'active', label: 'Active', type: 'checkbox' },
  ] } },
  { key: 'units', label: 'Room units & availability', selects: { room_type_id: { table: 'room_types', label: 'name' } }, config: { table: 'rooms', title: 'Rooms (units)', orderBy: 'number', fields: [
    { key: 'number', label: 'Room number', required: true }, { key: 'room_type_id', label: 'Type', type: 'select', required: true }, { key: 'notes', label: 'Notes', type: 'textarea' }, { key: 'active', label: 'In service', type: 'checkbox', help: 'Untick to take a room out of sale.' },
  ] } },
  { key: 'blocks', label: 'Blocked dates', selects: { room_id: { table: 'rooms', label: 'number' } }, config: { table: 'room_blocks', title: 'Blocked dates (maintenance / owner use)', orderBy: 'start_date', fields: [
    { key: 'room_id', label: 'Room', type: 'select', required: true }, { key: 'start_date', label: 'From', type: 'date', required: true }, { key: 'end_date', label: 'Until (exclusive)', type: 'date', required: true }, { key: 'reason', label: 'Reason' },
  ] } },
  { key: 'rates', label: 'Seasonal rates', selects: { room_type_id: { table: 'room_types', label: 'name' } }, config: { table: 'room_rate_overrides', title: 'Seasonal rate overrides', orderBy: 'start_date', fields: [
    { key: 'room_type_id', label: 'Type', type: 'select', required: true }, { key: 'label', label: 'Label', required: true }, { key: 'start_date', label: 'From', type: 'date', required: true }, { key: 'end_date', label: 'To (inclusive)', type: 'date', required: true }, { key: 'rate', label: 'Rate / night', type: 'number', step: '0.01', required: true },
  ] } },
  { key: 'addons', label: 'Add-ons & upgrades', selects: { room_type_id: { table: 'room_types', label: 'name' } }, config: { table: 'room_addons', title: 'Add-ons & upgrades', orderBy: 'sort_order', fields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'room_type_id', label: 'Only for room type', type: 'select', nullable: true, visibleWhen: { key: 'kind', value: 'upgrade' }, clearWhen: { key: 'kind', value: 'addon' }, help: 'Room-type pricing applies to upgrades only. Leave empty to offer this upgrade for every room type.' },
    { key: 'kind', label: 'Kind', type: 'select', required: true, defaultValue: 'addon', options: [{ value: 'addon', label: 'Add-on' }, { value: 'upgrade', label: 'Upgrade' }], help: 'Add-ons are selected during room booking. Upgrades are offered in the booking flow and guests can choose which rooms receive each one.' },
    { key: 'icon', label: 'Icon', type: 'select', required: true, defaultValue: 'sparkles', visibleWhen: { key: 'kind', value: 'upgrade' }, clearWhen: { key: 'kind', value: 'addon' }, options: [
      { value: 'bed-double', label: 'Bed' }, { value: 'car-front', label: 'Car' }, { value: 'clock-3', label: 'Clock' }, { value: 'coffee', label: 'Coffee' },
      { value: 'dumbbell', label: 'Dumbbell' }, { value: 'key-round', label: 'Key' }, { value: 'luggage', label: 'Luggage' }, { value: 'map-pin', label: 'Map pin' },
      { value: 'plane', label: 'Plane' }, { value: 'sparkles', label: 'Sparkles' }, { value: 'utensils', label: 'Utensils' }, { value: 'waves', label: 'Waves' },
    ], help: 'Choose the icon displayed on the guest-facing upgrade card.' },
    { key: 'sort_order', label: 'Display order', type: 'number', required: true, defaultValue: 100, hideInTable: true, visibleWhen: { key: 'kind', value: 'upgrade' }, help: 'Lower numbers appear first in the guest booking flow.' },
    { key: 'price', label: 'Price', type: 'number', step: '0.01', required: true, defaultValue: 0 },
    { key: 'pricing', label: 'Charged', type: 'select', required: true, defaultValue: 'per_stay', options: [{ value: 'per_stay', label: 'Per stay / room' }, { value: 'per_night', label: 'Per night / room' }, { value: 'per_guest', label: 'Per guest' }], help: 'For upgrades, the price is calculated independently for each room selected by the guest.' },
    { key: 'description', label: 'Description', type: 'textarea', help: 'Internal catalog notes. The guest booking flow uses the selected upgrade names in its shared details field label.' },
    { key: 'active', label: 'Active', type: 'checkbox', help: 'Only active upgrades are shown to guests. Enter the correct price before activating.' },
  ] } },
]

export default async function Rooms({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  return <AdminSection title="Rooms" base="/admin/rooms" tabs={tabs} tab={tab} intro="Room availability is enforced in the database. Taking a unit out of service or blocking dates stops new bookings for it." />
}
