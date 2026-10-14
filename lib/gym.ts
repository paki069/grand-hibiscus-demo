export const HOTEL_GYM_DISCOUNT_PERCENT = 35

export function priceHotelGymAccess(ratePerAdultPerNight: number, adults: number, nights: number) {
  const subtotal = Math.round(ratePerAdultPerNight * adults * nights * 100) / 100
  const total = Math.round(subtotal * (100 - HOTEL_GYM_DISCOUNT_PERCENT)) / 100
  return {
    subtotal,
    discount: Math.round((subtotal - total) * 100) / 100,
    total,
  }
}
