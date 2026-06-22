import type { CheckoutResult, CreateCheckoutParams, PaymentProvider } from './types.ts'

// Development/no-cost provider. It charges nobody: instead of redirecting to a
// real bank gateway, it sends the browser to our own /pay/mock screen, which
// offers "Simulate success / fail" buttons and then calls the payment-webhook
// function — exactly the redirect → webhook → return shape a real provider
// uses. So the entire flow (and every payment_log row) behaves as it will once
// BOG/TBC are wired in; only this file is swapped out.
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock'

  // deno-lint-ignore require-await
  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const providerReference = `mock_${crypto.randomUUID()}`
    const url = new URL('/pay/mock', params.returnBaseUrl)
    url.searchParams.set('ref', providerReference)
    url.searchParams.set('purpose', params.purpose)
    url.searchParams.set('id', params.referenceId)
    // Carry display info so the mock screen needs no DB read. A real gateway
    // hosts its own page and ignores these.
    url.searchParams.set('amount', String(params.amount))
    url.searchParams.set('currency', params.currency)
    url.searchParams.set('label', params.description)
    if (params.slug) url.searchParams.set('slug', params.slug)

    console.log(
      `[mock-payment] ${params.purpose} ${params.amount} ${params.currency} ` +
      `ref=${providerReference} -> ${url.toString()}`,
    )

    return { checkoutUrl: url.toString(), providerReference, status: 'pending' }
  }
}
