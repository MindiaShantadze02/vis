// Shared payment types. The `PaymentProvider` interface is the seam that lets
// us swap the mock for a real Georgian gateway (BOG Pay, TBC Pay) or an
// international card processor later, without touching any caller — only a new
// file implementing this interface and one line in the factory (./index.ts →
// getPaymentProvider).

// Which flow the money belongs to. Mirrors payment_log.purpose.
export type PaymentPurpose = 'appointment' | 'subscription'

export interface CreateCheckoutParams {
  purpose: PaymentPurpose
  // Minor caveat for real gateways: amounts are usually sent in the smallest
  // currency unit (tetri/cents). Providers convert as needed; we pass the
  // human GEL amount here.
  amount: number
  currency: string
  // Short human description shown on the gateway / mock checkout.
  description: string
  // The id of the row this payment settles: the appointment id, or the
  // subscription_payments id. Echoed back on the return/webhook so we know
  // what to mark paid.
  referenceId: string
  // Absolute origin of the app the customer is on (e.g. https://app.vis.ge),
  // used to build success/return URLs. Real providers redirect the browser to
  // their hosted page; the mock redirects to our own /pay/mock screen.
  returnBaseUrl: string
  // Optional booking slug to round-trip so the return page can route a failed
  // payment back to the right booking page. Ignored by gateways that don't need it.
  slug?: string
}

export interface CheckoutResult {
  // Where to send the browser to complete payment.
  checkoutUrl: string
  // Gateway-side id for this checkout session/transaction. Stored in the
  // settling row's payment_reference and in payment_log.provider_reference so
  // the webhook can match the callback to the right row.
  providerReference: string
  // 'pending' until the gateway confirms (the normal redirect flow).
  status: 'pending' | 'paid' | 'failed'
}

export interface RefundParams {
  // The ORIGINAL charge's gateway reference (payment_log.provider_reference /
  // the row's payment_reference) — refunds are addressed by the charge.
  providerReference: string
  // Full charge amount in human GEL. Full refunds only for now; both BOG and
  // TBC accept partial amounts when we need them (PLAN.md notes payment_status
  // is binary, so partials would also need schema work).
  amount: number
  currency: string
  // Stable per-charge key (we pass payment_log.id) so a retried call cannot
  // double-refund — BOG's Idempotency-Key header expects exactly this.
  idempotencyKey: string
}

export interface RefundResult {
  // Gateway-side id of the refund operation. Stored in
  // payment_log.refund_reference.
  refundReference: string
  // 'refunded' = the gateway ACCEPTED the refund. Settlement may lag (TBC
  // takes up to 3 bank days) but acceptance is the point of no return, so we
  // treat it as done. A rejected refund throws instead.
  status: 'refunded'
}

export interface PaymentProvider {
  // Stored verbatim in payment_log.provider / the row's payment_provider so
  // logs say which gateway handled what.
  readonly name: string
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>
  // Refund a settled charge in full. Required (not optional) so the compiler
  // forces every future provider to decide its refund story — the BOG/TBC
  // stubs throw 'provider_not_configured' until real credentials exist.
  refund(params: RefundParams): Promise<RefundResult>
}
