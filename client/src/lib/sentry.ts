import * as Sentry from '@sentry/react'

/**
 * Error tracking, gated on VITE_SENTRY_DSN: without the env var (local dev,
 * e2e) this is a no-op and the SDK ships no events. Set the DSN in the Vercel
 * project env to activate in production.
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Errors only — no session-replay or tracing bundles/quota. The expected
    // guest-flow rejections (slot_taken etc.) are handled UI states, not bugs.
    ignoreErrors: [
      'slot_taken',
      'limit_reached',
      'verification_required',
      'booking_too_far_in_advance',
    ],
  })
}

export { Sentry }
