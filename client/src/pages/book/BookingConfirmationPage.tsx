import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Typography, Card, CardContent, Button } from '@mui/material'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { AccessTimeOutlined as AccessTimeOutlinedIcon } from '@/components/icons'
import { CalendarMonthOutlined as CalendarMonthOutlinedIcon } from '@/components/icons'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { dateLocale } from '@/lib/dateLocale'
import { supabase } from '@/lib/supabase'
import { displayGeorgianPhone, toE164Georgian, isUuid } from '@/lib/validation'
import { toBusinessWallClock } from '@/lib/slots'
import { LoadingState, EmptyState, StatusChip, BookingTicket } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import { ThemeProvider, alpha } from '@mui/material/styles'
import { motion } from 'framer-motion'
import { listItem } from '@/theme/motion'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { inIframe, postToParent } from './useEmbedBridge'
import { prepareRebookDraft } from './bookingDraft'
import type { AppointmentStatus } from '@/components/ui'

interface AppointmentDetail {
  id: string
  scheduled_at: string
  duration_minutes: number
  status: string
  payment_method: string
  organisations: { name: string; slug: string; booking_theme: string | null; contact_phone: string | null } | null
  services: { name: string; price: number } | null
}

export default function BookingConfirmationPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [appt, setAppt] = useState<AppointmentDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    // A malformed id would 400 on the RPC and burn the whole retry budget before
    // rendering not-found; short-circuit it.
    if (!isUuid(id)) { setLoading(false); return }
    let cancelled = false

    // We almost always land here immediately after creating the booking, so a
    // missing row is far more likely a transient read (network blip, a brief
    // 5xx, read lag right after the write) than a genuinely absent booking.
    // `.single()` also raises PGRST116 on zero rows, which the old code
    // swallowed and rendered as a permanent "not found". Use `.maybeSingle()`
    // (null, not error, when absent) and retry on any error/empty before giving
    // up, so a real booking never gets stuck on the not-found screen.
    async function load(attempt = 0) {
      // Fetched via a SECURITY DEFINER RPC (not a direct table read): the
      // organisations table is org-scoped by RLS (066 hardening), so anon can't
      // read it directly; the RPC returns only the public confirmation fields
      // (appointment + org public + service) for this appointment id.
      const { data, error } = await supabase
        .rpc('get_booking_confirmation', { p_appointment_id: id })
      if (cancelled) return
      if ((error || !data) && attempt < 4) {
        // Back off a little between tries: ~0.4s, 0.8s, 1.2s, 1.6s (≈4s total).
        setTimeout(() => { if (!cancelled) load(attempt + 1) }, 400 * (attempt + 1))
        return
      }
      setAppt((data as unknown as AppointmentDetail) ?? null)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [id])

  // Let the embedding site react to a completed booking (e.g. analytics, custom
  // thank-you). No-op when not embedded.
  useEffect(() => {
    if (appt) postToParent({ type: 'vis:booked', appointmentId: appt.id, status: appt.status })
  }, [appt])

  // The booking is done, so rewind its saved draft: "Book another" (and browser
  // back, and any later visit to /book/:slug in this tab) must land on the
  // date/time step with the slot they just took cleared, instead of resuming on
  // the details step and failing the resubmit with 'slot_taken'. Their details
  // and service are kept — only the time goes.
  useEffect(() => {
    if (appt) prepareRebookDraft(appt.organisations?.slug)
  }, [appt])

  if (loading) {
    // Appointment (and its org booking theme) not loaded yet — keep the spinner
    // neutral grey instead of inheriting the base app accent.
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: inIframe ? 320 : '100vh', color: 'text.secondary' }}>
        <LoadingState color="inherit" />
      </Box>
    )
  }

  if (!appt) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: inIframe ? 320 : '100vh' }}>
        <EmptyState icon={<SearchOffOutlinedIcon />} title={t('manage.notFoundTitle')} />
      </Box>
    )
  }

  // Render in the business's (Georgia) wall clock, not the viewer's zone —
  // the appointment happens at the salon, wherever the customer is browsing.
  const scheduledAt = toBusinessWallClock(appt.scheduled_at)
  const bookingTheme = getBookingTheme(appt.organisations?.booking_theme)

  return (
    <ThemeProvider theme={makeBookingTheme(bookingTheme)}>
    <Box
      sx={{
        minHeight: inIframe ? 'auto' : '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: inIframe ? 'background.paper' : bookingTheme.pageBg,
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4 }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          {/* Icon — springs in for a small moment of payoff. */}
          <Box
            component={motion.div}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
            sx={{
              width: 72, height: 72, borderRadius: '50%',
              bgcolor: 'success.light',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mx: 'auto', mb: 2,
            }}
          >
            <CheckCircleOutlinedIcon sx={{ fontSize: 38, color: 'success.main' }} />
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            {t('booking.confirmApprovedTitle')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {t('booking.confirmApprovedSub')}
          </Typography>

          {/* Details — rendered as a tear-off ticket stub (the signature). */}
          <Box
            component={motion.div}
            variants={listItem}
            initial="hidden"
            animate="visible"
            sx={{ mb: 3 }}
          >
            <BookingTicket
              notchColor={bookingTheme.pageBg}
              priceColor={bookingTheme.deep}
              statusLabel={t('booking.statusLabel')}
              status={<StatusChip status={appt.status as AppointmentStatus} />}
              price={`${appt.services?.price} ₾`}
              rows={[
                {
                  icon: <CalendarMonthOutlinedIcon />,
                  label: appt.organisations?.name ?? '',
                  value: appt.services?.name ?? '',
                },
                {
                  icon: <AccessTimeOutlinedIcon />,
                  label: format(scheduledAt, 'EEEE', { locale: dateLocale() }),
                  value: format(scheduledAt, 'd MMMM yyyy, HH:mm', { locale: dateLocale() }),
                },
              ]}
            />
          </Box>

          {/* Cancellation is handled by the business directly — guests have no
              self-service cancel, so point them to the org's phone number. */}
          {appt.organisations?.contact_phone && (
            <Box
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                p: 1.5, mb: 3, borderRadius: 2, textAlign: 'left',
                bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
                border: (t) => `1px solid ${alpha(t.palette.primary.main, 0.3)}`,
                color: 'primary.dark',
              }}
            >
              <PhoneOutlinedIcon fontSize="small" sx={{ color: 'primary.dark' }} />
              <Box>
                <Typography variant="caption" sx={{ display: 'block', color: 'primary.dark', opacity: 0.9 }}>
                  {t('booking.callToChange')}
                </Typography>
                <Typography
                  variant="body2"
                  component="a"
                  href={`tel:${toE164Georgian(appt.organisations.contact_phone)}`}
                  sx={{ fontWeight: 700, color: 'primary.dark', textDecoration: 'none' }}
                >
                  {displayGeorgianPhone(appt.organisations.contact_phone)}
                </Typography>
              </Box>
            </Box>
          )}

          <Button
            fullWidth
            variant="contained"
            onClick={() => navigate(`/book/${appt.organisations?.slug}`)}
            data-testid="confirm-book-another"
          >
            {t('booking.bookAnother')}
          </Button>
        </CardContent>
      </Card>
    </Box>
    </ThemeProvider>
  )
}
