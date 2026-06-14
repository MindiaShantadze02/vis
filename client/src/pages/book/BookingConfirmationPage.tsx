import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Typography, Card, CardContent, Button, CircularProgress, Chip, Stack } from '@mui/material'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'

interface AppointmentDetail {
  id: string
  scheduled_at: string
  duration_minutes: number
  status: string
  payment_method: string
  organisations: { name: string; slug: string } | null
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
      .select('id, scheduled_at, duration_minutes, status, payment_method, organisations(name, slug), services(name, price), customers(first_name, last_name)')
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
        <CircularProgress />
      </Box>
    )
  }

  if (!appt) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Typography>ჯავშანი ვერ მოიძებნა</Typography>
      </Box>
    )
  }

  const scheduledAt = new Date(appt.scheduled_at)
  const isPending = appt.status === 'pending'

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 440, width: '100%', borderRadius: 4 }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          {/* Icon */}
          <Box
            sx={{
              width: 72, height: 72, borderRadius: '50%',
              bgcolor: isPending ? '#FEF3C7' : '#D1FAE5',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mx: 'auto', mb: 2,
            }}
          >
            <CheckCircleOutlinedIcon
              sx={{ fontSize: 38, color: isPending ? '#F59E0B' : '#10B981' }}
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
                  <Chip
                    label={isPending ? 'მოლოდინში' : 'დადასტურებული'}
                    size="small"
                    sx={{
                      bgcolor: isPending ? '#FEF3C7' : '#D1FAE5',
                      color: isPending ? '#F59E0B' : '#10B981',
                      fontWeight: 600,
                    }}
                  />
                </Box>
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {appt.services?.price} ₾
              </Typography>
            </Box>
          </Stack>

          <Button
            fullWidth
            variant="contained"
            onClick={() => navigate(`/book/${appt.organisations?.slug}`)}
          >
            კიდევ ერთი ჯავშანი
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}
