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
  // Business street address; when set, appended so the customer knows where
  // to come. Optional — not every business has filled it in.
  address?: string | null
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
  const at = addressSuffix(data.address, lang)

  switch (lang) {
    case 'en':
      return pending
        ? `${businessName}: your booking for ${serviceName} on ${when} has been received and is awaiting confirmation.${at}`
        : `${businessName}: your booking for ${serviceName} on ${when} is confirmed.${at} See you soon!`
    case 'ru':
      return pending
        ? `${businessName}: ваша запись на ${serviceName} (${when}) принята и ожидает подтверждения.${at}`
        : `${businessName}: ваша запись на ${serviceName} (${when}) подтверждена.${at} До встречи!`
    case 'ka':
    default:
      return pending
        ? `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when}. მიღებულია და ელოდება დადასტურებას.${at}`
        : `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when} დადასტურდა.${at} გელით!`
  }
}

// " Address: <x>." line for confirmation/reminder bodies; empty when the
// business hasn't set an address. Each localised label costs one short
// sentence, so a set address typically adds one SMS segment at most.
function addressSuffix(address: string | null | undefined, lang: SmsLang): string {
  const a = address?.trim()
  if (!a) return ''
  switch (lang) {
    case 'en': return ` Address: ${a}.`
    case 'ru': return ` Адрес: ${a}.`
    case 'ka':
    default: return ` მისამართი: ${a}.`
  }
}

// Reminder sent ~24h before an upcoming appointment (the no-show reducer).
// Reuses the booking-details shape since it carries the same fields.
export function appointmentReminderBody(
  data: BookingConfirmationData,
  lang: SmsLang = 'ka',
): string {
  const { businessName, serviceName, when } = data

  switch (lang) {
    case 'en':
      return `${businessName}: reminder — your ${serviceName} appointment is on ${when}. See you!`
    case 'ru':
      return `${businessName}: напоминание — запись на ${serviceName}, ${when}. Ждём вас!`
    case 'ka':
    default:
      return `${businessName}: შეგახსენებთ — ${serviceName}, ${when}. გელით!`
  }
}

// One-time phone-verification code sent before a guest booking is created.
export function verificationCodeBody(code: string, lang: SmsLang = 'ka'): string {
  switch (lang) {
    case 'en':
      return `${code} is your vis booking confirmation code. It expires in 10 minutes.`
    case 'ru':
      return `${code} — ваш код подтверждения брони vis. Действует 10 минут.`
    case 'ka':
    default:
      return `${code} — თქვენი ჯავშნის დადასტურების კოდი (vis). მოქმედებს 10 წუთი.`
  }
}

// One-time code sent when a user requests a password reset for their account.
export function passwordResetCodeBody(code: string, lang: SmsLang = 'ka'): string {
  switch (lang) {
    case 'en':
      return `${code} is your vis password reset code. It expires in 10 minutes.`
    case 'ru':
      return `${code} — ваш код для сброса пароля vis. Действует 10 минут.`
    case 'ka':
    default:
      return `${code} — თქვენი პაროლის აღდგენის კოდი (vis). მოქმედებს 10 წუთი.`
  }
}

// Type-check helper so adding a SmsMessageType reminds you a template may be
// needed. Not all types are wired yet (admin_*, invitation).
export const TEMPLATED_MESSAGE_TYPES: readonly SmsMessageType[] = [
  'booking_confirmation',
  'approval_update',
  'verification_code',
  'appointment_reminder',
]
