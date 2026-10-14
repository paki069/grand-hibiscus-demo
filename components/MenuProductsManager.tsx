'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError, money } from '@/lib/format'
import { ImageUpload } from '@/components/ResourceManager'

interface Category { id: string; name: string }
interface Product {
  id: string
  name: string
  description: string
  price: number
  photo_url: string | null
  available: boolean
  active: boolean
  categories: Category[]
}
interface ProductForm {
  name: string
  description: string
  price: number
  photo_url: string | null
  available: boolean
  active: boolean
  category_ids: string[]
}

const emptyForm = (): ProductForm => ({
  name: '', description: '', price: 0, photo_url: null, available: true, active: true, category_ids: [],
})

export default function MenuProductsManager({ categories, currency }: { categories: Category[]; currency: string }) {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from('menu_products')
      .select('id,name,description,price,photo_url,available,active,menu_product_categories(category_id,menu_categories(id,name))')
      .order('name')
    if (error) { setError(friendlyError(error)); return }
    setError(null)
    setProducts((data ?? []).map((product: any) => ({
      ...product,
      categories: (product.menu_product_categories ?? []).map((link: any) => link.menu_categories).filter(Boolean),
    })))
  }, [])

  useEffect(() => { void load() }, [load])

  function begin(product?: Product) {
    setError(null)
    setFlash(null)
    setEditingId(product?.id ?? null)
    setForm(product ? {
      name: product.name,
      description: product.description,
      price: Number(product.price),
      photo_url: product.photo_url,
      available: product.available,
      active: product.active,
      category_ids: product.categories.map((category) => category.id),
    } : emptyForm())
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    const { error } = await createClient().rpc('admin_save_menu_product', {
      p_id: editingId,
      p_name: form.name,
      p_description: form.description,
      p_price: form.price,
      p_photo_url: form.photo_url,
      p_available: form.available,
      p_active: form.active,
      p_category_ids: form.category_ids,
    })
    setSaving(false)
    if (error) { setError(friendlyError(error)); return }
    setFlash(editingId ? 'Product saved.' : 'Product created.')
    setForm(null)
    await load()
  }

  async function remove(product: Product) {
    if (!confirm(`Delete ${product.name}?`)) return
    const { error } = await createClient().from('menu_products').delete().eq('id', product.id)
    if (error) { setError(friendlyError(error)); return }
    setFlash('Product deleted.')
    await load()
  }

  const visible = (products ?? []).filter((product) =>
    (!filter || `${product.name} ${product.categories.map((category) => category.name).join(' ')}`.toLowerCase().includes(filter.toLowerCase()))
    && (!categoryFilter || product.categories.some((category) => category.id === categoryFilter)),
  )

  return (
    <section className="stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Menu products</h2>
        <div className="row">
          <input aria-label="Filter menu products" placeholder="Filter…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <select aria-label="Filter menu products by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <button className="btn" onClick={() => begin()}>+ New</button>
        </div>
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {flash && <div className="notice ok" role="status">{flash}</div>}
      {products === null ? (error
        ? <button className="btn secondary" onClick={() => { void load() }}>Retry loading menu products</button>
        : <div className="muted"><span className="spinner" /> Loading menu products…</div>
      ) : visible.length === 0 ? <div className="empty">{products.length === 0 ? 'No menu products yet.' : 'No products match those filters.'}</div> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Product</th><th>Categories</th><th>Price</th><th>Available</th><th>Active</th><th /></tr></thead>
          <tbody>{visible.map((product) => (
            <tr key={product.id}>
              <td>{product.photo_url && <img src={product.photo_url} alt="" width={48} height={48} style={{ objectFit: 'cover', borderRadius: 6, verticalAlign: 'middle', marginRight: 8 }} />}<strong>{product.name}</strong></td>
              <td>{product.categories.map((category) => category.name).join(', ') || '—'}</td>
              <td>{money(Number(product.price), currency)}</td>
              <td>{product.available ? 'Yes' : 'No'}</td>
              <td>{product.active ? 'Yes' : 'No'}</td>
              <td className="nowrap right"><button className="btn sm secondary" onClick={() => begin(product)}>Edit</button>{' '}<button className="btn sm danger" onClick={() => remove(product)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {form && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="Menu product">
          <form className="modal stack" onSubmit={save}>
            <h3 style={{ margin: 0 }}>{editingId ? 'Edit' : 'New'} · Menu product</h3>
            <label className="field">Name *<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label className="field">Categories
              <select multiple size={Math.min(Math.max(categories.length, 3), 8)} value={form.category_ids} onChange={(event) => setForm({ ...form, category_ids: Array.from(event.target.selectedOptions, (option) => option.value) })}>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <span className="help">Use Ctrl (Windows) or Command (Mac) to select multiple categories.</span>
            </label>
            <label className="field">Price *<input type="number" min="0" step="0.01" required value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} /></label>
            <label className="field">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label className="field">Photo<ImageUpload value={form.photo_url ? [form.photo_url] : []} onChange={(urls) => setForm({ ...form, photo_url: urls[0] ?? null })} /></label>
            <label className="field">Available today<input type="checkbox" checked={form.available} onChange={(event) => setForm({ ...form, available: event.target.checked })} /></label>
            <label className="field">Active<input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /></label>
            {error && <div className="notice bad" role="alert">{error}</div>}
            <div className="row between"><button type="button" className="btn secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn" disabled={saving}>{saving ? <span className="spinner" /> : 'Save'}</button></div>
          </form>
        </div>
      )}
    </section>
  )
}
