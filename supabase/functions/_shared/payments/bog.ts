import type { CheckoutResult, CreateCheckoutParams, PaymentProvider } from './types.ts'

// Bank of Georgia (BOG Pay) provider — STUB.
//
// Not usable until the business has a legal/tax status and BOG merchant
// credentials. When that day comes:
//   1. Fill in createCheckout() with BOG's e-commerce API (OAuth token →
//      create order → return the redirect_url + order id).
//   2. Implement signature verification in the payment-webhook function.
//   3. Uncomment the `case 'bog'` line in ./index.ts and set
//      platform_config.payment_provider = 'bog'.
//
// Credentials should come from function secrets (BOG_CLIENT_ID / BOG_SECRET)
// or, for per-org gateways, organisations.payment_config.bog.{merchantId,apiKey}.
export class BogPaymentProvider implements PaymentProvider {
  readonly name = 'bog'

  constructor(
    private readonly clientId: string,
    private readonly secret: string,
  ) {}

  // deno-lint-ignore require-await
  async createCheckout(_params: CreateCheckoutParams): Promise<CheckoutResult> {
    if (!this.clientId || !this.secret) {
      throw new Error('provider_not_configured')
    }
    // TODO: call BOG's order API and return { checkoutUrl, providerReference }.
    throw new Error('provider_not_configured')
  }
}
