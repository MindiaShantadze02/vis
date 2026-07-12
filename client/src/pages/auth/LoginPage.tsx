import { useState, useRef } from 'react'
import {
  Box, TextField, Button,
  CircularProgress, Alert, Link as MuiLink, Stack,
  IconButton, InputAdornment,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { VisibilityOutlined as VisibilityIcon } from '@/components/icons'
import { VisibilityOffOutlined as VisibilityOffIcon } from '@/components/icons'
import { supabase, checkCredentials } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import AuthShell from './AuthShell'
import OtpStep from './OtpStep'

// Sign-in only. Registration lives on /register (see RegisterPage).
// Flow: credentials (pre-checked via a throwaway client) → phone OTP
// (request-booking-otp / verify-booking-otp) → signInWithPassword. The OTP
// proves phone ownership before the real session is issued, and the pre-check
// keeps invalid credentials from ever reaching the OTP step.
export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'otp'>('form')
  // Phone whose OTP we already verified this session, so a wrong-password retry
  // doesn't re-request (and rate-limit) a fresh code.
  const otpVerifiedFor = useRef<string | null>(null)

  const phoneValid = isValidGeorgianPhone(phone)
  const phoneInvalid = phone.trim().length > 0 && !phoneValid

  async function signIn() {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ phone: toE164Georgian(phone), password })
    setLoading(false)
    if (err) {
      // Wrong password — send them back to the form to fix it. The OTP stays
      // verified (otpVerifiedFor), so the retry won't request a new code.
      setError(t(mapAuthError(err)))
      setPhase('form')
    }
    // Success: the AuthContext session listener redirects to the dashboard.
  }

  async function startSignIn() {
    // Validate with visible messages instead of a silently disabled button.
    if (!phoneValid) { setError(t('validation.invalidPhone')); return }
    if (password.length === 0) { setError(t('validation.required')); return }
    setError(null)
    // Already verified this phone moments ago (e.g. a wrong-password retry) —
    // go straight to sign-in without another code.
    if (otpVerifiedFor.current === toE164Georgian(phone)) { await signIn(); return }
    setLoading(true)
    // Reject bad credentials before the OTP step: no code is sent (and no SMS
    // spent) for a phone/password pair that couldn't sign in anyway.
    const credErr = await checkCredentials(toE164Georgian(phone), password)
    if (credErr) {
      setLoading(false)
      setError(t(mapAuthError(credErr)))
      return
    }
    const { data, error: fnErr } = await supabase.functions.invoke('request-booking-otp', {
      body: { phone },
    })
    setLoading(false)
    // 'too_soon' = a still-valid code was just sent; proceed to entry anyway.
    if (fnErr || (!data?.ok && data?.error !== 'too_soon')) {
      setError(t(data?.error === 'too_many_requests' ? 'auth.otpTooMany' : 'auth.otpSendFailed'))
      return
    }
    setPhase('otp')
  }

  async function submitOtp(code: string) {
    setLoading(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('verify-booking-otp', {
      body: { phone, code },
    })
    if (fnErr || !data?.verified) {
      setLoading(false)
      setError(data?.error === 'wrong_code'
        ? t('auth.otpWrong', { remaining: data?.remaining ?? 0 })
        : t('auth.otpExpired'))
      return
    }
    otpVerifiedFor.current = toE164Georgian(phone)
    await signIn()
  }

  async function resend() {
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('request-booking-otp', {
      body: { phone },
    })
    if (fnErr || (!data?.ok && data?.error !== 'too_soon')) setError(t(data?.error === 'too_many_requests' ? 'auth.otpTooMany' : 'auth.otpSendFailed'))
  }

  if (phase === 'otp') {
    return (
      <AuthShell title={t('auth.otpTitle')} subtitle={t('auth.otpSubtitle', { phone })}>
        <OtpStep
          onSubmit={submitOtp}
          onResend={resend}
          onBack={() => { setPhase('form'); setError(null) }}
          loading={loading}
          error={error}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('auth.login')}>
      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">{error}</Alert>}

      <TextField
        fullWidth
        required
        label={t('auth.phoneNumber')}
        type="tel"
        value={phone}
        onChange={e => setPhone(e.target.value)}
        error={phoneInvalid}
        helperText={phoneInvalid ? t('validation.invalidPhone') : ' '}
        placeholder="599 12 34 56"
        sx={{ mb: 1 }}
        autoFocus
        slotProps={{ htmlInput: { inputMode: 'tel' as const, maxLength: FIELD_LIMITS.phone, 'data-testid': 'login-phone' } }}
      />

      <TextField
        fullWidth
        required
        label={t('auth.password')}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !loading && startSignIn()}
        sx={{ mb: 2 }}
        slotProps={{
          htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-password' },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={t('auth.togglePassword')}
                  onClick={() => setShowPassword(s => !s)}
                  edge="end"
                  size="small"
                >
                  {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />

      <Button
        fullWidth
        variant="contained"
        size="large"
        onClick={startSignIn}
        disabled={loading}
        data-testid="login-submit"
      >
        {loading ? <CircularProgress size={20} color="inherit" /> : t('auth.login')}
      </Button>

      <Stack spacing={1.25} sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box>
          <MuiLink
            component="button"
            type="button"
            underline="hover"
            onClick={() => navigate('/forgot-password')}
            sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
            data-testid="login-forgot-password"
          >
            {t('auth.forgotPassword')}
          </MuiLink>
        </Box>
        <Box>
          <MuiLink
            component="button"
            type="button"
            underline="hover"
            onClick={() => navigate('/register')}
            sx={{ fontSize: '0.875rem', color: 'primary.main', fontWeight: 600 }}
            data-testid="login-to-register"
          >
            {t('auth.noAccount')}
          </MuiLink>
        </Box>
      </Stack>
    </AuthShell>
  )
}
