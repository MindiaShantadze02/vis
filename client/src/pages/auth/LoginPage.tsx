import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Tabs, Tab,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidEmail, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import { anim } from '@/theme/animations'
import { LAYOUT } from '@/theme/theme'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function reset() {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setError(null)
    setInfo(null)
  }

  async function handleSignIn() {
    setError(null)
    setInfo(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (err) setError(t(mapAuthError(err)))
  }

  async function handleSignUp() {
    if (password.length < 6) { setError(t('validation.passwordTooShort')); return }
    if (password !== confirmPassword) { setError(t('validation.passwordMismatch')); return }
    setError(null)
    setInfo(null)
    setLoading(true)
    const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password })
    setLoading(false)
    if (err) { setError(t(mapAuthError(err))); return }
    // Supabase returns a user with an empty `identities` array when the email is
    // already registered (no error, to avoid leaking account existence). Surface
    // a friendly hint instead of leaving the form looking inert.
    if (data.user && data.user.identities?.length === 0) {
      setError(t('authErrors.emailTaken')); return
    }
    // No session means email confirmation is required — tell the user to check
    // their inbox rather than silently doing nothing.
    if (!data.session) setInfo(t('authErrors.checkInbox'))
  }

  const emailValid = isValidEmail(email)
  const emailInvalid = email.trim().length > 0 && !emailValid
  const passwordTooShort = password.length > 0 && password.length < 6
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canSignIn = emailValid && password.length >= 6
  const canSignUp = emailValid && password.length >= 6 && confirmPassword.length >= 6 && !passwordMismatch

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
          {/* Wordmark */}
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              color: 'primary.main',
              letterSpacing: '-1px',
              mb: 3,
              textAlign: 'center',
            }}
          >
            Grafiki
          </Typography>

          <Tabs
            value={mode}
            onChange={(_, v) => { setMode(v); reset() }}
            variant="fullWidth"
            sx={{ mb: 3 }}
          >
            <Tab value="signin" label="შესვლა" data-testid="login-tab-signin" />
            <Tab value="signup" label="რეგისტრაცია" data-testid="login-tab-signup" />
          </Tabs>

          {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="login-error">{error}</Alert>}
          {info && <Alert severity="success" sx={{ mb: 2 }} data-testid="login-info">{info}</Alert>}

          <TextField
            fullWidth
            label="ელ. ფოსტა"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={emailInvalid}
            helperText={emailInvalid ? t('validation.invalidEmail') : ' '}
            sx={{ mb: 1 }}
            autoFocus
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.email, 'data-testid': 'login-email' } }}
          />

          <TextField
            fullWidth
            label="პაროლი"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => mode === 'signin' && e.key === 'Enter' && canSignIn && handleSignIn()}
            error={mode === 'signup' && passwordTooShort}
            helperText={mode === 'signup' && passwordTooShort ? t('validation.passwordTooShort') : ' '}
            sx={{ mb: mode === 'signup' ? 1 : 2 }}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-password' } }}
          />

          {mode === 'signup' && (
            <TextField
              fullWidth
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
          )}

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={mode === 'signin' ? handleSignIn : handleSignUp}
            disabled={loading || (mode === 'signin' ? !canSignIn : !canSignUp)}
            data-testid="login-submit"
          >
            {loading
              ? <CircularProgress size={20} color="inherit" />
              : mode === 'signin' ? 'შესვლა' : 'ანგარიშის შექმნა'
            }
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}
