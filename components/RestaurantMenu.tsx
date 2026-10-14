'use client'

import { useMemo, useState } from 'react'
import { money } from '@/lib/format'

export interface ProductVM {
  id: string
  name: string
  description: string
  price: number
  photo_url: string | null
  categories: { name: string; sort_order: number }[]
}

export default function RestaurantMenu({
  products,
  currency,
  headingId,
  showHeading = true,
}: {
  products: ProductVM[]
  currency: string
  headingId?: string
  showHeading?: boolean
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(() => new Set())
  const categories = useMemo(() => {
    const ordered = new Map<string, number>()
    for (const product of products) {
      for (const category of product.categories) {
        ordered.set(category.name, Math.min(ordered.get(category.name) ?? category.sort_order, category.sort_order))
      }
    }
    return [...ordered].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  }, [products])
  const visibleProducts = products.filter((product) =>
    activeCategory === null || product.categories.some((category) => category.name === activeCategory),
  )

  function toggleExpanded(id: string) {
    setExpandedProducts((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="stack restaurant-menu">
      {showHeading && (
        <div>
          <h2 id={headingId} style={{ marginBottom: '.2rem' }}>Restaurant menu</h2>
          <p className="small muted" style={{ margin: 0 }}>Browse our dishes by category. Menu items are for viewing only.</p>
        </div>
      )}
      <div className="menu-category-tabs" role="tablist" aria-label="Menu categories">
        {[{ name: 'All', value: null }, ...categories.map((name) => ({ name, value: name }))].map((category) => (
          <button
            key={category.name}
            type="button"
            role="tab"
            aria-selected={activeCategory === category.value}
            className={`menu-category-tab ${activeCategory === category.value ? 'active' : ''}`}
            onClick={() => setActiveCategory(category.value)}
          >{category.name}</button>
        ))}
      </div>
      {visibleProducts.length === 0 ? <div className="empty">No menu items are available yet.</div> : (
        <div className="menu-product-grid">
          {visibleProducts.map((product) => {
            const expanded = expandedProducts.has(product.id)
            const detailsId = `menu-details-${product.id}`
            return (
              <article key={product.id} className="card menu-product-card">
                {product.photo_url
                  ? <img className="menu-product-image" src={product.photo_url} alt={product.name} loading="lazy" />
                  : <div className="menu-product-image menu-product-placeholder">The Grand Hibiscus</div>}
                <div className="menu-product-content stack">
                  <div className="row between menu-product-heading">
                    <h3>{product.name}</h3><strong>{money(product.price, currency)}</strong>
                  </div>
                  {product.categories.length > 0 && <div className="menu-product-category">{product.categories.map((category) => category.name).join(' · ')}</div>}
                  <p id={detailsId} className={`small muted menu-product-description ${expanded ? 'expanded' : ''}`}>
                    {product.description || 'A freshly prepared selection from our kitchen.'}
                  </p>
                  <button
                    className="menu-details-toggle"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => toggleExpanded(product.id)}
                  >{expanded ? 'Show less' : 'Details'}</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
