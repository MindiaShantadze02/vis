import type {
  CheckoutResult, CreateCheckoutParams, PaymentProvider, RefundParams, RefundResult,
} from './types.ts'

// TBC Bank (TBC Pay / TBC E-Commerce) provider — STUB.
//
// Not usable until the business has a legal/tax status and TBC merchant
// credentials. When that day comes:
//   1. Fill in createCheckout() with TBC's e-commerce API (apiKey → create
//      payment → return the payment URL + payId).
//   2. Implement callback/signature verification in the payment-webhook function.
//   3. Uncomment the `case 'tbc'` line in ./index.ts and set
//      platform_config.payment_provider = 'tbc'.
//
// Credentials should come from function secrets (TBC_CLIENT_ID / TBC_SECRET)
// or, for per-org gateways, organisations.payment_config.tbc.{merchantId,apiKey}.
export class TbcPaymentProvider implements PaymentProvider {
  readonly name = 'tbc'

  constructor(
    private readonly clientId: string,
    private readonly secret: string,
  ) {}

  // deno-lint-ignore require-await
  async createCheckout(_params: CreateCheckoutParams): Promise<CheckoutResult> {
    if (!this.clientId || !this.secret) {
      throw new Error('provider_not_configured')
    }
    // TODO: call TBC's e-commerce API and return { checkoutUrl, providerReference }.
    throw new Error('provider_not_configured')
  }

  // TBC refund (documented, unimplemented until credentials exist): the
  // checkout API's payment cancel endpoint — POST /v1/tpay/payments/{payId}/cancel
  // with an optional { "amount": N } for partial reversal. Funds return to the
  // customer within up to 3 bank days; gateway acceptance is treated as done.
  // deno-lint-ignore require-await
  async refund(_params: RefundParams): Promise<RefundResult> {
    if (!this.clientId || !this.secret) {
      throw new Error('provider_not_configured')
    }
    // TODO: access token → POST the cancel/refund → return { refundReference, status: 'refunded' }.
    throw new Error('provider_not_configured')
  }
}
