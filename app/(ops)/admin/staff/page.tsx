import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import StaffManager from '@/components/StaffManager'

export default async function StaffPage() {
  const me = await requireRole(['admin'], '/admin/staff')
  const supabase = await createClient()
  const { data, error } = await supabase.from('profiles').select('id, email, first_name, last_name, role, staff_areas, active').in('role', ['admin', 'staff']).order('created_at')
  if (error) throw new Error(`Could not load staff accounts: ${error.message}`)
  const inactiveStaffIds = (data ?? []).filter((profile) => profile.role === 'staff' && !profile.active).map((profile) => profile.id)
  const { data: registrationEvents, error: eventsError } = inactiveStaffIds.length
    ? await supabase
      .from('audit_log')
      .select('entity_id, action')
      .eq('entity_type', 'profile')
      .in('entity_id', inactiveStaffIds)
      .in('action', ['admin_registration.pending', 'admin_registration.approved'])
      .order('at', { ascending: false })
    : { data: [], error: null }
  if (eventsError) throw new Error(`Could not load registration approvals: ${eventsError.message}`)
  const latestRegistrationAction = new Map<string, string>()
  for (const event of registrationEvents ?? []) {
    if (event.entity_id && !latestRegistrationAction.has(event.entity_id)) {
      latestRegistrationAction.set(event.entity_id, event.action)
    }
  }
  const rows = (data ?? []).map((profile) => ({
    ...profile,
    admin_approval_pending: profile.role === 'staff' && !profile.active && latestRegistrationAction.get(profile.id) === 'admin_registration.pending',
  }))
  return (
    <div className="stack">
      <h1>Staff accounts</h1>
      <p className="muted small">Staff can only use the scanner and the service list for their assigned areas, and see only a guest’s first name and last initial. New team registrations remain inactive until approved here.</p>
      <StaffManager rows={rows as any} me={me.id} />
    </div>
  )
}
