import type { SmsMessage, SmsProvider, SmsSendResult } from './types.ts'

// Development/no-cost provider. It never actually delivers an SMS — it logs the
// message to the function logs and reports success, so the rest of the booking
// flow behaves exactly as it will once a real gateway is wired in. Every send is
// still recorded in sms_log by the sendSms orchestrator, so you get a full audit
// trail to inspect in the superadmin panel.
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock'

  // deno-lint-ignore require-await
  async send(message: SmsMessage): Promise<SmsSendResult> {
    const providerMessageId = `mock_${crypto.randomUUID()}`
    // Don't log the recipient number or the body — the body can carry OTPs and
    // the number is PII. The full audit row still lands in sms_log.
    console.log(`[mock-sms] sent id=${providerMessageId}`)
    return { status: 'sent', providerMessageId }
  }
}
