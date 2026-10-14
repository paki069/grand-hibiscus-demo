import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/data'
import { fmtDateTime, money } from '@/lib/format'
import { Empty, Pill } from '@/components/ui'

export default async function Payments({ searchParams }: { searchParams: Promise<{ status?: string; method?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const s = await getSettings()
  let q = supabase.from('payments').select('id, method, status, amount, currency, receipt_path, created_at, reservations(id, reference, first_name, last_name)').order('created_at', { ascending: false }).limit(200)
  if (sp.status) q = q.eq('status', sp.status)
  if (sp.method) q = q.eq('method', sp.method)
  const { data, error } = await q
  const receiptEntries = await Promise.all((data ?? []).filter((payment) => payment.receipt_path).map(async (payment) => {
    const { data: signed, error: signedUrlError } = await supabase.storage.from('receipts').createSignedUrl(payment.receipt_path, 300)
    if (signedUrlError) {
      console.error('Could not create a review link for an uploaded payment receipt:', signedUrlError)
      return [payment.id, null] as const
    }
    return [payment.id, signed?.signedUrl ?? null] as const
  }))
  const receiptUrls = new Map(receiptEntries)
  return (
    <div className="stack">
      <h1>Payments & receipts</h1>
      <p className="muted small">Payment status is independent of booking and check-in status. Open a reservation to verify a receipt, mark paid or refund.</p>
      <form className="row" style={{ alignItems: 'end' }}>
        <label className="field">Status<select name="status" defaultValue={sp.status ?? ''}><option value="">All</option>{['unpaid', 'awaiting_receipt', 'pending_verification', 'paid', 'failed', 'partially_refunded', 'refunded'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field">Method<select name="method" defaultValue={sp.method ?? ''}><option value="">All</option>{['bank_transfer', 'cash_on_arrival', 'card', 'dev_test'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <button className="btn secondary">Filter</button>
      </form>
      {error && <div className="notice bad">Could not load payments.</div>}
      {(data ?? []).length === 0 ? <Empty>No payments match.</Empty> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>Reservation</th><th>Guest</th><th>Method</th><th>Amount</th><th>Receipt</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{(data as any[]).map((p) => (
            <tr key={p.id}><td><Link href={`/admin/reservations/${p.reservations?.id}`}>{p.reservations?.reference}</Link></td><td>{p.reservations?.first_name} {p.reservations?.last_name}</td>
              <td>{p.method === 'card' ? 'Credit Card' : p.method === 'cash_on_arrival' ? 'Cash/Card on arrival' : p.method.replaceAll('_', ' ')} {p.method === 'dev_test' && <span className="pill warn">DEV</span>}</td><td>{money(p.amount, p.currency)}</td>
              <td>{receiptUrls.get(p.id)
                ? <a href={receiptUrls.get(p.id)!} target="_blank" rel="noreferrer">Review receipt</a>
                : p.receipt_path ? 'Uploaded · open reservation' : '—'}</td>
              <td><Pill value={p.status} /></td><td className="nowrap">{fmtDateTime(p.created_at, s.timezone)}</td></tr>
          ))}</tbody></table></div>
      )}
    </div>
  )
}
