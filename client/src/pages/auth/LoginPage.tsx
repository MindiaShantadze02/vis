import { useState } from 'react'
import {
  Box, TextField, Button,
  CircularProgress, Alert, Link as MuiLink, Stack,
  IconButton, InputAdornment,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { VisibilityOutlined as VisibilityIcon } from '@/components/icons'
import { VisibilityOffOutlined as VisibilityOffIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, toE164Georgian, FIELD_LIMITS } from '@/lib/validation'
import { mapAuthError } from '@/lib/authErrors'
import AuthShell from './AuthShell'

// Sign-in only. Registration lives on /register (see RegisterPage).
export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
    <AuthShell title={t('auth.login')}>
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
        label={t('auth.password')}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && canSignIn && handleSignIn()}
        sx={{ mb: 2 }}
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

      <Button
        fullWidth
        variant="contained"
        size="large"
        onClick={handleSignIn}
        disabled={loading || !canSignIn}
        data-testid="login-submit"
      >
        {loading ? <CircularProgress size={20} color="inherit" /> : t('auth.login')}
      </Button>

      <Stack spacing={1.25} sx={{ mt: 3, pt: 2.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Box>
          <MuiLink
            component="button"
            type="button"
            underline="hover"
            onClick={() => navigate('/forgot-password')}
            sx={{ fontSize: '0.875rem', color: 'text.secondary' }}
            data-testid="login-forgot-password"
          >
            {t('auth.forgotPassword')}
          </MuiLink>
        </Box>
        <Box>
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
        </Box>
      </Stack>
    </AuthShell>
  )
}
