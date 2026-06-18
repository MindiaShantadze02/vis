import type { AuthError } from '@supabase/supabase-js'

/**
 * Map a Supabase auth error to a localized `authErrors.*` i18n key.
 *
 * Supabase returns terse, English-only messages ("Invalid login credentials")
 * that we never want to show a user directly. We match on the parts of the
 * message/status that are stable across versions and fall back to a generic
 * key for anything unrecognised. Returns a key suffix to pass to `t()`.
 */
export function mapAuthError(err: AuthError | null | undefined): string {
  if (!err) return 'authErrors.generic'

  const msg = err.message?.toLowerCase() ?? ''
  const status = err.status ?? 0

  if (status === 429 || msg.includes('rate limit') || msg.includes('too many')) {
    return 'authErrors.rateLimited'
  }
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'authErrors.invalidCredentials'
  }
  if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('user already')) {
    return 'authErrors.emailTaken'
  }
  if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
    return 'authErrors.emailNotConfirmed'
  }
  if (msg.includes('password') && (msg.includes('at least') || msg.includes('should be') || msg.includes('weak'))) {
    return 'validation.passwordTooShort'
  }
  return 'authErrors.generic'
}
