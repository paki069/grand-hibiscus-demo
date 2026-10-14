export interface RoomBookingOption {
  id?: string
  name: string
  total?: number | string
  details?: string
}

interface OptionRecord {
  id?: string
  kind?: string
  name?: string
  total?: number | string
  price?: number | string
  details?: string
}

function optionRecords(value: unknown): OptionRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is OptionRecord => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
}

function normalizeOption(option: OptionRecord): RoomBookingOption | null {
  if (typeof option.name !== 'string' || !option.name.trim()) return null
  const value = option.total ?? option.price
  const amount = typeof value === 'number' || (typeof value === 'string' && Number.isFinite(Number(value)))
    ? value
    : undefined
  return {
    ...(typeof option.id === 'string' ? { id: option.id } : {}),
    name: option.name.trim(),
    ...(amount !== undefined ? { total: amount } : {}),
    ...(typeof option.details === 'string' && option.details.trim() ? { details: option.details.trim() } : {}),
  }
}

export function getRoomBookingOptions(meta: unknown): { addons: RoomBookingOption[]; upgrades: RoomBookingOption[] } {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return { addons: [], upgrades: [] }
  const data = meta as Record<string, unknown>
  const storedAddons = optionRecords(data.addons)
  const addons = storedAddons
    .filter((option) => option.kind !== 'upgrade')
    .map(normalizeOption)
    .filter((option): option is RoomBookingOption => option !== null)
  const upgrades = optionRecords(data.room_upgrades)
    .map(normalizeOption)
    .filter((option): option is RoomBookingOption => option !== null)
  const upgradeIds = new Set(upgrades.flatMap((option) => option.id ? [option.id] : []))
  const legacyUpgrades = storedAddons
    .filter((option) => option.kind === 'upgrade')
    .map(normalizeOption)
    .filter((option): option is RoomBookingOption => option !== null && (!option.id || !upgradeIds.has(option.id)))
  return { addons, upgrades: [...upgrades, ...legacyUpgrades] }
}
