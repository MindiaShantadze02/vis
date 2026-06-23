import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Typography, Card, CardContent, Button, Stack } from '@mui/material'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import { displayGeorgianPhone, toE164Georgian } from '@/lib/validation'
import { LoadingState, EmptyState, StatusChip } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import { ThemeProvider } from '@mui/material/styles'
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
  customers: { first_name: string; last_name: string | null } | null
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
      .select('id, scheduled_at, duration_minutes, status, payment_method, organisations(name, slug, booking_theme, contact_phone), services(name, price), customers(first_name, last_name)')
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
          {/* Icon */}
          <Box
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

          {/* Details */}
          <Stack spacing={1.5} sx={{ textAlign: 'left', mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
              <CalendarMonthOutlinedIcon sx={{ color: 'primary.main' }} />
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {appt.organisations?.name}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {appt.services?.name}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
              <AccessTimeOutlinedIcon sx={{ color: 'primary.main' }} />
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {format(scheduledAt, 'EEEE', { locale: ka })}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {format(scheduledAt, 'd MMMM yyyy, HH:mm', { locale: ka })}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>სტატუსი</Typography>
                <Box sx={{ mt: 0.25 }}>
                  <StatusChip status={appt.status as AppointmentStatus} />
                </Box>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {appt.services?.price} ₾
              </Typography>
            </Box>
          </Stack>

          {/* Cancellation is handled by the business directly — guests have no
              self-service cancel, so point them to the org's phone number. */}
          {appt.organisations?.contact_phone && (
            <Box
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                p: 1.5, mb: 3, borderRadius: 2, textAlign: 'left',
                bgcolor: 'primary.light', color: 'primary.contrastText',
                opacity: 0.95,
              }}
            >
              <PhoneOutlinedIcon fontSize="small" />
              <Box>
                <Typography variant="caption" sx={{ display: 'block', opacity: 0.9 }}>
                  ჯავშნის გასაუქმებლად ან შესაცვლელად დაგვირეკეთ
                </Typography>
                <Typography
                  variant="body2"
                  component="a"
                  href={`tel:${toE164Georgian(appt.organisations.contact_phone)}`}
                  sx={{ fontWeight: 700, color: 'inherit', textDecoration: 'none' }}
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
