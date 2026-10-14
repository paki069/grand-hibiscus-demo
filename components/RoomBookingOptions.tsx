import { getRoomBookingOptions } from '@/lib/room-booking-options'
import { money } from '@/lib/format'

export default function RoomBookingOptions({ meta, currency, admin = false }: {
  meta: unknown
  currency: string
  admin?: boolean
}) {
  const { addons, upgrades } = getRoomBookingOptions(meta)
  if (addons.length === 0 && upgrades.length === 0) return null

  return (
    <div className={`${admin ? 'notice info ' : ''}small room-booking-options`}>
      {admin && <strong>Guest-selected room add-ons and upgrades</strong>}
      {addons.length > 0 && <div>
        <strong>Room add-ons:</strong>
        {addons.map((option, index) => (
          <div key={option.id ?? `${option.name}:${index}`}>
            {option.name}{option.total !== undefined && ` · ${money(option.total, currency)}`}
          </div>
        ))}
      </div>}
      {upgrades.length > 0 && <div>
        <strong>Room upgrades:</strong>
        {upgrades.map((option, index) => (
          <div key={option.id ?? `${option.name}:${index}`}>
            {option.name}{option.total !== undefined && ` · ${money(option.total, currency)}`}
            {option.details && <div>{admin ? 'Guest details: ' : 'Details: '}{option.details}</div>}
          </div>
        ))}
      </div>}
    </div>
  )
}
