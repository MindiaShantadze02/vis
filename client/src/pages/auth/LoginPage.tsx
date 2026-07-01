import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Link as MuiLink, Stack,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import { anim } from '@/theme/animations'
import { LAYOUT } from '@/theme/theme'

// Sign-in only. Registration lives on /register/:vertical so each ad can point
// at its own vertical-specific signup (see RegisterPage).
export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    setError(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ phone: toE164Georgian(phone), password })
    setLoading(false)
    if (err) setError(t(mapAuthError(err)))
  }

  const phoneValid = isValidGeorgianPhone(phone)
  const phoneInvalid = phone.trim().length > 0 && !phoneValid
  const canSignIn = phoneValid && password.length >= 6

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

          <Typography variant="h6" sx={{ fontWeight: 700, mb: 3, textAlign: 'center' }}>
            {t('auth.login')}
          </Typography>

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
            onKeyDown={e => e.key === 'Enter' && canSignIn && handleSignIn()}
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.password, 'data-testid': 'login-password' } }}
          />

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleSignIn}
            disabled={loading || !canSignIn}
            data-testid="login-submit"
          >
            {loading ? <CircularProgress size={20} color="inherit" /> : 'შესვლა'}
          </Button>

          <Stack spacing={1.25} sx={{ mt: 2, textAlign: 'center' }}>
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
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
