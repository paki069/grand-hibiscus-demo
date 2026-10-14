export interface CancellationEmailData {
  hotelName: string
  firstName: string
  reference: string
  cancelledAt: string
  reason: string
  cancellationFee: string
  total: string
  services: { category: string; title: string; when: string }[]
  payments: string[]
  accountUrl: string
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

export function renderCancellationEmail(data: CancellationEmailData) {
  const hotelName = escapeHtml(data.hotelName)
  const firstName = escapeHtml(data.firstName || 'Guest')
  const reference = escapeHtml(data.reference)
  const accountUrl = escapeHtml(data.accountUrl)
  const services = data.services.length
    ? data.services.map((service) => [
      `${service.category}: ${service.title}`,
      service.when ? `When: ${service.when}` : '',
    ].filter(Boolean).join('\n')).join('\n\n')
    : 'See your account for the original booking details.'
  const payments = data.payments.join('\n') || 'No payment was recorded.'
  const serviceRows = data.services.length
    ? data.services.map((service) => `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e0e9e2;">
          <strong style="color:#173b30;">${escapeHtml(service.title)}</strong>
          <div style="margin-top:4px;font:400 12px/1.5 Arial,Helvetica,sans-serif;color:#65756c;">${escapeHtml(service.category)}${service.when ? ` · ${escapeHtml(service.when)}` : ''}</div>
        </td>
      </tr>`).join('')
    : '<tr><td style="padding:12px 14px;color:#65756c;">See your account for the original booking details.</td></tr>'
  const paymentRows = data.payments.length
    ? data.payments.map((payment) => `<tr><td style="padding:4px 0;color:#52675c;">${escapeHtml(payment)}</td></tr>`).join('')
    : '<tr><td style="padding:4px 0;color:#52675c;">No payment was recorded.</td></tr>'
  const text = [
    `Hello ${data.firstName || 'Guest'},`,
    '',
    `Your booking at ${data.hotelName} has been cancelled.`,
    `Reservation: ${data.reference}`,
    `Cancelled: ${data.cancelledAt}`,
    `Reason: ${data.reason}`,
    '',
    'CANCELLED SERVICES',
    services,
    '',
    `Cancellation fee recorded: ${data.cancellationFee}`,
    `Original booking total: ${data.total}`,
    '',
    'PAYMENT STATUS',
    payments,
    '',
    `View your reservation: ${data.accountUrl}`,
    '',
    `Our team at ${data.hotelName} is happy to help if you have any questions.`,
  ].join('\n')
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Booking cancelled · ${reference}</title></head>
<body style="margin:0;padding:0;background:#eef3ef;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef3ef;">Your booking ${reference} has been cancelled.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3ef;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#fff;">
        <tr><td style="padding:26px 30px 28px;background:#1f4d45;border-bottom:4px solid #b8893b;">
          <p style="margin:0 0 22px;font:600 13px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.4px;color:#e8f1eb;">${hotelName}</p>
          <p style="margin:0 0 7px;font:600 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:1.7px;text-transform:uppercase;color:#c8d9ce;">Booking update · ${reference}</p>
          <h1 style="margin:0;font:400 30px/1.2 Georgia,'Times New Roman',serif;color:#fff;">Your booking was cancelled, ${firstName}.</h1>
          <p style="margin:12px 0 0;font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#d8e6dc;">We have updated your reservation. The cancellation details are below.</p>
        </td></tr>
        <tr><td style="padding:24px 30px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font:400 13px/1.6 Arial,Helvetica,sans-serif;">
            <tr><td style="padding:4px 0;color:#65756c;">Reference</td><td align="right" style="padding:4px 0;color:#173b30;font-weight:600;">${reference}</td></tr>
            <tr><td style="padding:4px 0;color:#65756c;">Cancelled</td><td align="right" style="padding:4px 0;color:#263d33;">${escapeHtml(data.cancelledAt)}</td></tr>
            <tr><td style="padding:4px 0;color:#65756c;">Reason</td><td align="right" style="padding:4px 0;color:#263d33;">${escapeHtml(data.reason)}</td></tr>
            <tr><td style="padding:4px 0;color:#65756c;">Cancellation fee recorded</td><td align="right" style="padding:4px 0;color:#263d33;">${escapeHtml(data.cancellationFee)}</td></tr>
            <tr><td style="padding:4px 0;color:#65756c;">Original booking total</td><td align="right" style="padding:4px 0;color:#263d33;">${escapeHtml(data.total)}</td></tr>
          </table>
          <h2 style="margin:24px 0 10px;font:400 22px/1.3 Georgia,'Times New Roman',serif;color:#1f4d45;">Cancelled services</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e0e9e2;border-radius:8px;font:400 13px/1.5 Arial,Helvetica,sans-serif;">${serviceRows}</table>
          <h2 style="margin:24px 0 10px;font:400 22px/1.3 Georgia,'Times New Roman',serif;color:#1f4d45;">Payment status</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font:400 13px/1.5 Arial,Helvetica,sans-serif;">${paymentRows}</table>
        </td></tr>
        <tr><td align="center" style="padding:22px 30px 28px;background:#f4f8f5;border-top:1px solid #e0e9e2;">
          <a href="${accountUrl}" style="display:inline-block;padding:13px 23px;background:#1f4d45;border-radius:7px;font:600 14px/1 Arial,Helvetica,sans-serif;color:#fff;text-decoration:none;">View reservation</a>
          <p style="margin:18px 0 0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:#65756c;">If you believe this cancellation was made in error, contact our team.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { text, html }
}
