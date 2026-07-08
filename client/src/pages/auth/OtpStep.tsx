import { useEffect, useRef, useState } from 'react'
import {
  Box, TextField, Button, CircularProgress, Alert, Link as MuiLink,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

interface Props {
  /** Verify the entered code and complete the flow (sign in / sign up). */
  onSubmit: (code: string) => void | Promise<void>
  /** Request a fresh code for the same phone. */
  onResend: () => void | Promise<void>
  /** Return to the credentials form (change number). */
  onBack: () => void
  loading: boolean
  error: string | null
}

const RESEND_SECONDS = 60

/**
 * Shared phone-verification step for /login and /register. Mirrors the public
 * booking OTP UX: a 6-digit field that auto-submits on the last digit, a resend
 * link on a cooldown, and a back link to correct the number. The parent owns the
 * verify + sign-in/up network calls (passed as onSubmit).
 */
export default function OtpStep({ onSubmit, onResend, onBack, loading, error }: Props) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(RESEND_SECONDS)
  // Last code we auto-submitted, so a failed attempt isn't retried in a loop
  // while the same 6 digits sit in the field.
  const autoSubmitted = useRef<string | null>(null)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  // Auto-verify the moment the 6th digit lands — one less tap (matches booking).
  useEffect(() => {
    if (code.length !== 6 || loading) return
    if (autoSubmitted.current === code) return
    autoSubmitted.current = code
    void onSubmit(code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, loading])

  async function handleResend() {
    setCode('')
    autoSubmitted.current = null
    await onResend()
    setResendIn(RESEND_SECONDS)
  }

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">{error}</Alert>}

      <TextField
        fullWidth
        required
        label={t('auth.otpLabel')}
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        autoFocus
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { inputMode: 'numeric' as const, maxLength: 6, 'data-testid': 'auth-otp-code' } }}
      />

      <Button
        fullWidth
        variant="contained"
        size="large"
        onClick={() => { autoSubmitted.current = code; void onSubmit(code) }}
        disabled={loading || code.length !== 6}
        data-testid="auth-otp-verify"
      >
        {loading ? <CircularProgress size={20} color="inherit" /> : t('auth.verify')}
      </Button>

      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <MuiLink
          component="button"
          type="button"
          underline="hover"
          disabled={resendIn > 0 || loading}
          onClick={handleResend}
          sx={{ fontSize: '0.875rem', color: resendIn > 0 ? 'text.disabled' : 'primary.main' }}
          data-testid="auth-otp-resend"
        >
          {resendIn > 0 ? t('auth.otpResendIn', { seconds: resendIn }) : t('auth.otpResend')}
        </MuiLink>
      </Box>

      <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <MuiLink
          component="button"
          type="button"
          underline="hover"
          onClick={onBack}
          sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
          data-testid="auth-otp-back"
        >
          {t('auth.otpChangePhone')}
        </MuiLink>
      </Box>
    </>
  )
}
