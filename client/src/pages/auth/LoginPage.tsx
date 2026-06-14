import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, CircularProgress, Alert, Tabs, Tab,
} from '@mui/material'
import { supabase } from '@/lib/supabase'

type Mode = 'signin' | 'signup'

export default function LoginPage() {
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
    if (password !== confirmPassword) { setError('პაროლები არ ემთხვევა'); return }
    if (password.length < 6) { setError('პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს'); return }
    setError(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signUp({ email: email.trim(), password })
    setLoading(false)
    if (err) setError(err.message)
  }

  const emailValid = email.includes('@')
  const canSignIn = emailValid && password.length >= 6
  const canSignUp = emailValid && password.length >= 6 && confirmPassword.length >= 6

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #3D52D5 0%, #2A3A9E 100%)',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420, borderRadius: 4 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography
            variant="h4"
            sx={{ fontWeight: 700, color: 'primary.main', letterSpacing: '-0.5px', mb: 3, textAlign: 'center' }}
          >
            Grafiki
          </Typography>

          <Tabs value={mode} onChange={(_, v) => { setMode(v); reset() }} variant="fullWidth" sx={{ mb: 3 }}>
            <Tab value="signin" label="შესვლა" />
            <Tab value="signup" label="რეგისტრაცია" />
          </Tabs>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <TextField
            fullWidth
            label="ელ. ფოსტა"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            sx={{ mb: 2 }}
            autoFocus
          />

          <TextField
            fullWidth
            label="პაროლი"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => mode === 'signin' && e.key === 'Enter' && canSignIn && handleSignIn()}
            sx={{ mb: mode === 'signup' ? 2 : 3 }}
          />

          {mode === 'signup' && (
            <TextField
              fullWidth
              label="პაროლის დადასტურება"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canSignUp && handleSignUp()}
              sx={{ mb: 3 }}
            />
          )}

          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={mode === 'signin' ? handleSignIn : handleSignUp}
            disabled={loading || (mode === 'signin' ? !canSignIn : !canSignUp)}
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
