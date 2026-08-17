// Which refund affordance an appointment should show.
//
// This mirrors the eligibility rule inside the refund-payment edge function,
// which stays the authority — this only decides what to DRAW, so a stale row in
// a list can never do more than offer a button the server then refuses.
//
// Note what is absent: the appointment's status. A refund is a money action, so
// a completed visit, a no-show or an already-cancelled booking is just as
// refundable as a live one. Whether the refund also cancels is the server's
// call (it cancels only a still-approved booking).

export type RefundGate = 'refundable' | 'refunded' | 'none'

/** Payment states that mean money actually reached the gateway. */
const PAID_STATES = ['paid', 'deposit_paid']

export function refundGate(appt: {
  payment_method?: string | null
  payment_status?: string | null
}): RefundGate {
  if (appt.payment_status === 'refunded') return 'refunded'
  if (appt.payment_method === 'online' && PAID_STATES.includes(appt.payment_status ?? '')) {
    return 'refundable'
  }
  return 'none'
}
