import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Tabs, Tab, Link as MuiLink,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import { anim } from '@/theme/animations'
import { LAYOUT } from '@/theme/theme'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setPhone('')
    setPassword('')
    setConfirmPassword('')
    setError(null)
  }

  async function handleSignIn() {
    setError(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ phone: toE164Georgian(phone), password })
    setLoading(false)
    if (err) setError(t(mapAuthError(err)))
  }

  async function handleSignUp() {
    if (password.length < 6) { setError(t('validation.passwordTooShort')); return }
    if (password !== confirmPassword) { setError(t('validation.passwordMismatch')); return }
    setError(null)
    setLoading(true)
    // Phone confirmation is disabled on the project (sms_autoconfirm), so a
    // successful sign-up returns a live session and logs the user straight in —
    // no SMS code step.
    const { data, error: err } = await supabase.auth.signUp({ phone: toE164Georgian(phone), password })
    setLoading(false)
    if (err) { setError(t(mapAuthError(err))); return }
    // Supabase returns a user with an empty `identities` array when the phone is
    // already registered (no error, to avoid leaking account existence).
    if (data.user && data.user.identities?.length === 0) {
      setError(t('authErrors.phoneTaken')); return
    }
  }

  const phoneValid = isValidGeorgianPhone(phone)
  const phoneInvalid = phone.trim().length > 0 && !phoneValid
  const passwordTooShort = password.length > 0 && password.length < 6
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword
  const canSignIn = phoneValid && password.length >= 6
  const canSignUp = phoneValid && password.length >= 6 && confirmPassword.length >= 6 && !passwordMismatch

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1E2433',
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
            Vis
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
              required
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

          {mode === 'signin' && (
            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <MuiLink
                component="button"
                type="button"
                underline="hover"
                onClick={() => navigate('/forgot-password')}
                sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
                data-testid="login-forgot-password"
              >
                პაროლი დაგავიწყდათ?
              </MuiLink>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
