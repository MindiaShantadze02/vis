import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Typography, Card, CardContent, Button, Chip, Alert, CircularProgress } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import {
  HotelOutlined as HotelOutlinedIcon,
  CalendarMonthOutlined as CalendarMonthOutlinedIcon,
  SearchOffOutlined as SearchOffOutlinedIcon,
} from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { LoadingState, EmptyState, BookingTicket } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import { getBookingTheme, makeBookingTheme } from '@/theme/bookingThemes'

interface PublicStay {
  id: string
  org_name: string
  org_slug: string
  booking_theme: string | null
  contact_phone: string | null
  room_name: string | null
  check_in: string
  check_out: string
  guests: number
  total_amount: number
  status: string
  cancellation_hours: number | null
  cancellable: boolean
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  pending: 'warning', approved: 'success', checked_in: 'info', checked_out: 'default',
  cancelled: 'error', rejected: 'error', no_show: 'error',
}

export default function StayManagePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [stay, setStay] = useState<PublicStay | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelledJustNow, setCancelledJustNow] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    supabase.rpc('get_public_stay', { p_id: id }).maybeSingle().then(({ data }) => {
      if (cancelled) return
      setStay((data as PublicStay) ?? null)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [id, reloadKey])

  async function cancel() {
    if (!id || !window.confirm(t('stay.cancelConfirm'))) return
    setBusy(true); setError(null)
    const { data, error: err } = await supabase.rpc('cancel_public_stay', { p_id: id })
    setBusy(false)
    if (err) { setError(t('stay.cancelFailed')); return }
    if (data === 'ok') { setCancelledJustNow(true); setReloadKey(k => k + 1); return }
    setError(t(data === 'too_late' ? 'stay.tooLate' : 'stay.notCancellableMsg'))
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><LoadingState /></Box>
  }
  if (!stay) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <EmptyState icon={<SearchOffOutlinedIcon />} title={t('stay.notFound')} />
    </Box>
  }

  const bookingTheme = getBookingTheme(stay.booking_theme)
  const checkIn = new Date(`${stay.check_in}T00:00:00`)
  const checkOut = new Date(`${stay.check_out}T00:00:00`)

  return (
    <ThemeProvider theme={makeBookingTheme(bookingTheme)}>
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: bookingTheme.pageBg, p: 2 }}>
        <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4 }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center' }}>{t('stay.manageHeading')}</Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
              <Chip
                size="small"
                color={STATUS_COLOR[stay.status] ?? 'default'}
                label={t(`stay.status.${stay.status}`, stay.status)}
              />
            </Box>

            {cancelledJustNow && <Alert severity="success" sx={{ mb: 2 }}>{t('stay.cancelled')}</Alert>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <BookingTicket
              notchColor={bookingTheme.pageBg}
              priceColor={bookingTheme.deep}
              priceLabel={t('hotel.total')}
              price={`${stay.total_amount} ₾`}
              rows={[
                { icon: <HotelOutlinedIcon sx={{ fontSize: 18 }} />, label: stay.org_name, value: stay.room_name ?? '' },
                { icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />, label: t('hotel.checkIn'), value: format(checkIn, 'd MMM yyyy', { locale: ka }) },
                { icon: <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />, label: t('hotel.checkOut'), value: format(checkOut, 'd MMM yyyy', { locale: ka }) },
              ]}
            />

            <Box sx={{ mt: 3 }}>
              {stay.cancellable ? (
                <Button fullWidth color="error" variant="outlined" onClick={cancel} disabled={busy} data-testid="stay-cancel">
                  {busy ? <CircularProgress size={20} color="inherit" /> : t('stay.cancelButton')}
                </Button>
              ) : stay.status === 'cancelled' ? null : stay.cancellation_hours == null ? (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
                  {t('stay.contactToCancel')}
                </Typography>
              ) : (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
                  {t('stay.windowPassed')}
                </Typography>
              )}

              <Button fullWidth variant="contained" sx={{ mt: 1.5 }} onClick={() => navigate(`/book/${stay.org_slug}`)}>
                {t('stay.backToBooking')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </ThemeProvider>
  )
}
