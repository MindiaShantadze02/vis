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
import { toBusinessWallClock, BUSINESS_UTC_OFFSET } from '@/lib/slots'
import { isUuid } from '@/lib/validation'
import { anim } from '@/theme/animations'
import Step2DateTimeSelect from '@/pages/book/Step2DateTimeSelect'
import type { BookingService } from '@/pages/book/BookingLayout'

interface ManageContext {
  org_id: string
  org_name: string
  slug: string
  booking_theme: string | null
  service_id: string
  service_name: string
  price: number
  scheduled_at: string
  duration_minutes: number
  staff_id: string | null
  staff_name: string | null
  status: string
  payment_status: string
  phone_masked: string
  cancellation_window_hours: number
  can_manage: boolean
  refund_on_cancel: boolean
}

type View = 'loading' | 'not_found' | 'closed' | 'menu' | 'reschedule' | 'otp' | 'done'
type Action = 'reschedule' | 'cancel'

/**
 * Public self-service page — /manage/:appointmentId. The appointment UUID is the
 * capability (like /review); the actual reschedule/cancel is gated behind a
 * booking OTP to the appointment's phone (handled by the manage-appointment edge
 * fn). Styled to match the booking/confirmation pages.
 */
export default function ManagePage() {
  const { appointmentId } = useParams<{ appointmentId: string }>()
  const { t, i18n } = useTranslation()

  const [ctx, setCtx] = useState<ManageContext | null>(null)
  const [service, setService] = useState<BookingService | null>(null)
  const [view, setView] = useState<View>('loading')
  const [doneKind, setDoneKind] = useState<{ action: Action; refunded: boolean } | null>(null)

  // Pending reschedule selection, captured before the OTP step.
  const [pending, setPending] = useState<{ action: Action; scheduled_at?: string; staff_id?: string | null } | null>(null)

  // OTP step state.
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  async function loadContext() {
    if (!appointmentId) return
    // A malformed id can't match any row — skip the RPC (which would 400 on an
    // invalid uuid) and show not-found directly.
    if (!isUuid(appointmentId)) { setView('not_found'); return }
    const { data } = await supabase.rpc('get_manage_context', { p_appointment_id: appointmentId })
    const c = (data as ManageContext | null) ?? null
    setCtx(c)
    if (!c || !c.org_name) { setView('not_found'); return }
    if (!c.can_manage) { setView('closed'); return }
    // The reschedule picker needs the full service row (capacity etc.).
    const { data: svc } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price, max_per_slot')
      .eq('id', c.service_id)
      .maybeSingle()
    if (svc) setService({ ...(svc as Omit<BookingService, 'image_url'>), image_url: null })
    setView('menu')
  }

  useEffect(() => { loadContext() }, [appointmentId])

  // Resend cooldown countdown.
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(s => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const bookingTheme = getBookingTheme(ctx?.booking_theme)
  const theme = makeBookingTheme(bookingTheme)

  // Kick off an action: text the OTP, then move to the code-entry view.
  async function startAction(action: Action, scheduled_at?: string, staff_id?: string | null) {
    setError(null)
    setBusy(true)
    setPending({ action, scheduled_at, staff_id })
    const { data, error: fnErr } = await supabase.functions.invoke('manage-appointment', {
      body: { action: 'request-otp', appointment_id: appointmentId },
    })
    setBusy(false)
    if (fnErr || !(data as { ok?: boolean })?.ok) {
      setError(t('manage.otpRequestFailed'))
      setView(action === 'reschedule' ? 'reschedule' : 'menu')
      return
    }
    setCode('')
    setResendIn(60)
    setView('otp')
  }

  async function resend() {
    if (resendIn > 0) return
    setError(null)
    await supabase.functions.invoke('manage-appointment', {
      body: { action: 'request-otp', appointment_id: appointmentId },
    })
    setResendIn(60)
  }

  async function submitCode() {
    if (!pending || code.length !== 6) return
    setBusy(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('manage-appointment', {
      body: {
        action: pending.action,
        appointment_id: appointmentId,
        code,
        lang: i18n.resolvedLanguage,
        ...(pending.action === 'reschedule'
          ? { scheduled_at: pending.scheduled_at, staff_id: pending.staff_id ?? null }
          : {}),
      },
    })
    setBusy(false)
    const res = data as { ok?: boolean; error?: string; refunded?: boolean } | null
    if (fnErr || !res?.ok) {
      const e = res?.error
      if (e === 'wrong_code' || e === 'too_many_attempts' || e === 'expired') { setError(t('manage.wrongCode')); return }
      if (e === 'slot_taken') { setError(t('manage.slotTaken')); return }
      setError(t('manage.actionFailed'))
      return
    }
    setDoneKind({ action: pending.action, refunded: !!res.refunded })
    setView('done')
  }

  // Themed card shell (mirrors ReviewPage).
  const shell = (children: React.ReactNode, wide = false) => (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: bookingTheme.pageBg, p: 2 }}>
        <Card sx={{ maxWidth: wide ? 640 : LAYOUT.narrowCard, width: '100%', borderRadius: 4, boxShadow: elevation.modal, animation: anim.scaleIn }}>
          <CardContent sx={{ p: 4 }}>{children}</CardContent>
        </Card>
      </Box>
    </ThemeProvider>
  )

  const outcome = (icon: React.ReactNode, title: string, bodyText: string) => shell(
    <Box sx={{ textAlign: 'center' }}>
      <Box sx={{ width: 64, height: 64, borderRadius: '50%', mx: 'auto', mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (th) => `${th.palette.primary.main}1A`, color: 'primary.main' }}>
        {icon}
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{bodyText}</Typography>
      {ctx?.org_name && <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 2 }}>{ctx.org_name}</Typography>}
    </Box>,
  )

  if (view === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'text.secondary' }}>
        <LoadingState color="inherit" />
      </Box>
    )
  }
  if (view === 'not_found') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <EmptyState icon={<SearchOffOutlinedIcon />} title={t('manage.notFoundTitle')} />
      </Box>
    )
  }
  if (view === 'closed') {
    // A booking can be un-manageable for different reasons; don't tell a
    // customer their (future) cancelled booking "already passed or completed".
    const cancelledish = ctx?.status === 'cancelled' || ctx?.status === 'rejected'
    return outcome(
      <EventBusyOutlinedIcon sx={{ fontSize: 32 }} />,
      t('manage.closedTitle'),
      cancelledish ? t('manage.closedCancelledBody') : t('manage.closedBody'),
    )
  }
  if (view === 'done' && doneKind) {
    return doneKind.action === 'reschedule'
      ? outcome(<CheckCircleOutlinedIcon sx={{ fontSize: 34 }} />, t('manage.rescheduledTitle'), t('manage.rescheduledBody'))
      : outcome(<CheckCircleOutlinedIcon sx={{ fontSize: 34 }} />, t('manage.cancelledTitle'),
          doneKind.refunded ? t('manage.cancelledRefundBody') : t('manage.cancelledBody'))
  }

  const when = ctx ? format(toBusinessWallClock(ctx.scheduled_at), 'd MMM yyyy, HH:mm', { locale: dateLocale() }) : ''

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
      <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.main', fontWeight: 700 }}>{ctx?.org_name?.charAt(0) ?? '?'}</Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, lineHeight: 1.2 }}>{ctx?.org_name}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{[ctx?.service_name, when].filter(Boolean).join(' · ')}</Typography>
      </Box>
    </Box>
  )

  // Reschedule picker (reuses the booking step). onSelect gives business-time
  // date + HH:mm → pin to the business offset for storage.
  if (view === 'reschedule' && ctx && service) {
    return shell(
      <>
        {header}
        <Divider sx={{ mb: 3 }} />
        <Step2DateTimeSelect
          orgId={ctx.org_id}
          service={service}
          initialDate={format(toBusinessWallClock(ctx.scheduled_at), 'yyyy-MM-dd')}
          initialStaffId={ctx.staff_id}
          onSelect={(date, time, staffId) => {
            const scheduled_at = new Date(`${date}T${time}:00${BUSINESS_UTC_OFFSET}`).toISOString()
            startAction('reschedule', scheduled_at, staffId)
          }}
          onBack={() => setView('menu')}
        />
      </>,
      true,
    )
  }

  // OTP entry for the chosen action.
  if (view === 'otp') {
    return shell(
      <>
        {header}
        <Divider sx={{ mb: 3 }} />
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{t('manage.otpTitle')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {t('manage.otpSentTo', { phone: ctx?.phone_masked })}
        </Typography>
        <FormErrorAlert message={error} data-testid="manage-error" sx={{ mb: 2 }} />
        <TextField
          fullWidth
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, 'data-testid': 'manage-otp-code', style: { textAlign: 'center', letterSpacing: '0.4em', fontSize: '1.4rem' } } }}
          sx={{ mb: 2 }}
        />
        <Button fullWidth variant="contained" size="large" onClick={submitCode} disabled={busy || code.length !== 6} data-testid="manage-otp-submit">
          {busy ? <CircularProgress size={22} color="inherit" /> : t('manage.confirm')}
        </Button>
        <Button fullWidth onClick={resend} disabled={resendIn > 0} sx={{ mt: 1 }}>
          {resendIn > 0 ? t('manage.resendIn', { s: resendIn }) : t('manage.resend')}
        </Button>
      </>,
    )
  }

  // view === 'menu'
  return shell(
    <>
      {header}
      <Divider sx={{ mb: 3 }} />
      <FormErrorAlert message={error} data-testid="manage-error" sx={{ mb: 2 }} />
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CalendarMonthOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="body2">{when}</Typography>
        </Box>
        {ctx?.staff_name && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{ctx.staff_name}</Typography>}
      </Stack>

      <Stack spacing={1.5}>
        <Button variant="contained" size="large" onClick={() => { setError(null); setView('reschedule') }} disabled={busy} data-testid="manage-reschedule">
          {t('manage.reschedule')}
        </Button>
        <Button variant="outlined" color="error" size="large" onClick={() => startAction('cancel')} disabled={busy} data-testid="manage-cancel">
          {busy ? <CircularProgress size={22} color="inherit" /> : t('manage.cancel')}
        </Button>
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2, textAlign: 'center' }}>
        {ctx?.refund_on_cancel ? t('manage.cancelRefundNote') : t('manage.cancelNoRefundNote', { hours: ctx?.cancellation_window_hours })}
      </Typography>
    </>,
  )
}
