'use server'

import { revalidatePath } from 'next/cache'
import { allowedAreas, requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export interface BirthdayGuest {
  customer_id: string
  first_name: string | null
  last_name: string | null
  birthday: string | null
  birthday_today: boolean
  already_claimed: boolean
}

export type BirthdayLookupResult = {
  ok: boolean
  message: string
  guest?: BirthdayGuest
}

function canRedeemBirthdays(me: Awaited<ReturnType<typeof requireRole>>) {
  return allowedAreas(me).includes('hotel')
}

export async function findBirthdayGuest(emailValue: string): Promise<BirthdayLookupResult> {
  const me = await requireRole(['admin', 'staff'], '/staff/birthday')
  if (!canRedeemBirthdays(me)) return { ok: false, message: 'Hotel staff access is required.' }
  const email = emailValue.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, message: 'Enter a valid guest email address.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_find_birthday_guest', { p_email: email })
  if (error) return { ok: false, message: `Could not look up this guest: ${error.message}` }
  const guest = data?.[0] as BirthdayGuest | undefined
  if (!guest) return { ok: false, message: 'No guest account found with that email address.' }
  return { ok: true, message: 'Guest found.', guest }
}

export async function redeemBirthdayGift(customerId: string): Promise<{ ok: boolean; message: string }> {
  const me = await requireRole(['admin', 'staff'], '/staff/birthday')
  if (!canRedeemBirthdays(me)) return { ok: false, message: 'Hotel staff access is required.' }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(customerId)) {
    return { ok: false, message: 'Invalid guest account.' }
  }

  const supabase = await createClient()
  const { data: balance, error } = await supabase.rpc('staff_award_birthday_reward', { p_customer: customerId })
  if (error) {
    const message = error.message.includes('birthday_reward_not_today')
      ? 'This guest’s birthday gift can only be redeemed on their birthday.'
      : error.message.includes('birthday_reward_already_claimed')
        ? 'This guest has already claimed this year’s birthday gift.'
        : error.message.includes('birthday_not_on_file')
          ? 'This guest does not have a birthday on file.'
          : `Could not redeem the birthday gift: ${error.message}`
    return { ok: false, message }
  }
  if (typeof balance !== 'number') return { ok: false, message: 'The birthday gift was not confirmed. Please check the guest’s account before retrying.' }

  revalidatePath('/staff/birthday')
  revalidatePath('/account')
  return { ok: true, message: `100 birthday points added. The guest’s new balance is ${balance.toLocaleString()} points.` }
}
