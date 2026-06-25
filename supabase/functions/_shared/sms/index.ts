import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SmsMessageType, SmsProvider, SmsSendResult } from './types.ts'
import { MockSmsProvider } from './mock.ts'

export type { SmsMessage, SmsMessageType, SmsProvider, SmsSendResult } from './types.ts'
export * from './templates.ts'

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------
// To add a real provider:
//   1. Create ./<provider>.ts implementing SmsProvider (see mock.ts).
//   2. Register it in the switch below.
//   3. Set platform_config.sms_provider (or the SMS_PROVIDER env var) to its name
//      and put credentials in platform_config.sms_config / function secrets.
// No caller changes are required.

function buildProvider(name: string): SmsProvider {
  switch (name) {
    case 'mock':
      return new MockSmsProvider()
    // case 'smsoffice':
    //   return new SmsOfficeProvider(/* creds from config */)
    default:
      // Fail closed: an unknown provider name must not silently degrade to the
      // mock provider. sendSms() catches this and logs the SMS as failed without
      // breaking the surrounding flow (booking etc.).
      throw new Error(`sms: unknown/unconfigured provider "${name}"`)
  }
}

// Resolves the active provider. Precedence: SMS_PROVIDER env var (handy for
// local/preview overrides) → platform_config.sms_provider → 'mock'.
export async function getSmsProvider(
  supabase: SupabaseClient,
): Promise<SmsProvider> {
  const envName = Deno.env.get('SMS_PROVIDER')
  if (envName) return buildProvider(envName)

  const { data } = await supabase
    .from('platform_config')
    .select('sms_provider')
    .eq('id', 1)
    .maybeSingle()

  return buildProvider(data?.sms_provider ?? 'mock')
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface SendSmsParams {
  orgId?: string | null
  appointmentId?: string | null
  messageType: SmsMessageType
  to: string
  body: string
}

// Sends one SMS and records it in sms_log (the platform's audit trail). The
// row is written 'queued' first so a crash mid-send still leaves a trace, then
// updated to 'sent'/'failed' with the provider id or error.
//
// This NEVER throws: SMS is a side effect of flows like booking, and a gateway
// outage must not fail the booking itself. Callers can inspect the returned
// result if they care, but most should fire-and-forget.
//
// Requires a service-role client — sms_log has no insert policy for end users
// (RLS is bypassed by the service role).
export async function sendSms(
  supabase: SupabaseClient,
  params: SendSmsParams,
): Promise<SmsSendResult> {
  const { orgId, appointmentId, messageType, to, body } = params

  let logId: string | null = null
  try {
    const { data: logRow } = await supabase
      .from('sms_log')
      .insert({
        org_id: orgId ?? null,
        appointment_id: appointmentId ?? null,
        recipient_phone: to,
        message_type: messageType,
        status: 'queued',
      })
      .select('id')
      .single()
    logId = logRow?.id ?? null

    const provider = await getSmsProvider(supabase)
    const result = await provider.send({ to, body })

    if (logId) {
      await supabase
        .from('sms_log')
        .update({
          provider: provider.name,
          provider_message_id: result.providerMessageId,
          status: result.status,
          error: result.error ?? null,
        })
        .eq('id', logId)
    }
    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[sms] send failed (type=${messageType} to=${to}): ${error}`)
    if (logId) {
      await supabase
        .from('sms_log')
        .update({ status: 'failed', error })
        .eq('id', logId)
        .then(() => {}, () => {})
    }
    return { status: 'failed', providerMessageId: null, error }
  }
}
