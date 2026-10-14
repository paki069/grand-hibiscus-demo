export interface ConfirmationEmailItem {
  category: string
  title: string
  detail: string
  when: string
  party: string
  total: string
  options?: { category: string; name: string; total: string; details?: string }[]
}

export interface ConfirmationEmailData {
  hotelName: string
  firstName: string
  reference: string
  status: string
  items: ConfirmationEmailItem[]
  payments: string[]
  subtotal: string
  taxes: string
  fees: string
  total: string
  accountUrl: string
  hasQrPass: boolean
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

export function renderConfirmationEmail(data: ConfirmationEmailData) {
  const hotelName = escapeHtml(data.hotelName)
  const firstName = escapeHtml(data.firstName || 'Guest')
  const reference = escapeHtml(data.reference)
  const accountUrl = escapeHtml(data.accountUrl)
  const confirmed = data.status === 'confirmed'
  const heading = confirmed ? 'Your booking is confirmed' : 'We received your booking'
  const intro = confirmed
    ? 'Everything is set. Here are your booking details and the pass to show our team.'
    : `Your booking is currently ${escapeHtml(data.status)}. You can review its latest details in your account.`

  const itemRows = data.items.length
    ? data.items.map((item) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;background:#f4f8f5;border:1px solid #dce9df;border-radius:10px;">
        <tr><td style="padding:16px 18px;border-left:4px solid #34775e;">
          <p style="margin:0 0 5px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#34775e;">${escapeHtml(item.category)}</p>
          <h3 style="margin:0;font:600 18px/1.35 Georgia,'Times New Roman',serif;color:#173b30;">${escapeHtml(item.title)}</h3>
          ${item.detail ? `<p style="margin:6px 0 0;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#5d6f65;">${escapeHtml(item.detail)}</p>` : ''}
          ${item.options?.length ? `<div style="margin-top:10px;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#40574b;">${item.options.map((option) => `<p style="margin:4px 0;"><strong>${escapeHtml(option.category)}:</strong> ${escapeHtml(option.name)}${option.total ? ` · ${escapeHtml(option.total)}` : ''}${option.details ? `<br><span style="color:#65756c;">Guest details: ${escapeHtml(option.details)}</span>` : ''}</p>`).join('')}</div>` : ''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;font:400 13px/1.5 Arial,Helvetica,sans-serif;">
            ${item.when ? `<tr><td style="padding:3px 12px 3px 0;color:#65756c;width:82px;">When</td><td style="padding:3px 0;color:#263d33;font-weight:600;">${escapeHtml(item.when)}</td></tr>` : ''}
            ${item.party ? `<tr><td style="padding:3px 12px 3px 0;color:#65756c;">Guests</td><td style="padding:3px 0;color:#263d33;">${escapeHtml(item.party)}</td></tr>` : ''}
            ${item.total ? `<tr><td style="padding:3px 12px 3px 0;color:#65756c;">Item total</td><td style="padding:3px 0;color:#263d33;">${escapeHtml(item.total)}</td></tr>` : ''}
          </table>
        </td></tr>
      </table>`).join('')
    : '<p style="margin:0;color:#65756c;font:400 14px/1.5 Arial,Helvetica,sans-serif;">Booking details are available in your account.</p>'

  const qrContent = data.hasQrPass
    ? `<p style="margin:0 0 14px;font:600 16px/1.4 Arial,Helvetica,sans-serif;color:#173b30;">Your reservation pass</p>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;background:#fff;border:1px solid #d8e4db;border-radius:12px;"><tr><td style="padding:12px;">
         <img src="cid:reservation-pass" width="190" height="190" alt="QR pass for reservation ${reference}" style="display:block;width:190px;height:190px;border:0;">
       </td></tr></table>
       <p style="margin:12px 0 0;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#5d6f65;">Show this code to our team for check-in. Keep it private.</p>`
    : `<p style="margin:0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#5d6f65;">Your QR pass will appear in your account when it is available. Use reference <strong style="color:#173b30;">${reference}</strong> if you need help.</p>`

  const paymentRows = data.payments.length
    ? data.payments.map((payment) => `<tr><td style="padding:5px 0;color:#65756c;">${escapeHtml(payment)}</td></tr>`).join('')
    : '<tr><td style="padding:5px 0;color:#65756c;">No payment is required at this time.</td></tr>'

  const textItems = data.items.map((item) => [
    `${item.category}: ${item.title}`,
    item.detail,
    ...(item.options ?? []).map((option) => `${option.category}: ${option.name}${option.total ? ` · ${option.total}` : ''}${option.details ? `\nGuest details: ${option.details}` : ''}`),
    item.when ? `When: ${item.when}` : '',
    item.party ? `Guests: ${item.party}` : '',
    item.total ? `Item total: ${item.total}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  const text = [
    `Hello ${data.firstName || 'Guest'},`,
    '',
    `${heading} at ${data.hotelName}.`,
    `Reservation: ${data.reference}`,
    `Status: ${data.status}`,
    '',
    'WHAT YOU BOOKED',
    textItems || 'View your booking details in your account.',
    '',
    `Subtotal: ${data.subtotal}`,
    `Taxes: ${data.taxes}`,
    `Fees: ${data.fees}`,
    `Total: ${data.total}`,
    '',
    'PAYMENT',
    data.payments.join('\n') || 'No payment is required at this time.',
    '',
    data.hasQrPass ? 'Your QR pass is attached to this email. Show it to our team at check-in and keep it private.' : 'Your QR pass will appear in your account when it is available.',
    `View your booking: ${data.accountUrl}`,
    '',
    `Our team at ${data.hotelName} is happy to help if you have any questions.`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(heading)} · ${reference}</title></head>
<body style="margin:0;padding:0;background:#eef3ef;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef3ef;">${escapeHtml(heading)} · ${reference}. Your booking details and QR pass are inside.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3ef;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
        <tr><td style="padding:26px 30px 28px;background:#1f4d45;border-radius:14px 14px 0 0;border-bottom:4px solid #b8893b;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="48" valign="middle"><div style="width:38px;height:38px;border:1px solid #a9c7b7;border-radius:50%;text-align:center;font:600 13px/38px Georgia,'Times New Roman',serif;color:#fff;">GH</div></td>
            <td valign="middle" style="padding-left:10px;font:600 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.4px;color:#e8f1eb;">${hotelName}</td>
          </tr></table>
          <p style="margin:26px 0 7px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1.7px;text-transform:uppercase;color:#c8d9ce;">${confirmed ? 'Booking confirmed' : 'Booking update'}</p>
          <h1 style="margin:0;font:400 30px/1.2 Georgia,'Times New Roman',serif;color:#fff;">${escapeHtml(heading)}, ${firstName}.</h1>
          <p style="margin:12px 0 0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#d8e6dc;">${intro}</p>
          <p style="margin:18px 0 0;font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#e8f1eb;">REFERENCE <strong style="color:#fff;letter-spacing:.6px;">${reference}</strong></p>
        </td></tr>
        <tr><td style="padding:26px 30px 12px;background:#fff;">
          <h2 style="margin:0 0 15px;font:400 23px/1.3 Georgia,'Times New Roman',serif;color:#1f4d45;">What you booked</h2>
          ${itemRows}
        </td></tr>
        <tr><td align="center" style="padding:24px 30px 28px;background:#f4f8f5;border-top:1px solid #e0e9e2;border-bottom:1px solid #e0e9e2;">
          ${qrContent}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px auto 0;"><tr><td align="center" style="background:#1f4d45;border-radius:7px;">
            <a href="${accountUrl}" style="display:inline-block;padding:13px 23px;font:600 14px/1 Arial,Helvetica,sans-serif;color:#fff;text-decoration:none;">View booking in your account</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:24px 30px;background:#fff;">
          <h2 style="margin:0 0 11px;font:400 19px/1.3 Georgia,'Times New Roman',serif;color:#1f4d45;">Payment summary</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font:400 14px/1.5 Arial,Helvetica,sans-serif;">
            ${paymentRows}
            <tr><td style="padding:10px 0 3px;border-top:1px solid #e0e9e2;color:#65756c;">Subtotal</td><td align="right" style="padding:10px 0 3px;border-top:1px solid #e0e9e2;color:#263d33;">${escapeHtml(data.subtotal)}</td></tr>
            <tr><td style="padding:3px 0;color:#65756c;">Taxes</td><td align="right" style="padding:3px 0;color:#263d33;">${escapeHtml(data.taxes)}</td></tr>
            <tr><td style="padding:3px 0 10px;color:#65756c;">Fees</td><td align="right" style="padding:3px 0 10px;color:#263d33;">${escapeHtml(data.fees)}</td></tr>
            <tr><td style="padding:12px 0 0;border-top:1px solid #d7e3da;font:700 16px/1.4 Arial,Helvetica,sans-serif;color:#173b30;">Total</td><td align="right" style="padding:12px 0 0;border-top:1px solid #d7e3da;font:700 16px/1.4 Arial,Helvetica,sans-serif;color:#173b30;">${escapeHtml(data.total)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 30px 24px;background:#1f4d45;border-radius:0 0 14px 14px;">
          <p style="margin:0;font:400 13px/1.65 Arial,Helvetica,sans-serif;color:#e1ebe4;">Need help with your booking? Reply to this email and our team at ${hotelName} will be glad to assist.</p>
          <p style="margin:12px 0 0;font:400 11px/1.5 Arial,Helvetica,sans-serif;color:#c8d9ce;">Please keep your QR pass private. It is used by our team to verify your reservation.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { text, html }
}
