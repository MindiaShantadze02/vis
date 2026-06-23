import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Card, Typography, Button, CircularProgress, Stack } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'

type State =
  | { kind: 'loading' }
  | { kind: 'needs_login' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string }

const ERRORS: Record<string, string> = {
  already_in_org: 'თქვენ უკვე ხართ ორგანიზაციის წევრი',
  expired: 'მოწვევის ვადა გავიდა',
  wrong_account: 'ეს მოწვევა სხვა ანგარიშზეა გაგზავნილი',
  not_found: 'მოწვევა ვერ მოიძებნა ან უკვე გამოყენებულია',
  not_authenticated: 'გთხოვთ შეხვიდეთ სისტემაში',
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

  const [state, setState] = useState<State>({ kind: 'loading' })
  const attempted = useRef(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) { setState({ kind: 'needs_login' }); return }
    if (!token || attempted.current) return
    attempted.current = true

    ;(async () => {
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token })
      if (error) { setState({ kind: 'error', message: error.message }); return }
      const result = data as { ok: boolean; error?: string }
      if (!result?.ok) {
        setState({ kind: 'error', message: ERRORS[result?.error ?? ''] ?? 'მოწვევის მიღება ვერ მოხერხდა' })
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
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>მოწვევის დამუშავება…</Typography>
          </Stack>
        )}

        {state.kind === 'needs_login' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>მოწვევის მისაღებად შედით სისტემაში</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              გთხოვთ შეხვიდეთ იმ ანგარიშით, რომელზეც მოწვევა გამოიგზავნა.
            </Typography>
            <Button variant="contained" onClick={() => navigate('/login')}>შესვლა</Button>
          </Stack>
        )}

        {state.kind === 'ok' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48 }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>მოწვევა მიღებულია</Typography>
            <Button variant="contained" onClick={() => navigate('/dashboard')}>დაშბორდზე გადასვლა</Button>
          </Stack>
        )}

        {state.kind === 'error' && (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <ErrorOutlineIcon color="error" sx={{ fontSize: 48 }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{state.message}</Typography>
            <Button variant="outlined" onClick={() => navigate('/dashboard')}>დაშბორდზე გადასვლა</Button>
          </Stack>
        )}
      </Card>
    </Box>
  )
}
