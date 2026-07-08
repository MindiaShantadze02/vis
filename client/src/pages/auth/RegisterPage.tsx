import { useState, useEffect, useRef } from 'react'
import {
  Box, TextField, Button,
  Typography, CircularProgress, Alert, Link as MuiLink,
  Checkbox, FormControlLabel, IconButton, InputAdornment,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { VisibilityOutlined as VisibilityIcon } from '@/components/icons'
import { VisibilityOffOutlined as VisibilityOffIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import { anim } from '@/theme/animations'
import AuthShell from './AuthShell'

export default function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <AuthShell title={t('auth.registerTitle')} subtitle={t('auth.registerSubtitle')}>
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
        label={t('auth.password')}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={e => setPassword(e.target.value)}
        error={passwordTooShort}
        // The min-length requirement is stated up front, not first revealed by
        // a rejection after the user has already picked a password.
        helperText={passwordTooShort ? t('validation.passwordTooShortReset') : t('validation.passwordHint')}
        sx={{ mb: 1 }}
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

      <TextField
        fullWidth required
        label={t('auth.confirmPassword')}
        type={showPassword ? 'text' : 'password'}
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
        {loading ? <CircularProgress size={20} color="inherit" /> : t('auth.createAccount')}
      </Button>

      <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
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
