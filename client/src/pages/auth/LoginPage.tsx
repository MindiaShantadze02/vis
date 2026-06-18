import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Tabs, Tab,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
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

  function reset() {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setError(null)
  }

  async function handleSignIn() {
    setError(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (err) setError(err.message)
  }

  async function handleSignUp() {
    if (password.length < 6) { setError(t('validation.passwordTooShort')); return }
    if (password !== confirmPassword) { setError(t('validation.passwordMismatch')); return }
    setError(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signUp({ email: email.trim(), password })
    setLoading(false)
    if (err) setError(err.message)
  }

  const emailValid = email.includes('@')
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
        background: `
          radial-gradient(ellipse 80% 60% at 20% 10%, rgba(124,58,237,0.40) 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 80% 90%, rgba(167,139,250,0.25) 0%, transparent 55%),
          radial-gradient(ellipse 50% 40% at 65% 45%, rgba(244,114,182,0.12) 0%, transparent 50%),
          linear-gradient(135deg, #2E1065 0%, #4C1D95 50%, #5B21B6 100%)
        `,
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
          {/* Gradient wordmark */}
          <Typography
            variant="h4"
            sx={{
              fontWeight: 800,
              background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
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

          <TextField
            fullWidth
            label="ელ. ფოსტა"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            sx={{ mb: 2 }}
            autoFocus
            slotProps={{ htmlInput: { 'data-testid': 'login-email' } }}
          />

          <TextField
            fullWidth
            label="პაროლი"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => mode === 'signin' && e.key === 'Enter' && canSignIn && handleSignIn()}
            sx={{ mb: mode === 'signup' ? 2 : 3 }}
            slotProps={{ htmlInput: { 'data-testid': 'login-password' } }}
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
              slotProps={{ htmlInput: { 'data-testid': 'login-confirm-password' } }}
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
