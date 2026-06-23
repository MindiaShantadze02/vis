import { useEffect, useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Link as MuiLink,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { anim } from '@/theme/animations'
import { LAYOUT } from '@/theme/theme'

type Step = 'phone' | 'reset'

const RESEND_COOLDOWN_SECONDS = 60

// Map the reset edge-function error codes to Georgian copy. Unknown/no_account
// is folded into the generic "wrong or expired" message to stay neutral about
// whether a phone is registered.
function resetErrorText(code: string): string {
  switch (code) {
    case 'too_many_attempts': return 'ბევრი მცდელობა. სცადეთ მოგვიანებით.'
    case 'expired':           return 'კოდს ვადა გაუვიდა. გაგზავნეთ ახალი.'
    default:                  return 'კოდი არასწორია ან ვადაგასულია.'
  }
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Tick down the resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function requestCode() {
    setError(null)
    setLoading(true)
    // Neutral: this always resolves ok regardless of whether the phone exists.
    await supabase.functions.invoke('request-password-reset', {
      body: { phone: toE164Georgian(phone) },
    })
    setLoading(false)
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setStep('reset')
  }

  async function submitReset() {
    if (password.length < 6) { setError(t('validation.passwordTooShort')); return }
    if (password !== confirmPassword) { setError(t('validation.passwordMismatch')); return }
    setError(null)
    setLoading(true)
    const { data, error: fnErr } = await supabase.functions.invoke('reset-password', {
      body: { phone: toE164Georgian(phone), code, newPassword: password },
    })
    if (fnErr || !data?.ok) {
      setLoading(false)
      setError(resetErrorText(data?.error ?? ''))
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
  const phoneInvalid = phone.trim().length > 0 && !phoneValid
  const passwordTooShort = password.length > 0 && password.length < 6
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const codeValid = /^\d{6}$/.test(code)
  const canReset = codeValid && password.length >= 6 && confirmPassword.length >= 6 && !passwordMismatch

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1565C0',
        p: 2,
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: LAYOUT.narrowCard,
          borderRadius: 4,
          animation: anim.scaleIn,
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.20), 0 0 0 1px rgba(255,255,255,0.10)',
          border: 'none',
          '&:hover': { transform: 'none', boxShadow: '0 24px 64px rgba(0,0,0,0.20), 0 0 0 1px rgba(255,255,255,0.10)' },
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Typography
            variant="h5"
            sx={{ fontWeight: 800, color: 'primary.main', letterSpacing: '-0.5px', mb: 1, textAlign: 'center' }}
          >
            პაროლის აღდგენა
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, textAlign: 'center' }}>
            {step === 'phone'
              ? 'შეიყვანეთ ტელეფონის ნომერი და გამოგიგზავნით კოდს.'
              : 'შეიყვანეთ მიღებული კოდი და ახალი პაროლი.'}
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="forgot-error">{error}</Alert>}

          {step === 'phone' ? (
            <>
              <TextField
                fullWidth
                label={t('auth.phoneNumber')}
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && phoneValid && !loading && requestCode()}
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
                disabled={loading || !phoneValid}
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
                label="კოდი"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                autoFocus
                sx={{ mb: 1 }}
                slotProps={{ htmlInput: { inputMode: 'numeric' as const, maxLength: 6, 'data-testid': 'forgot-code' } }}
              />

              <TextField
                fullWidth
                label="ახალი პაროლი"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                error={passwordTooShort}
                helperText={passwordTooShort ? t('validation.passwordTooShort') : ' '}
                sx={{ mb: 1 }}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'forgot-password' } }}
              />

              <TextField
                fullWidth
                label="პაროლის დადასტურება"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canReset && !loading && submitReset()}
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
                disabled={loading || !canReset}
                data-testid="forgot-submit"
              >
                {loading ? <CircularProgress size={20} color="inherit" /> : 'პაროლის შეცვლა'}
              </Button>

              <Box sx={{ mt: 1.5, textAlign: 'center' }}>
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

          <Box sx={{ mt: 2, textAlign: 'center' }}>
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
        </CardContent>
      </Card>
    </Box>
  )
}
