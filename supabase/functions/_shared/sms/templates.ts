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

// Sent when a superadmin finishes configuring an account on the business's
// behalf (concierge onboarding, setup_requests.status → completed).
export function setupCompleteBody(businessName: string, lang: SmsLang = 'ka'): string {
  switch (lang) {
    case 'en':
      return `Vis: your business "${businessName}" is set up and ready — log in at vis.ge to see your booking page.`
    case 'ru':
      return `Vis: ваш бизнес «${businessName}» настроен и готов — войдите на vis.ge, чтобы увидеть страницу бронирования.`
    case 'ka':
    default:
      return `Vis: თქვენი ბიზნესი „${businessName}" გამართულია და მზადაა — შედით vis.ge-ზე თქვენი ჯავშნის გვერდის სანახავად.`
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

export interface MeetingLinkData {
  businessName: string
  serviceName: string
  // Already-formatted, human-readable local date/time string.
  when: string
  // The per-appointment join URL. Required — this message exists to deliver it.
  meetingLink: string
}

// Sent when the owner attaches/updates the join link for an online appointment
// and taps "Send to customer". The URL is the whole point, so it goes last and
// unabbreviated even though it may push the message onto a second segment.
export function meetingLinkBody(data: MeetingLinkData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, when, meetingLink } = data
  switch (lang) {
    case 'en':
      return `${businessName}: join link for your ${serviceName} on ${when}: ${meetingLink}`
    case 'ru':
      return `${businessName}: ссылка для подключения — ${serviceName}, ${when}: ${meetingLink}`
    case 'ka':
    default:
      return `${businessName}: შეხვედრის ბმული — ${serviceName}, ${when}: ${meetingLink}`
  }
}

export interface RefundUpdateData {
  businessName: string
  serviceName: string
  // Full refunded amount in human units + its currency (GEL for now); shown so
  // the customer knows exactly what to expect back on their card.
  amount: number
  currency: string
}

// Sent when a paid online booking is cancelled and the money is returned
// (admin cancel-with-refund, or the automatic refund when fulfilment fails
// after a cleared charge). Settlement takes days, so the message says the
// amount is on its way rather than already back.
export function refundUpdateBody(data: RefundUpdateData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, amount, currency } = data
  const sum = currency === 'GEL' ? `${amount}₾` : `${amount} ${currency}`
  switch (lang) {
    case 'en':
      return `${businessName}: your booking for ${serviceName} was cancelled. The ${sum} you paid will be returned to your card within a few days.`
    case 'ru':
      return `${businessName}: ваша запись на ${serviceName} отменена. Оплаченные ${sum} вернутся на вашу карту в течение нескольких дней.`
    case 'ka':
    default:
      return `${businessName}: თქვენი ჯავშანი — ${serviceName} — გაუქმდა. გადახდილი ${sum} რამდენიმე დღეში დაგიბრუნდებათ ბარათზე.`
  }
}

export interface RescheduleUpdateData {
  businessName: string
  serviceName: string
  // Already-formatted, human-readable NEW local date/time.
  when: string
}

// Sent when a customer reschedules their own booking (self-service /manage).
export function rescheduleUpdateBody(data: RescheduleUpdateData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, when } = data
  switch (lang) {
    case 'en':
      return `${businessName}: your ${serviceName} booking has been moved to ${when}. See you!`
    case 'ru':
      return `${businessName}: ваша запись на ${serviceName} перенесена на ${when}. Ждём вас!`
    case 'ka':
    default:
      return `${businessName}: თქვენი ჯავშანი — ${serviceName} — გადაიტანა ${when}-ზე. გელით!`
  }
}

export interface CancellationUpdateData {
  businessName: string
  serviceName: string
  // Already-formatted, human-readable local date/time of the cancelled slot.
  when: string
  // When true, the deposit/payment is being returned — say so in the same SMS.
  refunded: boolean
  amount: number
  currency: string
}

// Sent when a customer cancels their own booking (self-service /manage). Folds
// the refund note in when the policy returned the money, so there's one SMS.
export function cancellationUpdateBody(data: CancellationUpdateData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, when, refunded, amount, currency } = data
  const sum = currency === 'GEL' ? `${amount}₾` : `${amount} ${currency}`
  switch (lang) {
    case 'en':
      return `${businessName}: your ${serviceName} booking on ${when} has been cancelled.`
        + (refunded ? ` The ${sum} you paid will be returned to your card within a few days.` : '')
    case 'ru':
      return `${businessName}: ваша запись на ${serviceName} (${when}) отменена.`
        + (refunded ? ` Оплаченные ${sum} вернутся на вашу карту в течение нескольких дней.` : '')
    case 'ka':
    default:
      return `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when} — გაუქმდა.`
        + (refunded ? ` გადახდილი ${sum} რამდენიმე დღეში დაგიბრუნდებათ ბარათზე.` : '')
  }
}

export interface WaitlistOfferData {
  businessName: string
  serviceName: string
  when: string
  claimUrl: string
  minutes: number
}

// Sent when a freed slot is offered to a waitlisted customer — the claim link +
// a short window are the whole point, so the URL goes last, unabbreviated.
export function waitlistOfferBody(data: WaitlistOfferData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, when, claimUrl, minutes } = data
  switch (lang) {
    case 'en':
      return `${businessName}: a ${serviceName} slot opened on ${when}! Claim it within ${minutes} min: ${claimUrl}`
    case 'ru':
      return `${businessName}: освободилось время на ${serviceName} — ${when}! Забронируйте в течение ${minutes} мин: ${claimUrl}`
    case 'ka':
    default:
      return `${businessName}: გამოთავისუფლდა დრო — ${serviceName}, ${when}! დაიკავეთ ${minutes} წუთში: ${claimUrl}`
  }
}

export interface WaitlistClaimedData {
  businessName: string
  serviceName: string
  when: string
}

// Sent once a waitlisted customer claims the offered slot (booking confirmed).
export function waitlistClaimedBody(data: WaitlistClaimedData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, when } = data
  switch (lang) {
    case 'en':
      return `${businessName}: your ${serviceName} is booked for ${when}. See you!`
    case 'ru':
      return `${businessName}: ваша запись на ${serviceName} подтверждена — ${when}. Ждём вас!`
    case 'ka':
    default:
      return `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when} დადასტურდა. გელით!`
  }
}

// Type-check helper so adding a SmsMessageType reminds you a template may be
// needed. Not all types are wired yet (admin_*, invitation).
export const TEMPLATED_MESSAGE_TYPES: readonly SmsMessageType[] = [
  'booking_confirmation',
  'approval_update',
  'verification_code',
  'appointment_reminder',
  'setup_complete',
  'meeting_link',
  'refund_update',
  'reschedule_update',
  'cancellation_update',
  'waitlist_offer',
  'waitlist_claimed',
]
