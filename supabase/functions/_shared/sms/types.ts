// Shared SMS types. The `SmsProvider` interface is the seam that lets us swap
// the mock for a real Georgian gateway (e.g. SMSOffice, Magti, Geocell) later
// without touching any caller — only a new file implementing this interface and
// one line in the factory (./index.ts → getSmsProvider).

// Mirrors sms_log.message_type CHECK constraint (migrations 001_tables.sql,
// 030_booking_otp.sql).
export type SmsMessageType =
  | 'booking_confirmation'
  | 'approval_update'
  | 'admin_new_booking'
  | 'admin_reminder'
  | 'invitation'
  | 'verification_code'

export interface SmsMessage {
  // Bare recipient phone. Providers normalise to whatever format they require
  // (the platform stores local 9-digit Georgian numbers, no country code).
  to: string
  body: string
}

export interface SmsSendResult {
  status: 'sent' | 'failed'
  // Provider-side id for the message, when the provider returns one.
  providerMessageId: string | null
  // Set only when status === 'failed'.
  error?: string
}

export interface SmsProvider {
  // Stored verbatim in sms_log.provider so logs say which gateway sent what.
  readonly name: string
  send(message: SmsMessage): Promise<SmsSendResult>
}
