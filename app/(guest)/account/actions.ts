'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export type BirthdayClaimResult = { ok: boolean; message: string }

export async function claimMyBirthdayReward(): Promise<BirthdayClaimResult> {
  await requireRole(['customer'], '/account')
  const supabase = await createClient()
  const { data: balance, error } = await supabase.rpc('claim_my_birthday_reward')

  if (error) {
    const message = error.message.includes('birthday_reward_not_today')
      ? 'Your birthday gift can only be claimed on your birthday.'
      : error.message.includes('birthday_reward_already_claimed')
        ? 'You have already claimed this year’s birthday gift.'
        : error.message.includes('birthday_not_on_file')
          ? 'Please ask the front desk to add your birthday to your profile.'
          : `Could not claim your birthday gift: ${error.message}`
    return { ok: false, message }
  }
  if (typeof balance !== 'number') {
    return { ok: false, message: 'The birthday gift was not confirmed. Please refresh your account before trying again.' }
  }

  revalidatePath('/account')
  return { ok: true, message: 'Your 100 birthday points have been added to your account.' }
}
