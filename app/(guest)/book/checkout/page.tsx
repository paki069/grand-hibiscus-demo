import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCart, getGuestBookingDetails, getSettings, devPaymentsAllowed } from '@/lib/data'
import CheckoutFlow from '@/components/CheckoutFlow'
import { testCardGatewayAvailable } from '@/lib/test-card-gateway'

export default async function CheckoutPage() {
  const supabase = await createClient()
  const { data: u, error: authError } = await supabase.auth.getUser()
  if (authError && authError.name !== 'AuthSessionMissingError') {
    throw new Error(`Unable to verify the signed-in user for checkout: ${authError.message}`)
  }
  if (!u.user) redirect('/book/cart')
  const [cart, settings, savedDetails] = await Promise.all([
    getCart(),
    getSettings(),
    u.user.is_anonymous ? Promise.resolve(null) : getGuestBookingDetails(u.user.id, u.user.email ?? null),
  ])
  if (!cart || cart.items.length === 0) redirect('/book/cart')
  return (
    <div className="stack">
      <h1>Checkout</h1>
      <CheckoutFlow items={cart.items} settings={settings} profile={{
        first_name: cart.guestDetails.first_name || savedDetails?.first_name || '',
        last_name: cart.guestDetails.last_name || savedDetails?.last_name || '',
        email: cart.guestDetails.email || savedDetails?.email || u.user.email || '',
        phone: cart.guestDetails.phone || savedDetails?.phone || '',
        notes: cart.guestDetails.notes,
      }} devAllowed={devPaymentsAllowed()} cardGatewayAvailable={testCardGatewayAvailable()} isLoggedIn={!u.user.is_anonymous} />
    </div>
  )
}
