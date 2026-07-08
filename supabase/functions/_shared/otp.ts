// Shared helpers for the phone-verification (OTP) flows, used by the
// request-booking-otp / verify-booking-otp and request-password-reset /
// reset-password edge functions.

// Normalise a user-entered phone to a bare 9-digit Georgian local number
// (mobile starts with 5, landline with 3/4), matching how the rest of the app
// stores numbers. Returns null if it isn't a valid Georgian number.
export function normalizeGeorgianPhone(input: unknown): string | null {
  const digits = String(input ?? '').replace(/\D/g, '')
  const local = digits.startsWith('995') ? digits.slice(3) : digits
  return /^[345]\d{8}$/.test(local) ? local : null
}

// SHA-256 hex of the code bound to the phone and a server-side pepper, so a
// leak of booking_verifications never exposes usable codes.
export async function hashCode(code: string, phone: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${phone}:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// A random 6-digit numeric code (zero-padded).
export function generateCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
}

// Caller IP for rate limiting: the first x-forwarded-for hop (set by the
// Supabase edge gateway; the client can't spoof the first entry). Null when
// absent — check_otp_rate_limit then skips the per-IP caps but still applies
// the per-phone and global ones.
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  const first = fwd?.split(',')[0]?.trim()
  return first || null
}
