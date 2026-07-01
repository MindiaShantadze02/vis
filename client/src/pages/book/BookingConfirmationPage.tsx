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
    supabase
      .from('appointments')
      // NB: no `customers(...)` embed — anon (the guest viewing their own
      // confirmation) has no SELECT on the customers table (see RLS
      // customers_select) nor the customer_id column (040 hardening), so
      // embedding it 401s the whole query. The page never renders it anyway.
      .select('id, scheduled_at, duration_minutes, status, payment_method, organisations(name, slug, booking_theme, contact_phone), services(name, price)')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        setAppt(data as unknown as AppointmentDetail)
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <LoadingState />
      </Box>
    )
  }

  if (!appt) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
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
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: bookingTheme.pageBg,
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
