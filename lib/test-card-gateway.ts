import 'server-only'
import { timingSafeEqual } from 'node:crypto'

export interface TestCardDetails {
  number: string
  expiry: string
  cvc: string
}

function normalizeNumber(value: string) {
  const normalized = value.trim()
  if (!/^[\d -]+$/.test(normalized)) return null
  const number = normalized.replace(/[ -]/g, '')
  return number.length >= 12 && number.length <= 19 ? number : null
}

function normalizeExpiry(value: string) {
  const normalized = value.trim()
  if (!/^\d{4}$|^\d{2}\s?\/\s?\d{2}(?:\d{2})?$/.test(normalized)) return null
  const valueDigits = normalized.replace(/\D/g, '')
  if (valueDigits.length === 6) return `${valueDigits.slice(0, 2)}${valueDigits.slice(-2)}`
  return valueDigits.length === 4 ? valueDigits : null
}

function normalizeCvc(value: string) {
  const normalized = value.trim()
  return /^\d{3,4}$/.test(normalized) ? normalized : null
}

function matches(input: string, expected: string) {
  const inputBuffer = Buffer.from(input)
  const expectedBuffer = Buffer.from(expected)
  return inputBuffer.length === expectedBuffer.length && timingSafeEqual(inputBuffer, expectedBuffer)
}

export function testCardGatewayAvailable() {
  const number = process.env.CARD_NUM
  const expiry = process.env.CARD_EXP
  const cvc = process.env.CARD_CVC
  return process.env.NODE_ENV !== 'production'
    && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
    && Boolean(number && normalizeNumber(number))
    && Boolean(expiry && normalizeExpiry(expiry))
    && Boolean(cvc && normalizeCvc(cvc))
}

export function approveTestCard(card: TestCardDetails) {
  if (!testCardGatewayAvailable()) return false
  const cardNumber = process.env.CARD_NUM
  const cardExpiry = process.env.CARD_EXP
  const cardCvc = process.env.CARD_CVC
  if (!cardNumber || !cardExpiry || !cardCvc) return false
  const inputNumber = normalizeNumber(card.number)
  const expectedNumber = normalizeNumber(cardNumber)
  const inputExpiry = normalizeExpiry(card.expiry)
  const expectedExpiry = normalizeExpiry(cardExpiry)
  const inputCvc = normalizeCvc(card.cvc)
  const expectedCvc = normalizeCvc(cardCvc)
  if (!inputNumber || !expectedNumber || !inputExpiry || !expectedExpiry || !inputCvc || !expectedCvc) return false

  return matches(inputNumber, expectedNumber)
    && matches(inputExpiry, expectedExpiry)
    && matches(inputCvc, expectedCvc)
}
