import { useEffect, useState } from 'react'
import {
  Box, TextField, Button,
  CircularProgress, Alert, Link as MuiLink,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/seo'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS, PASSWORD_MIN } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import { FormErrorAlert } from '@/components/ui'
import AuthShell from './AuthShell'

type Step = 'phone' | 'reset'

const RESEND_COOLDOWN_SECONDS = 60

// Map the reset edge-function error codes to i18n keys. Unknown/no_account is
// folded into the generic "wrong or expired" message to stay neutral about
// whether a phone is registered.
function resetErrorKey(code: string): string {
  switch (code) {
    case 'too_many_attempts': return 'auth.otpTooMany'
    case 'expired':           return 'auth.otpExpired'
    default:                  return 'auth.resetCodeInvalid'
  }
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  useDocumentMeta({ title: t('seo.forgotTitle'), canonicalPath: '/forgot-password' })
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  // Set on the first submit attempt of the current step: from then on empty
  // required fields are flagged inline too.
  const [submitted, setSubmitted] = useState(false)

  // Tick down the resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function requestCode() {
    setSubmitted(true)
    if (!phoneValid) { focusFirstInvalidFieldAfterRender(); return }
    setError(null)
    setLoading(true)
    // Neutral: this always resolves ok regardless of whether the phone exists.
    await supabase.functions.invoke('request-password-reset', {
      body: { phone: toE164Georgian(phone) },
    })
    setLoading(false)
    setCooldown(RESEND_COOLDOWN_SECONDS)
    // Fresh step, fresh fields — don't pre-flag them as missing.
    setSubmitted(false)
    setStep('reset')
  }

  async function submitReset() {
    setSubmitted(true)
    if (!codeValid || password.length < PASSWORD_MIN || password !== confirmPassword) {
      focusFirstInvalidFieldAfterRender()
      return
    }
    setError(null)
    setLoading(true)
    const { data, error: fnErr } = await supabase.functions.invoke('reset-password', {
      body: { phone: toE164Georgian(phone), code, newPassword: password },
    })
    if (fnErr || !data?.ok) {
      setLoading(false)
      setError(t(resetErrorKey(data?.error ?? '')))
      return
    }
    // Auto sign-in with the new password, then land on the dashboard.
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      phone: toE164Georgian(phone), password,
    })
    setLoading(false)
    if (signInErr) {
      // Password was changed but auto-login failed — send them to login to retry.
      navigate('/login')
      return
    }
    navigate('/dashboard')
  }

  const phoneValid = isValidGeorgianPhone(phone)
  const phoneInvalid = (submitted || phone.trim().length > 0) && !phoneValid
  const passwordTooShort = (submitted || password.length > 0) && password.length < PASSWORD_MIN
  const passwordMismatch = (submitted || confirmPassword.length > 0) && password !== confirmPassword
  const codeValid = /^\d{6}$/.test(code)
  const codeInvalid = submitted && !codeValid

  return (
    <AuthShell
      title="პაროლის აღდგენა"
      subtitle={step === 'phone'
        ? 'შეიყვანეთ ტელეფონის ნომერი და გამოგიგზავნით კოდს.'
        : 'შეიყვანეთ მიღებული კოდი და ახალი პაროლი.'}
    >
      <FormErrorAlert message={error} data-testid="forgot-error" />

      {step === 'phone' ? (
        <>
          <TextField
            fullWidth
            required
            label={t('auth.phoneNumber')}
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && requestCode()}
            error={phoneInvalid}
            helperText={phoneInvalid ? t('validation.invalidPhone') : ' '}
            placeholder="599 12 34 56"
            autoFocus
            slotProps={{ htmlInput: { inputMode: 'tel' as const, maxLength: FIELD_LIMITS.phone, 'data-testid': 'forgot-phone' } }}
          />
          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={requestCode}
            disabled={loading}
            sx={{ mt: 1 }}
            data-testid="forgot-send"
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : 'კოდის გაგზავნა'}
          </Button>
        </>
      ) : (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            თუ ამ ნომერზე ანგარიში არსებობს, კოდი გამოგზავნილია.
          </Alert>

          <TextField
            fullWidth
            required
            label="კოდი"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            autoFocus
            error={codeInvalid}
            helperText={codeInvalid ? t('auth.otpEnterCode') : ' '}
            sx={{ mb: 1 }}
            slotProps={{ htmlInput: { inputMode: 'numeric' as const, maxLength: 6, 'data-testid': 'forgot-code' } }}
          />

          <TextField
            fullWidth
            required
            label="ახალი პაროლი"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            error={passwordTooShort}
            helperText={passwordTooShort ? t('validation.passwordTooShortReset') : ' '}
            sx={{ mb: 1 }}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'forgot-password' } }}
          />

          <TextField
            fullWidth
            required
            label="პაროლის დადასტურება"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && submitReset()}
            error={passwordMismatch}
            helperText={passwordMismatch ? t('validation.passwordMismatch') : ' '}
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'forgot-confirm-password' } }}
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={submitReset}
            disabled={loading}
            data-testid="forgot-submit"
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : 'პაროლის შეცვლა'}
          </Button>

          <Box sx={{ mt: 1.5 }}>
            <MuiLink
              component="button"
              type="button"
              underline="hover"
              disabled={cooldown > 0 || loading}
              onClick={requestCode}
              sx={{ fontSize: '0.875rem', color: cooldown > 0 ? 'text.disabled' : 'primary.main' }}
            >
              {cooldown > 0 ? `ხელახლა გაგზავნა (${cooldown})` : 'კოდის ხელახლა გაგზავნა'}
            </MuiLink>
          </Box>
        </>
      )}

      <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <MuiLink
          component="button"
          type="button"
          underline="hover"
          onClick={() => navigate('/login')}
          sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
        >
          ← შესვლაზე დაბრუნება
        </MuiLink>
      </Box>
    </AuthShell>
  )
}
