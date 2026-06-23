import type { SmsMessageType } from './types.ts'

// Message language. Defaults to Georgian to match the app's default locale.
export type SmsLang = 'ka' | 'en' | 'ru'

export interface BookingConfirmationData {
  businessName: string
  serviceName: string
  // Already-formatted, human-readable local date/time string.
  when: string
  // Whether the booking still needs admin approval (pending) or is confirmed.
  pending: boolean
}

// Centralised SMS copy. Keep bodies short — SMS segments are 160 chars (70 for
// non-Latin/Unicode, which Georgian and Cyrillic use), so each extra segment is
// billed separately by real gateways. Add new message types here as they get
// wired into the corresponding flows.

export function bookingConfirmationBody(
  data: BookingConfirmationData,
  lang: SmsLang = 'ka',
): string {
  const { businessName, serviceName, when, pending } = data

  switch (lang) {
    case 'en':
      return pending
        ? `${businessName}: your booking for ${serviceName} on ${when} has been received and is awaiting confirmation.`
        : `${businessName}: your booking for ${serviceName} on ${when} is confirmed. See you soon!`
    case 'ru':
      return pending
        ? `${businessName}: ваша запись на ${serviceName} (${when}) принята и ожидает подтверждения.`
        : `${businessName}: ваша запись на ${serviceName} (${when}) подтверждена. До встречи!`
    case 'ka':
    default:
      return pending
        ? `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when}. მიღებულია და ელოდება დადასტურებას.`
        : `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when} დადასტურდა. გელით!`
  }
}

// One-time phone-verification code sent before a guest booking is created.
export function verificationCodeBody(code: string, lang: SmsLang = 'ka'): string {
  switch (lang) {
    case 'en':
      return `${code} is your Grafiki booking confirmation code. It expires in 10 minutes.`
    case 'ru':
      return `${code} — ваш код подтверждения брони Grafiki. Действует 10 минут.`
    case 'ka':
    default:
      return `${code} — თქვენი ჯავშნის დადასტურების კოდი (Grafiki). მოქმედებს 10 წუთი.`
  }
}

// One-time code sent when a user requests a password reset for their account.
export function passwordResetCodeBody(code: string, lang: SmsLang = 'ka'): string {
  switch (lang) {
    case 'en':
      return `${code} is your Grafiki password reset code. It expires in 10 minutes.`
    case 'ru':
      return `${code} — ваш код для сброса пароля Grafiki. Действует 10 минут.`
    case 'ka':
    default:
      return `${code} — თქვენი პაროლის აღდგენის კოდი (Grafiki). მოქმედებს 10 წუთი.`
  }
}

// Type-check helper so adding a SmsMessageType reminds you a template may be
// needed. Not all types are wired yet (admin_*, invitation).
export const TEMPLATED_MESSAGE_TYPES: readonly SmsMessageType[] = [
  'booking_confirmation',
  'approval_update',
  'verification_code',
]
