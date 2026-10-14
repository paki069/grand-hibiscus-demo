'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/format'

interface SpaServiceOption {
  id: string
  name: string
  duration_min: number
}

interface WeekdaySchedule {
  weekday: number
  label: string
  open: boolean
  start_time: string
  end_time: string
  capacity: number
}

const WEEKDAYS = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
]

function emptyWeek(): WeekdaySchedule[] {
  return WEEKDAYS.map((day) => ({
    ...day,
    open: false,
    start_time: '',
    end_time: '',
    capacity: 1,
  }))
}

export default function SpaWeeklyAvailability({ services }: { services: SpaServiceOption[] }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '')
  const [week, setWeek] = useState<WeekdaySchedule[]>(emptyWeek)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!serviceId) {
        setWeek(emptyWeek())
        setLoading(false)
        setError(null)
        setSuccess(null)
        setDirty(false)
        return
      }
      setLoading(true)
      setError(null)
      setSuccess(null)
      setDirty(false)
      const { data, error: loadError } = await createClient()
        .from('spa_service_availability')
        .select('weekday, start_time, end_time, capacity')
        .eq('service_id', serviceId)
        .not('weekday', 'is', null)
      if (cancelled) return
      setLoading(false)
      if (loadError) {
        setError(friendlyError(loadError))
        setWeek(emptyWeek())
        setDirty(false)
        return
      }

      const byDay = new Map((data ?? []).map((entry) => [entry.weekday, entry]))
      setWeek(WEEKDAYS.map((day) => {
        const entry = byDay.get(day.weekday)
        return {
          ...day,
          open: !!entry,
          start_time: entry?.start_time?.slice(0, 5) ?? '',
          end_time: entry?.end_time?.slice(0, 5) ?? '',
          capacity: entry?.capacity ?? 1,
        }
      }))
      setDirty(false)
    }

    load()
    return () => { cancelled = true }
  }, [serviceId])

  const service = services.find((option) => option.id === serviceId)

  function changeService(nextServiceId: string) {
    if (dirty && !window.confirm('Discard unsaved weekly hours?')) return
    setDirty(false)
    setServiceId(nextServiceId)
  }

  function updateDay(weekday: number, changes: Partial<WeekdaySchedule>) {
    setWeek((current) => current.map((day) => day.weekday === weekday ? { ...day, ...changes } : day))
    setDirty(true)
    setError(null)
    setSuccess(null)
  }

  async function save() {
    if (!serviceId || saving || loading) return
    const invalidDay = week.find((day) => day.open && (
      !day.start_time || !day.end_time || day.end_time <= day.start_time
      || !Number.isInteger(day.capacity) || day.capacity < 1 || day.capacity > 100
    ))
    if (invalidDay) {
      setError(`Check ${invalidDay.label}: enter valid opening/closing times and a capacity from 1 to 100.`)
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    const { error: saveError } = await createClient().rpc('save_spa_weekly_availability', {
      p_service: serviceId,
      p_schedule: week.map(({ weekday, open, start_time, end_time, capacity }) => ({
        weekday,
        open,
        start_time: start_time || null,
        end_time: end_time || null,
        capacity,
      })),
    })
    setSaving(false)
    if (saveError) {
      setError(friendlyError(saveError))
      return
    }
    setDirty(false)
    setSuccess('Weekly hours saved.')
  }

  if (services.length === 0) return <div className="empty">Add a spa service before setting weekly hours.</div>

  return (
    <section className="stack">
      <label className="field spa-week-service">
        Service
        <select value={serviceId} disabled={saving} onChange={(event) => changeService(event.target.value)}>
          {services.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      {service && <p className="small muted spa-week-note">
        Each available start time is {service.duration_min} minutes apart. The last appointment must finish by closing time.
      </p>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {success && <div className="notice ok" role="status">{success}</div>}
      {loading
        ? <div className="muted"><span className="spinner" /> Loading weekly hours…</div>
        : <div className="table-wrap">
          <table className="data spa-week-table">
            <thead>
              <tr><th>Day</th><th>Open</th><th>Opens at</th><th>Closes at</th><th>Bookings per time slot</th></tr>
            </thead>
            <tbody>
              {week.map((day) => (
                <tr key={day.weekday}>
                  <td><strong>{day.label}</strong></td>
                  <td><input aria-label={`${day.label} open`} type="checkbox" checked={day.open} disabled={saving}
                    onChange={(event) => updateDay(day.weekday, { open: event.target.checked })} /></td>
                  <td><input aria-label={`${day.label} opens at`} type="time" step={900} value={day.start_time}
                    disabled={!day.open || saving} onChange={(event) => updateDay(day.weekday, { start_time: event.target.value })} /></td>
                  <td><input aria-label={`${day.label} closes at`} type="time" step={900} value={day.end_time}
                    disabled={!day.open || saving} onChange={(event) => updateDay(day.weekday, { end_time: event.target.value })} /></td>
                  <td><input aria-label={`${day.label} bookings per time slot`} type="number" min={1} max={100} step={1}
                    value={day.capacity} disabled={!day.open || saving}
                    onChange={(event) => updateDay(day.weekday, { capacity: Number(event.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      <div className="row">
        <button className="btn" type="button" disabled={!dirty || saving || loading || !!error} onClick={save}>
          {saving ? <span className="spinner" /> : 'Save weekly hours'}
        </button>
      </div>
    </section>
  )
}
