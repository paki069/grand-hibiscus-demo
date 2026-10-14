interface NotificationResponse {
  status?: string
  error?: string
}

export async function requestCancellationNotification(reservationId: string) {
  try {
    const response = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reservationId, kind: 'cancellation' }),
    })
    const result = await response.json() as NotificationResponse
    if (!response.ok) {
      return {
        ok: false,
        message: result.error === 'reservation_not_cancelled'
          ? 'The cancellation email was not sent because the booking is not cancelled.'
          : 'The booking was cancelled, but the email could not be sent.',
      }
    }
    if (result.status === 'sent') return { ok: true, message: 'Cancellation email sent.' }
    if (result.status === 'already_logged') return { ok: true, message: 'Cancellation email is already recorded.' }
    if (result.status === 'not_configured') {
      return { ok: false, message: 'Email is not configured, so the cancellation email was not sent.' }
    }
    return { ok: false, message: 'The booking was cancelled, but the email was not sent.' }
  } catch (error) {
    console.error('Could not request the reservation cancellation email:', error)
    return { ok: false, message: 'The booking was cancelled, but the cancellation email request failed.' }
  }
}
