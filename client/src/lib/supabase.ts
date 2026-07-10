import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Separate throwaway client for pre-checking credentials on the login form.
// It must not be the main client: a successful signInWithPassword there would
// persist a session and the AuthContext listener would redirect to the
// dashboard, skipping the OTP step entirely.
const credentialCheckClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-credential-check' },
})

/**
 * Verify a phone+password pair without creating a session on the main client.
 * Returns the AuthError (e.g. invalid credentials, rate limited) or null when
 * the credentials are valid. Any session the check produces is discarded.
 */
export async function checkCredentials(phone: string, password: string) {
  const { error } = await credentialCheckClient.auth.signInWithPassword({ phone, password })
  if (!error) {
    // 'local' only drops the in-memory session; 'global' would revoke the
    // user's real sessions on other devices.
    await credentialCheckClient.auth.signOut({ scope: 'local' })
  }
  return error
}
