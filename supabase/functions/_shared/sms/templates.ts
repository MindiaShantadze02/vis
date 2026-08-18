// Message language. Defaults to Georgian to match the app's default locale.
export type SmsLang = 'ka' | 'en' | 'ru'

export interface BookingConfirmationData {
  businessName: string
  serviceName: string
  // Already-formatted, human-readable local date/time string.
  when: string
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
  const { businessName, serviceName, when } = data
  const at = addressSuffix(data.address, lang)

  switch (lang) {
    case 'en':
      return `${businessName}: your booking for ${serviceName} on ${when} is confirmed.${at} See you soon!`
    case 'ru':
      return `${businessName}: ваша запись на ${serviceName} (${when}) подтверждена.${at} До встречи!`
    case 'ka':
    default:
      return `${businessName}: თქვენი ჯავშანი — ${serviceName}, ${when} დადასტურდა.${at} გელით!`
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

// Sent when a business DECLINES a booking request (the require_approval flow).
// The customer asked for a time and would otherwise hear nothing, so silence
// would leave them assuming they were booked and turning up. Deliberately gives
// no reason — that is the business's to give, not ours to guess — but points
// them back at the booking page so they can pick another time.
export function bookingDeclinedBody(
  data: BookingConfirmationData,
  lang: SmsLang = 'ka',
): string {
  const { businessName, serviceName, when } = data

  switch (lang) {
    case 'en':
      return `${businessName}: sorry, your request for ${serviceName} on ${when} could not be confirmed. You can pick another time.`
    case 'ru':
      return `${businessName}: к сожалению, вашу заявку на ${serviceName} (${when}) подтвердить не удалось. Вы можете выбрать другое время.`
    case 'ka':
    default:
      return `${businessName}: სამწუხაროდ, თქვენი მოთხოვნა — ${serviceName}, ${when} — ვერ დადასტურდა. შეგიძლიათ სხვა დრო აირჩიოთ.`
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
  // Whether the booking was cancelled along with the refund. A business can now
  // refund WITHOUT cancelling (a goodwill refund on a visit that happened, or a
  // deposit returned while the appointment stands), and telling that customer
  // their booking was cancelled would be actively wrong.
  cancelled?: boolean
}

// Sent when money is returned for a paid online booking: admin cancel-with-refund,
// a standalone admin refund, or the automatic refund when fulfilment fails after a
// cleared charge. Settlement takes days, so the message says the amount is on its
// way rather than already back.
export function refundUpdateBody(data: RefundUpdateData, lang: SmsLang = 'ka'): string {
  const { businessName, serviceName, amount, currency, cancelled = true } = data
  const sum = currency === 'GEL' ? `${amount}₾` : `${amount} ${currency}`
  switch (lang) {
    case 'en':
      return cancelled
        ? `${businessName}: your booking for ${serviceName} was cancelled. The ${sum} you paid will be returned to your card within a few days.`
        : `${businessName}: we are returning ${sum} for your ${serviceName} booking. It will be back on your card within a few days.`
    case 'ru':
      return cancelled
        ? `${businessName}: ваша запись на ${serviceName} отменена. Оплаченные ${sum} вернутся на вашу карту в течение нескольких дней.`
        : `${businessName}: возвращаем ${sum} за вашу запись на ${serviceName}. Деньги вернутся на карту в течение нескольких дней.`
    case 'ka':
    default:
      return cancelled
        ? `${businessName}: თქვენი ჯავშანი — ${serviceName} — გაუქმდა. გადახდილი ${sum} რამდენიმე დღეში დაგიბრუნდებათ ბარათზე.`
        : `${businessName}: გიბრუნებთ ${sum}-ს ჯავშნისთვის — ${serviceName}. თანხა რამდენიმე დღეში დაგიბრუნდებათ ბარათზე.`
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
  // When true, the payment is being returned — say so in the same SMS.
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
