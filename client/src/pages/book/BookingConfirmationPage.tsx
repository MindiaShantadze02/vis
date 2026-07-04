import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Typography, Card, CardContent, Button } from '@mui/material'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { AccessTimeOutlined as AccessTimeOutlinedIcon } from '@/components/icons'
import { CalendarMonthOutlined as CalendarMonthOutlinedIcon } from '@/components/icons'
import { SearchOffOutlined as SearchOffOutlinedIcon } from '@/components/icons'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { displayGeorgianPhone, toE164Georgian } from '@/lib/validation'
import { LoadingState, EmptyState, StatusChip, BookingTicket } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import { ThemeProvider, alpha } from '@mui/material/styles'
import { motion } from 'framer-motion'
import { listItem } from '@/theme/motion'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'
import { inIframe, postToParent } from './useEmbedBridge'
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
  const [appt, setAppt] = useState<AppointmentDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
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
        <EmptyState icon={<SearchOffOutlinedIcon />} title="ჯავშანი ვერ მოიძებნა" />
      </Box>
    )
  }

  const scheduledAt = new Date(appt.scheduled_at)
  const isPending = appt.status === 'pending'
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
              bgcolor: isPending ? 'warning.light' : 'success.light',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mx: 'auto', mb: 2,
            }}
          >
            <CheckCircleOutlinedIcon
              sx={{ fontSize: 38, color: isPending ? 'warning.main' : 'success.main' }}
            />
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            {isPending ? 'ჯავშანი მიღებულია!' : 'ჯავშანი დადასტურებულია!'}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {isPending
              ? 'ბიზნესი მალე დაგიდასტურებთ'
              : 'გელოდებიან დანიშნულ დროს'
            }
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
              statusLabel="სტატუსი"
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
                  label: format(scheduledAt, 'EEEE', { locale: ka }),
                  value: format(scheduledAt, 'd MMMM yyyy, HH:mm', { locale: ka }),
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
                  ჯავშნის გასაუქმებლად ან შესაცვლელად დაგვირეკეთ
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
            კიდევ ერთი ჯავშანი
          </Button>
        </CardContent>
      </Card>
    </Box>
    </ThemeProvider>
  )
}
