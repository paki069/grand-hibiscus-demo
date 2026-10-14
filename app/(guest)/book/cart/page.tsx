import Link from 'next/link'
import { getCart, getSettings } from '@/lib/data'
import CartView from '@/components/CartView'
import { Empty } from '@/components/ui'

export default async function CartPage() {
  const [cart, s] = await Promise.all([getCart(), getSettings()])
  return (
    <div className="stack">
      <ol className="steps steps-text-only"><li className="done">Choose</li><li className="on">Cart</li><li>Pay</li></ol>
      <h1>Your cart</h1>
      {!cart || (cart.items.length === 0 && cart.interests.length === 0) ? (
        <Empty>Your cart is empty. <Link href="/">Find a room</Link> or <Link href="/book/extras">add dining, spa or events</Link>.</Empty>
      ) : (
        <CartView items={cart.items} interests={cart.interests} orders={cart.orders} coupons={cart.coupons} currency={s.currency} tz={s.timezone} holdMinutes={s.hold_minutes} checkinTime={s.checkin_time} taxRate={Number(s.tax_rate)} feeRate={Number(s.service_fee_rate)} />
      )}
    </div>
  )
}
