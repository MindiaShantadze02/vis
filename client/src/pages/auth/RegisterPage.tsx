import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Link as MuiLink, Stack,
} from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import { anim } from '@/theme/animations'
import { LAYOUT } from '@/theme/theme'
import { VERTICALS, type Vertical } from '@/lib/verticals'

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

function isVertical(v: string | undefined): v is Vertical {
  return !!v && (VERTICALS as readonly string[]).includes(v)
}

// Bare /register (or an unknown vertical): let the visitor pick which kind of
// business they're registering. Each choice deep-links to /register/:vertical,
// which is where ads point. This is a marketing picker, NOT the (removed)
// in-onboarding chooser.
function VerticalPicker() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <AuthShell>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center' }}>
        {t('restaurant.choose')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, textAlign: 'center' }}>
        {t('auth.registerSubtitle')}
      </Typography>
      <Stack spacing={1.25}>
        {VERTICALS.map(v => (
          <Box
            key={v}
            data-testid={`register-pick-${v}`}
            onClick={() => navigate(`/register/${v}`)}
            sx={{
              p: 1.75, borderRadius: 2, cursor: 'pointer', border: '2px solid',
              borderColor: 'divider', bgcolor: 'background.paper',
              transition: 'all 0.15s ease',
              '&:hover': { borderColor: 'primary.main' },
            }}
          >
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{t(`restaurant.${v}`)}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t(`restaurant.${v}Desc`)}</Typography>
          </Box>
        ))}
      </Stack>
      <Box sx={{ mt: 2.5, textAlign: 'center' }}>
        <MuiLink
          component="button" type="button" underline="hover"
          onClick={() => navigate('/login')}
          sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
        >
          {t('auth.haveAccount')}
        </MuiLink>
      </Box>
    </AuthShell>
  )
}

export default function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { vertical } = useParams<{ vertical?: string }>()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No vertical (or an unknown one) → show the picker instead of a broken form.
  if (!isVertical(vertical)) return <VerticalPicker />

  async function handleSignUp() {
    if (password.length < 6) { setError(t('validation.passwordTooShort')); return }
    if (password !== confirmPassword) { setError(t('validation.passwordMismatch')); return }
    setError(null)
    setLoading(true)
    // Phone confirmation is disabled (sms_autoconfirm) so a successful sign-up
    // returns a live session. `signup_vertical` in user metadata is what seeds
    // the onboarding flow and locks the org to this vertical.
    const { data, error: err } = await supabase.auth.signUp({
      phone: toE164Georgian(phone),
      password,
      options: { data: { signup_vertical: vertical } },
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
  const passwordTooShort = password.length > 0 && password.length < 6
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canSignUp = phoneValid && password.length >= 6 && confirmPassword.length >= 6 && !passwordMismatch

  return (
    <AuthShell>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center' }}>
        {t('auth.registerTitleFor', { business: t(`restaurant.${vertical}`) })}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3, textAlign: 'center' }}>
        {t(`restaurant.${vertical}Desc`)}
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
        helperText={passwordTooShort ? t('validation.passwordTooShort') : ' '}
        sx={{ mb: 1 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-password' } }}
      />

      <TextField
        fullWidth required
        label="პაროლის დადასტურება"
        type="password"
        value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && canSignUp && handleSignUp()}
        error={passwordMismatch}
        helperText={passwordMismatch ? t('validation.passwordMismatch') : ' '}
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-confirm-password' } }}
      />

      <Button
        fullWidth variant="contained" size="large"
        onClick={handleSignUp}
        disabled={loading || !canSignUp}
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
