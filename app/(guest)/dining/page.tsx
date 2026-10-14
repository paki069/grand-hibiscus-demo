import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { money } from '@/lib/format'
import DiningMenuModal from '@/components/DiningMenuModal'
import type { ProductVM } from '@/components/RestaurantMenu'

function displayTime(value: string) {
  const [hours, minutes] = value.split(':')
  const hour = Number(hours)
  if (!Number.isFinite(hour)) return value
  return `${hour % 12 || 12}:${minutes ?? '00'} ${hour >= 12 ? 'PM' : 'AM'}`
}

export default async function DiningPage() {
  const supabase = await createClient()
  const [settings, productsResult, configResult] = await Promise.all([
    getSettings(),
    supabase
      .from('menu_products')
      .select('id, name, description, price, photo_url, menu_product_categories(menu_categories(name, sort_order))')
      .eq('active', true)
      .eq('available', true)
      .order('name'),
    supabase.from('restaurant_config').select('open_time, close_time, closed_weekdays').eq('id', 1).maybeSingle(),
  ])

  if (productsResult.error) throw new Error(`Unable to load the restaurant menu: ${productsResult.error.message}`)
  if (configResult.error) throw new Error(`Unable to load restaurant hours: ${configResult.error.message}`)

  const products: ProductVM[] = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description ?? '',
    price: product.price,
    photo_url: product.photo_url,
    categories: (product.menu_product_categories ?? [])
      .flatMap((link) => link.menu_categories ?? [])
      .sort((a, b) => a.sort_order - b.sort_order),
  }))
  const hours = configResult.data
    ? `${displayTime(configResult.data.open_time)} – ${displayTime(configResult.data.close_time)}`
    : 'Check current availability'
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const closedDays = (configResult.data?.closed_weekdays ?? [])
    .map((day: number) => weekdayNames[day])
    .filter(Boolean)
  const hoursNote = closedDays.length > 0
    ? `Closed ${closedDays.join(', ')}. Choose a date and time to see current seating availability.`
    : 'Choose a date and time to see current seating availability.'

  return (
    <div className="home-page dining-page">
      <section className="home-hero dining-hero" aria-labelledby="dining-title">
        <Image
          src="/images/dining.jpg"
          alt="A warmly lit restaurant table prepared for dinner"
          fill
          priority
          sizes="100vw"
          className="home-hero-image"
        />
        <div className="home-hero-shade" />
        <div className="home-hero-content">
          <p className="home-eyebrow">Dining at {settings.hotel_name}</p>
          <h1 id="dining-title">Stay for<br /><em>another course.</em></h1>
          <p className="home-hero-intro">Settle in, share something good, and let the evening take its time.</p>
          <div className="home-hero-actions">
            <Link className="home-button home-button-light" href="/book/restaurant">Reserve a table <span aria-hidden="true">↗</span></Link>
            <a className="home-text-link" href="#menu">Explore the menu <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="home-hero-caption"><span>The Grand Hibiscus restaurant</span><span>Thoughtful food · Unhurried moments</span></div>
      </section>

      <section className="dining-intro" aria-labelledby="dining-intro-title">
        <div className="dining-intro-copy">
          <p className="home-eyebrow home-eyebrow-dark">A seat at the table</p>
          <h2 id="dining-intro-title">Good food deserves<br /><em>good company.</em></h2>
          <p>Join us for a meal made to be enjoyed at your own pace. Choose a time and seating area that suits you, then make the evening yours.</p>
          <Link className="home-inline-link" href="/book/restaurant">Find your table <span aria-hidden="true">↗</span></Link>
        </div>
        <aside className="dining-hours-card" aria-label="Restaurant hours">
          <Image src="/images/grand-hibiscus-mark-black.png" alt="" width={280} height={256} className="dining-hours-mark" />
          <p className="home-eyebrow home-eyebrow-dark">Plan your visit</p>
          <h3>Restaurant hours</h3>
          <strong>{hours}</strong>
          <p>{hoursNote}</p>
        </aside>
      </section>

      <section className="dining-menu-section" id="menu" aria-labelledby="dining-menu-title">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow home-eyebrow-dark">From our kitchen</p>
            <h2 id="dining-menu-title">A taste of the menu.</h2>
          </div>
          <DiningMenuModal products={products} currency={settings.currency} />
        </div>
        {products.length > 0 ? (
          <div className="dining-menu-grid">
            {products.slice(0, 3).map((product) => {
              return (
                <article className="dining-menu-card" key={product.id}>
                  {product.photo_url ? (
                    <img className="dining-menu-image" src={product.photo_url} alt={product.name} loading="lazy" />
                  ) : (
                    <div className="dining-menu-image dining-menu-placeholder" aria-hidden="true">The Grand Hibiscus</div>
                  )}
                  <div className="dining-menu-copy">
                    {product.categories[0] && <p className="dining-menu-category">{product.categories[0].name}</p>}
                    <div className="dining-menu-heading">
                      <h3>{product.name}</h3>
                      <strong>{money(product.price, settings.currency)}</strong>
                    </div>
                    {product.description && <p>{product.description}</p>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="dining-menu-empty">Our menu preview is being prepared. You can still check table availability and plan your visit.</div>
        )}
      </section>

      <section className="dining-final-cta" aria-labelledby="dining-cta-title">
        <p className="home-eyebrow">Make an evening of it</p>
        <h2 id="dining-cta-title">Your table is<br />waiting to be found.</h2>
        <p>Choose your date, time, and party size to explore available seating.</p>
        <Link className="home-button home-button-gold" href="/book/restaurant">Reserve your table <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  )
}
