import {
  BedDouble,
  CarFront,
  Clock3,
  Coffee,
  Dumbbell,
  KeyRound,
  Luggage,
  MapPin,
  Plane,
  Sparkles,
  Utensils,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { createElement } from 'react'

export interface RoomUpgradeGroup<T> {
  id: string
  name: string
  icon: string
  combined: boolean
  upgrades: T[]
}

const ROOM_UPGRADE_ICONS = {
  'bed-double': BedDouble,
  'car-front': CarFront,
  'clock-3': Clock3,
  coffee: Coffee,
  dumbbell: Dumbbell,
  'key-round': KeyRound,
  luggage: Luggage,
  'map-pin': MapPin,
  plane: Plane,
  sparkles: Sparkles,
  utensils: Utensils,
  waves: Waves,
} satisfies Record<string, LucideIcon>

type RoomUpgradeIconName = keyof typeof ROOM_UPGRADE_ICONS

function isRoomUpgradeIconName(value: string): value is RoomUpgradeIconName {
  return Object.hasOwn(ROOM_UPGRADE_ICONS, value)
}

export function RoomUpgradeIcon({ name }: { name: string | null | undefined }) {
  const Icon = name && isRoomUpgradeIconName(name) ? ROOM_UPGRADE_ICONS[name] : Sparkles
  return createElement(Icon, { 'aria-hidden': true, className: 'room-upgrade-icon-svg' })
}

function defaultIcon(name: string) {
  if (/airport/i.test(name)) return 'plane'
  if (/check|early|late/i.test(name)) return 'clock-3'
  return 'sparkles'
}

export function groupRoomUpgrades<T extends { id: string; name: string; icon?: string | null }>(upgrades: T[]): RoomUpgradeGroup<T>[] {
  return upgrades.map((upgrade) => ({
    id: upgrade.id,
    name: upgrade.name,
    icon: upgrade.icon || defaultIcon(upgrade.name),
    combined: false,
    upgrades: [upgrade],
  }))
}
