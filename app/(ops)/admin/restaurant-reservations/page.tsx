import { redirect } from 'next/navigation'

export default async function RestaurantReservations({ searchParams }: {
  searchParams: Promise<{ date?: string; from?: string; to?: string; code?: string }>
}) {
  const params = await searchParams
  const query = new URLSearchParams({ service: 'restaurant' })
  for (const key of ['date', 'from', 'to', 'code'] as const) {
    if (params[key]) query.set(key, params[key]!)
  }
  redirect(`/admin/reservations?${query.toString()}`)
}
