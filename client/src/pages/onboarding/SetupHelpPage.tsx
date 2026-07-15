import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack,
  CircularProgress, Link,
} from '@mui/material'
import { TaskAltOutlined as TaskAltOutlinedIcon } from '@/components/icons'
import { SupportOutlined as SupportOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { displayGeorgianPhone } from '@/lib/validation'
import { FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import VisLogo from '@/components/VisLogo'
import { FormErrorAlert } from '@/components/ui'

type ViewState = 'loading' | 'form' | 'pending' | 'submitted'

/**
 * Concierge onboarding: instead of walking the wizard, a business describes
 * itself in one guided form and a Vis superadmin configures the account on
 * its behalf (setup_requests queue). The requester is texted when everything
 * is ready. One open request per account; it can be withdrawn while pending.
 */
export default function SetupHelpPage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const [view, setView] = useState<ViewState>('loading')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const [businessName, setBusinessName] = useState('')
  const [address, setAddress] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set on the first submit attempt: from then on invalid/empty required
  // fields are flagged inline.
  const [submitted, setSubmitted] = useState(false)

  const nameTooShort = submitted && businessName.trim().length < 2
  const detailsTooShort = submitted && details.trim().length < 10

  // user.phone is stored without the leading + (see auth notes).
  const phoneLabel = user?.phone ? displayGeorgianPhone(user.phone.replace(/^995/, '')) : ''

  useEffect(() => {
    if (!user) return
    async function check() {
      // Explicit user filter: RLS alone isn't enough for a superadmin viewer,
      // whose policy exposes every request.
      const { data } = await supabase
        .from('setup_requests')
        .select('id')
        .eq('user_id', user!.id)
        .eq('status', 'pending')
        .maybeSingle()
      setPendingId(data?.id ?? null)
      setView(data ? 'pending' : 'form')
    }
    check()
  }, [user])

  async function submit() {
    setSubmitted(true)
    if (businessName.trim().length < 2 || details.trim().length < 10) {
      focusFirstInvalidFieldAfterRender()
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: rpcErr } = await supabase.rpc('submit_setup_request', {
      p_business_name: businessName.trim(),
      p_address: address.trim() || null,
      p_details: details.trim(),
    })
    setBusy(false)
    const res = data as { ok?: boolean; error?: string } | null
    if (rpcErr || !res?.ok) {
      if (res?.error === 'already_pending') { setView('pending'); return }
      setError(rpcErr?.message ?? res?.error ?? 'error')
      return
    }
    setView('submitted')
  }

  async function cancelRequest() {
    if (!pendingId) {
      // Landed in 'pending' via submit-race — re-resolve the id, then delete.
      const { data } = await supabase
        .from('setup_requests')
        .select('id')
        .eq('user_id', user!.id)
        .eq('status', 'pending')
        .maybeSingle()
      if (!data) { setView('form'); return }
      setPendingId(data.id)
      await supabase.from('setup_requests').delete().eq('id', data.id)
      setView('form')
      return
    }
    setBusy(true)
    const { error: delErr } = await supabase.from('setup_requests').delete().eq('id', pendingId)
    setBusy(false)
    if (delErr) { setError(delErr.message); return }
    setPendingId(null)
    setView('form')
  }

  const frame = (content: React.ReactNode) => (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column', alignItems: 'center', px: 2, py: { xs: 4, md: 8 } }}>
      {/* Brand wordmark (shared VisLogo SVG). */}
      <Box sx={{ mb: 4 }}>
        <VisLogo height={24} />
      </Box>
      <Card sx={{ width: '100%', maxWidth: 560 }}>
        <CardContent sx={{ p: { xs: 3, md: 4 } }}>{content}</CardContent>
      </Card>
      <Link component={RouterLink} to="/onboarding/business" variant="body2" sx={{ mt: 3, fontWeight: 600 }}>
        {t('onboarding.helpDoItMyself')}
      </Link>
    </Box>
  )

  if (view === 'loading') {
    return frame(<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>)
  }

  if (view === 'pending' || view === 'submitted') {
    return frame(
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }} data-testid="setup-help-pending">
        <TaskAltOutlinedIcon sx={{ fontSize: 44, color: 'success.main' }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t('onboarding.helpSuccessTitle')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
          {t('onboarding.helpSuccessBody', { phone: phoneLabel })}
        </Typography>
        {view === 'pending' && (
          <Button size="small" color="inherit" onClick={cancelRequest} disabled={busy} sx={{ color: 'text.secondary' }} data-testid="setup-help-cancel">
            {t('onboarding.helpCancel')}
          </Button>
        )}
      </Stack>,
    )
  }

  return frame(
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <SupportOutlinedIcon sx={{ fontSize: 28, color: 'primary.main', mt: 0.25 }} />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('onboarding.helpTitle')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, lineHeight: 1.65 }}>
            {t('onboarding.helpSubtitle')}
          </Typography>
        </Box>
      </Box>

      <FormErrorAlert message={error} data-testid="setup-help-error" sx={{ mb: 0 }} />

      <TextField
        label={t('onboarding.helpBusinessName')}
        value={businessName}
        onChange={e => setBusinessName(e.target.value)}
        required
        fullWidth
        error={nameTooShort}
        helperText={nameTooShort ? t('validation.minLength', { min: 2 }) : undefined}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.orgName, 'data-testid': 'setup-help-name' } }}
      />
      <TextField
        label={t('onboarding.helpAddress')}
        value={address}
        onChange={e => setAddress(e.target.value)}
        fullWidth
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.address, 'data-testid': 'setup-help-address' } }}
      />
      <TextField
        label={t('onboarding.helpDetails')}
        value={details}
        onChange={e => setDetails(e.target.value)}
        required
        fullWidth
        multiline
        rows={7}
        placeholder={t('onboarding.helpDetailsPlaceholder')}
        error={detailsTooShort}
        helperText={detailsTooShort ? t('onboarding.helpValidation') : t('onboarding.helpDetailsHint')}
        slotProps={{ htmlInput: { maxLength: 4000, 'data-testid': 'setup-help-details' } }}
      />

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('onboarding.helpSmsNote', { phone: phoneLabel })}
      </Typography>

      <Button
        variant="contained"
        size="large"
        onClick={submit}
        disabled={busy}
        data-testid="setup-help-submit"
      >
        {busy ? <CircularProgress size={22} color="inherit" /> : t('onboarding.helpSubmit')}
      </Button>
    </Stack>,
  )
}
