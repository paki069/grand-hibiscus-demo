import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminConfigured, createAdminClient } from '@/lib/supabase/admin'

type LogResource = 'notifications' | 'audit_log'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('role, active')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (profileError) {
    console.error('Could not verify admin access for log deletion:', profileError)
    return NextResponse.json({ error: 'admin_lookup_failed' }, { status: 500 })
  }
  if (profile?.role !== 'admin' || !profile.active) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body) || (body.resource !== 'notifications' && body.resource !== 'audit_log')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const resource: LogResource = body.resource
  const clearAll = body.clearAll === true
  if (clearAll === (body.id !== undefined)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const notificationId = typeof body.id === 'string' ? body.id : null
  if (!clearAll && resource === 'notifications'
    && (!notificationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId))) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const auditId = !clearAll && resource === 'audit_log' ? Number(body.id) : null
  if (!clearAll && resource === 'audit_log' && (auditId === null || !Number.isSafeInteger(auditId) || auditId < 1)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (!adminConfigured()) return NextResponse.json({ error: 'admin_client_not_configured' }, { status: 503 })
  const admin = createAdminClient()

  if (resource === 'notifications') {
    if (clearAll) {
      const result = await admin.from('notifications').delete({ count: 'exact' }).not('id', 'is', null)
      if (result.error) {
        console.error('Could not clear notification log entries:', result.error)
        return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
      }
      return NextResponse.json({ deleted: result.count ?? 0 })
    }
    if (!notificationId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const result = await admin.from('notifications').delete().eq('id', notificationId).select('id')
    if (result.error) {
      console.error('Could not delete notification log entry:', result.error)
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    }
    if (!result.data?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ deleted: result.data.length })
  }

  if (clearAll) {
    const result = await admin.from('audit_log').delete({ count: 'exact' }).not('id', 'is', null)
    if (result.error) {
      console.error('Could not clear audit log entries:', result.error)
      return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
    }
    return NextResponse.json({ deleted: result.count ?? 0 })
  }
  if (auditId === null) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const result = await admin.from('audit_log').delete().eq('id', auditId).select('id')
  if (result.error) {
    console.error('Could not delete audit log entry:', result.error)
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 })
  }
  if (!result.data?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deleted: result.data.length })
}
