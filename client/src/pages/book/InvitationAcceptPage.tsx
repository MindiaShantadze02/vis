import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Card, Typography, Button, CircularProgress, Stack } from '@mui/material'
import { CheckCircleOutlined as CheckCircleOutlineIcon } from '@/components/icons'
import { ErrorOutlined as ErrorOutlineIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'

type State =
  | { kind: 'loading' }
  | { kind: 'needs_login' }
  | { kind: 'ok' }
  // Hold the translation key (resolved at render), not a baked-in message.
  | { kind: 'error'; errorKey: string }

/** Maps an accept_invitation() error code to an `invites.*` translation key. */
const ERROR_KEYS: Record<string, string> = {
  already_in_org: 'invites.errAlreadyInOrg',
  expired: 'invites.errExpired',
  wrong_account: 'invites.errWrongAccount',
  not_found: 'invites.errNotFoundOrUsed',
  not_authenticated: 'invites.errNotAuthenticated',
}

/**
 * Token-based invitation acceptance (e.g. from a link). Requires the user to be
 * logged in with the invited email; the accept_invitation RPC enforces that.
 */
export default function InvitationAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const { user, loading: authLoading } = useAuth()
  const { refresh } = useOrg()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [state, setState] = useState<State>({ kind: 'loading' })
  const attempted = useRef(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) { setState({ kind: 'needs_login' }); return }
    if (!token || attempted.current) return
    attempted.current = true

    ;(async () => {
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token })
      if (error) { setState({ kind: 'error', errorKey: 'invites.errAcceptFailed' }); return }
      const result = data as { ok: boolean; error?: string }
      if (!result?.ok) {
        setState({ kind: 'error', errorKey: ERROR_KEYS[result?.error ?? ''] ?? 'invites.errAcceptFailed' })
        return
      }
      await refresh()
      setState({ kind: 'ok' })
    })()
  }, [authLoading, user, token, refresh])

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 2 }}>
      <Card sx={{ p: 4, maxWidth: 400, width: '100%', textAlign: 'center' }}>
        {state.kind === 'loading' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <CircularProgress />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('invites.processing')}</Typography>
          </Stack>
        )}

        {state.kind === 'needs_login' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('invites.signInToAccept')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('invites.signInHint')}
            </Typography>
            <Button variant="contained" onClick={() => navigate('/login')}>{t('invites.signIn')}</Button>
          </Stack>
        )}

        {state.kind === 'ok' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('invites.accepted')}</Typography>
            <Button variant="contained" onClick={() => navigate('/dashboard')}>{t('invites.goToDashboard')}</Button>
          </Stack>
        )}

        {state.kind === 'error' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <ErrorOutlineIcon color="error" sx={{ fontSize: 48 }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t(state.errorKey)}</Typography>
            <Button variant="outlined" onClick={() => navigate('/dashboard')}>{t('invites.goToDashboard')}</Button>
          </Stack>
        )}
      </Card>
    </Box>
  )
}
