export type Tone = 'ok' | 'warn' | 'bad' | 'info' | ''

const TONES: Record<string, Tone> = {
  confirmed: 'ok', paid: 'ok', valid: 'ok', active: 'ok', completed: 'ok', checked_in: 'ok', sent: 'ok', won: 'ok',
  pending: 'warn', awaiting_receipt: 'warn', pending_verification: 'info', unpaid: 'warn', held: 'warn', new: 'info',
  not_configured: 'warn', queued: 'warn', partially_refunded: 'warn', contacted: 'info', qualified: 'info',
  cancelled: 'bad', failed: 'bad', refunded: 'bad', expired: 'bad', revoked: 'bad', lost: 'bad',
}

export function Pill({ value, label }: { value: string; label?: string }) {
  return <span className={`pill ${TONES[value] ?? ''}`}>{(label ?? value).replaceAll('_', ' ')}</span>
}

export function Notice({ tone = 'info', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info'; children: React.ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export const safeNext = (n: string | undefined | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')
