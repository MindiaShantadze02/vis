import { useState, useEffect, useRef } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Link as MuiLink,
  Checkbox, FormControlLabel,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import { anim } from '@/theme/animations'
import { LAYOUT } from '@/theme/theme'

// Shared dark-hero shell so /register matches /login.
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#1E2433', p: 2,
      }}
    >
      <Card
        sx={{
          width: '100%', maxWidth: LAYOUT.narrowCard, borderRadius: 4,
          animation: anim.scaleIn, background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.20), 0 0 0 1px rgba(255,255,255,0.10)',
          border: 'none',
          '&:hover': { transform: 'none', boxShadow: '0 24px 64px rgba(0,0,0,0.20), 0 0 0 1px rgba(255,255,255,0.10)' },
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Typography
            variant="h4"
            sx={{ fontWeight: 800, color: 'primary.main', letterSpacing: '-1px', mb: 3, textAlign: 'center' }}
          >
            Vis
          </Typography>
          {children}
        </CardContent>
      </Card>
    </Box>
  )
}

export default function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [consentError, setConsentError] = useState(false)
  // Bumped on each blocked submit so the hint re-animates (re-flashes) every time.
  const [consentNudge, setConsentNudge] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-clear the consent highlight after a few seconds so it can trigger again
  // rather than staying red forever.
  const consentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (consentTimer.current) clearTimeout(consentTimer.current) }, [])

  function flagConsent() {
    setConsentError(true)
    setConsentNudge(n => n + 1)
    if (consentTimer.current) clearTimeout(consentTimer.current)
    consentTimer.current = setTimeout(() => setConsentError(false), 4000)
  }

  async function handleSignUp() {
    // Consent is required — surface it explicitly rather than silently disabling
    // the button, which leaves users stuck without knowing why.
    if (!consent) { flagConsent(); return }
    if (password.length < 10) { setError(t('validation.passwordTooShortReset')); return }
    if (password !== confirmPassword) { setError(t('validation.passwordMismatch')); return }
    setError(null)
    setLoading(true)
    // Phone confirmation is disabled (sms_autoconfirm) so a successful sign-up
    // returns a live session.
    const { data, error: err } = await supabase.auth.signUp({
      phone: toE164Georgian(phone),
      password,
    })
    setLoading(false)
    if (err) { setError(t(mapAuthError(err))); return }
    // Supabase returns an empty `identities` array when the phone is already
    // registered (no error, to avoid leaking account existence).
    if (data.user && data.user.identities?.length === 0) {
      setError(t('authErrors.phoneTaken')); return
    }
  }

  const phoneValid = isValidGeorgianPhone(phone)
  const phoneInvalid = phone.trim().length > 0 && !phoneValid
  const passwordTooShort = password.length > 0 && password.length < 10
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  // Enabled once the credentials are valid; consent is checked on submit (with a
  // visible message) so the button never blocks for a hidden reason.
  const credsValid = phoneValid && password.length >= 10 && confirmPassword.length >= 10 && !passwordMismatch

  return (
    <AuthShell>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center' }}>
        {t('auth.registerTitle')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, textAlign: 'center' }}>
        {t('auth.registerSubtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">{error}</Alert>}

      <TextField
        fullWidth required
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
        fullWidth required
        label="პაროლი"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        error={passwordTooShort}
        helperText={passwordTooShort ? t('validation.passwordTooShortReset') : ' '}
        sx={{ mb: 1 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-password' } }}
      />

      <TextField
        fullWidth required
        label="პაროლის დადასტურება"
        type="password"
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && credsValid && handleSignUp()}
        error={passwordMismatch}
        helperText={passwordMismatch ? t('validation.passwordMismatch') : ' '}
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-confirm-password' } }}
      />

      <Box sx={{ mb: 2 }}>
        <FormControlLabel
          sx={{ alignItems: 'flex-start', mr: 0 }}
          control={
            <Checkbox
              checked={consent}
              onChange={e => {
                setConsent(e.target.checked)
                if (e.target.checked) {
                  setConsentError(false)
                  if (consentTimer.current) clearTimeout(consentTimer.current)
                }
              }}
              size="small"
              color={consentError ? 'error' : 'primary'}
              sx={{ pt: 0.25 }}
              data-testid="register-consent"
            />
          }
          label={
            <Typography variant="caption" sx={{ color: consentError ? 'error.main' : 'text.secondary', lineHeight: 1.5 }}>
              <Trans
                i18nKey="common.consent"
                components={{
                  priv: <MuiLink href="/privacy" target="_blank" rel="noopener" underline="hover" />,
                  terms: <MuiLink href="/terms" target="_blank" rel="noopener" underline="hover" />,
                }}
              />
            </Typography>
          }
        />
        {consentError && (
          <Typography
            key={consentNudge}
            variant="caption"
            sx={{ color: 'error.main', display: 'block', ml: '30px', mt: 0.25, animation: anim.fadeIn }}
            data-testid="consent-error"
          >
            {t('validation.consentRequired')}
          </Typography>
        )}
      </Box>

      <Button
        fullWidth variant="contained" size="large"
        onClick={handleSignUp}
        disabled={loading || !credsValid}
        data-testid="login-submit"
      >
        {loading ? <CircularProgress size={20} color="inherit" /> : 'ანგარიშის შექმნა'}
      </Button>

      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <MuiLink
          component="button" type="button" underline="hover"
          onClick={() => navigate('/login')}
          sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
          data-testid="register-to-login"
        >
          {t('auth.haveAccount')}
        </MuiLink>
      </Box>
    </AuthShell>
  )
}
