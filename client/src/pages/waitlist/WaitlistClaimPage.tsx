import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box, Typography, Card, CardContent, Button, TextField, CircularProgress, Avatar, Divider, Stack,
} from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { LoadingState, EmptyState, FormErrorAlert } from '@/components/ui'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { CalendarMonthOutlined as CalendarMonthOutlinedIcon } from '@/components/icons'
import { LAYOUT, elevation } from '@/theme/theme'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { dateLocale } from '@/lib/dateLocale'
import { toBusinessWallClock } from '@/lib/slots'
import { anim } from '@/theme/animations'

interface OfferContext {
  org_name: string
  booking_theme: string | null
  service_name: string
  scheduled_at: string
  staff_name: string | null
  status: string
  expires_at: string
  phone_masked: string
  can_claim: boolean
}

type View = 'loading' | 'not_found' | 'closed' | 'offer' | 'otp' | 'done'

/**
 * Public waitlist claim — /waitlist/:token. A freed slot was offered to a
 * waitlisted customer; the token is the capability, and claiming (booking) is
 * OTP-gated via the claim-waitlist edge fn. Themed like the booking pages.
 */
export default function WaitlistClaimPage() {
  const { token } = useParams<{ token: string }>()
  const { t, i18n } = useTranslation()

  const [ctx, setCtx] = useState<OfferContext | null>(null)
  const [view, setView] = useState<View>('loading')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (!token) return
    supabase.rpc('get_waitlist_offer', { p_token: token }).then(({ data }) => {
      const c = (data as OfferContext | null) ?? null
      setCtx(c)
      if (!c || !c.org_name) setView('not_found')
      else if (!c.can_claim) setView('closed')
      else setView('offer')
    })
  }, [token])

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const bookingTheme = getBookingTheme(ctx?.booking_theme)
  const theme = makeBookingTheme(bookingTheme)

  async function requestOtp() {
    setError(null); setBusy(true)
    const { data, error: fnErr } = await supabase.functions.invoke('claim-waitlist', {
      body: { action: 'request-otp', token },
    })
    setBusy(false)
    if (fnErr || !(data as { ok?: boolean })?.ok) { setError(t('waitlist.otpRequestFailed')); return }
    setCode(''); setResendIn(60); setView('otp')
  }

  async function resend() {
    if (resendIn > 0) return
    setError(null)
    await supabase.functions.invoke('claim-waitlist', { body: { action: 'request-otp', token } })
    setResendIn(60)
  }

  async function claim() {
    if (code.length !== 6) return
    setBusy(true); setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('claim-waitlist', {
      body: { action: 'claim', token, code, lang: i18n.resolvedLanguage },
    })
    setBusy(false)
    const res = data as { ok?: boolean; error?: string } | null
    if (fnErr || !res?.ok) {
      const e = res?.error
      if (e === 'wrong_code' || e === 'too_many_attempts' || e === 'expired') { setError(t('waitlist.wrongCode')); return }
      if (e === 'slot_taken') { setError(t('waitlist.slotTaken')); return }
      if (e === 'offer_expired' || e === 'offer_invalid') { setView('closed'); return }
      setError(t('waitlist.claimFailed'))
      return
    }
    setView('done')
  }

  const shell = (children: React.ReactNode) => (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: bookingTheme.pageBg, p: 2 }}>
        <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4, boxShadow: elevation.modal, animation: anim.scaleIn }}>
          <CardContent sx={{ p: 4 }}>{children}</CardContent>
        </Card>
      </Box>
    </ThemeProvider>
  )

  const outcome = (icon: React.ReactNode, title: string, bodyText: string) => shell(
    <Box sx={{ textAlign: 'center' }}>
      <Box sx={{ width: 64, height: 64, borderRadius: '50%', mx: 'auto', mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (th) => `${th.palette.primary.main}1A`, color: 'primary.main' }}>{icon}</Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{bodyText}</Typography>
      {ctx?.org_name && <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 2 }}>{ctx.org_name}</Typography>}
    </Box>,
  )

  if (view === 'loading') {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'text.secondary' }}><LoadingState color="inherit" /></Box>
  }
  if (view === 'not_found') {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><EmptyState icon={<SearchOffOutlinedIcon />} title={t('waitlist.notFoundTitle')} /></Box>
  }
  if (view === 'closed') return outcome(<EventBusyOutlinedIcon sx={{ fontSize: 32 }} />, t('waitlist.closedTitle'), t('waitlist.closedBody'))
  if (view === 'done') return outcome(<CheckCircleOutlinedIcon sx={{ fontSize: 34 }} />, t('waitlist.claimedTitle'), t('waitlist.claimedBody'))

  const when = ctx ? format(toBusinessWallClock(ctx.scheduled_at), 'd MMM yyyy, HH:mm', { locale: dateLocale() }) : ''
  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
      <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.main', fontWeight: 700 }}>{ctx?.org_name?.charAt(0) ?? '?'}</Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>{ctx?.org_name}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{ctx?.service_name}</Typography>
      </Box>
    </Box>
  )

  if (view === 'otp') {
    return shell(
      <>
        {header}
        <Divider sx={{ mb: 3 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{t('waitlist.otpTitle')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{t('waitlist.otpSentTo', { phone: ctx?.phone_masked })}</Typography>
        <FormErrorAlert message={error} data-testid="waitlist-error" sx={{ mb: 2 }} />
        <TextField
          fullWidth value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, 'data-testid': 'waitlist-otp-code', style: { textAlign: 'center', letterSpacing: '0.4em', fontSize: '1.4rem' } } }}
          sx={{ mb: 2 }}
        />
        <Button fullWidth variant="contained" size="large" onClick={claim} disabled={busy || code.length !== 6} data-testid="waitlist-otp-submit">
          {busy ? <CircularProgress size={22} color="inherit" /> : t('waitlist.confirmClaim')}
        </Button>
        <Button fullWidth onClick={resend} disabled={resendIn > 0} sx={{ mt: 1 }}>
          {resendIn > 0 ? t('waitlist.resendIn', { s: resendIn }) : t('waitlist.resend')}
        </Button>
      </>,
    )
  }

  // view === 'offer'
  return shell(
    <>
      {header}
      <Divider sx={{ mb: 3 }} />
      <FormErrorAlert message={error} data-testid="waitlist-error" sx={{ mb: 2 }} />
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{t('waitlist.offerTitle')}</Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CalendarMonthOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="waitlist-offer-when">{when}</Typography>
        </Box>
        {ctx?.staff_name && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{ctx.staff_name}</Typography>}
      </Stack>
      <Button fullWidth variant="contained" size="large" onClick={requestOtp} disabled={busy} data-testid="waitlist-claim">
        {busy ? <CircularProgress size={22} color="inherit" /> : t('waitlist.claimSlot')}
      </Button>
    </>,
  )
}
