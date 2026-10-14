import { getSettings } from '@/lib/data'
import SettingsForm from '@/components/SettingsForm'

export default async function SettingsPage() {
  const s = await getSettings()
  return (
    <div className="stack">
      <h1>Settings</h1>
      <SettingsForm initial={s as any} />
    </div>
  )
}
