import 'server-only'
import nodemailer from 'nodemailer'

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim()
  const port = Number(process.env.SMTP_PORT?.trim() || '587')
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  const fromName = process.env.EMAIL_FROM?.trim()
  const secure = process.env.SMTP_SECURE?.trim().toLowerCase() === 'true'

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !fromName) return null
  return { host, port, user, pass, fromName, secure }
}

export const emailConfigured = () => getSmtpConfig() !== null

export type SendResult = { status: 'sent' | 'not_configured' | 'failed'; error?: string }

export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType: string
  contentDisposition?: 'inline' | 'attachment'
  cid?: string
}

/** Sends through the configured SMTP provider. Never reports success without SMTP credentials. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  options: { html?: string; attachments?: EmailAttachment[]; replyTo?: string } = {},
): Promise<SendResult> {
  const config = getSmtpConfig()
  if (!config) return { status: 'not_configured' }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    })

    await transporter.sendMail({
      from: { name: config.fromName, address: config.user },
      to,
      subject,
      text,
      ...options,
    })
    return { status: 'sent' }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'SMTP send failed' }
  }
}
