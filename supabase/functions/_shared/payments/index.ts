import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { PaymentProvider, PaymentPurpose } from './types.ts'
import { MockPaymentProvider } from './mock.ts'
// Real providers are stubs until merchant credentials exist — see bog.ts/tbc.ts.
// import { BogPaymentProvider } from './bog.ts'
// import { TbcPaymentProvider } from './tbc.ts'

export type { CheckoutResult, CreateCheckoutParams, PaymentProvider, PaymentPurpose } from './types.ts'

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------
// To enable a real provider:
//   1. Implement ./<provider>.ts (BOG/TBC stubs are already scaffolded).
//   2. Uncomment its case below (and the import above), wiring credentials from
//      function secrets or organisations.payment_config.
//   3. Set platform_config.payment_provider (or the PAYMENT_PROVIDER env var) to
//      its name. No caller changes are required.

function buildProvider(name: string): PaymentProvider {
  switch (name) {
    case 'mock':
      return new MockPaymentProvider()
    // case 'bog':
    //   return new BogPaymentProvider(Deno.env.get('BOG_CLIENT_ID') ?? '', Deno.env.get('BOG_SECRET') ?? '')
    // case 'tbc':
    //   return new TbcPaymentProvider(Deno.env.get('TBC_CLIENT_ID') ?? '', Deno.env.get('TBC_SECRET') ?? '')
    default:
      // Fail closed: an unknown provider name (e.g. a real gateway selected
      // before its case is wired in, or a typo) must NOT silently degrade to the
      // no-cost mock provider — that would accept fake payments. Surface the
      // misconfiguration as a hard error instead.
      throw new Error(`payments: unknown/unconfigured provider "${name}"`)
  }
}

// Resolves the active provider. Precedence: PAYMENT_PROVIDER env var (handy for
// local/preview overrides) → platform_config.payment_provider → 'mock'.
export async function getPaymentProvider(
  supabase: SupabaseClient,
): Promise<PaymentProvider> {
  const envName = Deno.env.get('PAYMENT_PROVIDER')
  if (envName) return buildProvider(envName)

  const { data } = await supabase
    .from('platform_config')
    .select('payment_provider')
    .eq('id', 1)
    .maybeSingle()

  return buildProvider(data?.payment_provider ?? 'mock')
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface StartCheckoutParams {
  orgId: string | null
  purpose: PaymentPurpose
  appointmentId?: string | null
  subscriptionPaymentId?: string | null
  amount: number
  currency: string
  description: string
  // Id of the row this payment settles (pending_booking id or subscription_payments id).
  referenceId: string
  returnBaseUrl: string
  slug?: string
}

export interface StartCheckoutResult {
  checkoutUrl: string
  providerReference: string
  provider: string
}

// Starts a checkout and records the attempt in payment_log (the audit trail).
// The row is written 'pending' first, then updated with the provider name and
// reference once the gateway hands back a checkout URL. Unlike sendSms, this
// DOES throw on failure: a customer needs to know if checkout couldn't start.
//
// Requires a service-role client — payment_log has no end-user insert policy.
export async function startCheckout(
  supabase: SupabaseClient,
  params: StartCheckoutParams,
): Promise<StartCheckoutResult> {
  const provider = await getPaymentProvider(supabase)

  const { data: logRow } = await supabase
    .from('payment_log')
    .insert({
      org_id: params.orgId ?? null,
      purpose: params.purpose,
      appointment_id: params.appointmentId ?? null,
      subscription_payment_id: params.subscriptionPaymentId ?? null,
      amount: params.amount,
      currency: params.currency,
      provider: provider.name,
      status: 'pending',
    })
    .select('id')
    .single()
  const logId: string | null = logRow?.id ?? null

  try {
    const result = await provider.createCheckout({
      purpose: params.purpose,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      referenceId: params.referenceId,
      returnBaseUrl: params.returnBaseUrl,
      slug: params.slug,
    })

    if (logId) {
      await supabase
        .from('payment_log')
        .update({ provider_reference: result.providerReference, updated_at: new Date().toISOString() })
        .eq('id', logId)
    }

    return { checkoutUrl: result.checkoutUrl, providerReference: result.providerReference, provider: provider.name }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[payments] checkout failed (purpose=${params.purpose}): ${error}`)
    if (logId) {
      await supabase
        .from('payment_log')
        .update({ status: 'failed', error, updated_at: new Date().toISOString() })
        .eq('id', logId)
        .then(() => {}, () => {})
    }
    throw err
  }
}

// Marks the payment_log row(s) for a gateway reference as paid/failed. Called by
// the payment-webhook function after it has applied the business-side effects.
export async function finalizePaymentLog(
  supabase: SupabaseClient,
  providerReference: string,
  status: 'paid' | 'failed',
  error?: string,
): Promise<void> {
  await supabase
    .from('payment_log')
    .update({ status, error: error ?? null, updated_at: new Date().toISOString() })
    .eq('provider_reference', providerReference)
}
