import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Box, Card, CardContent, Typography, Button, Stack } from '@mui/material'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@/contexts/OrgContext'
import { LAYOUT } from '@/theme/theme'

// Landing page after returning from the payment gateway (mock or real). The
// row itself is already settled by payment-webhook; this screen just reports
// the result and routes the user onward.
export default function PaymentReturnPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { refresh } = useOrg()
  const [params] = useSearchParams()

  const purpose = params.get('purpose') ?? ''
  const id = params.get('id') ?? ''
  const outcome = params.get('outcome') ?? ''
  const slug = params.get('slug') ?? ''
  const paid = outcome === 'paid'
  const isSubscription = purpose === 'subscription'
  const isStay = purpose === 'stay'

  // A successful subscription payment changed the org's tier — refresh context
  // so the dashboard reflects it immediately.
  useEffect(() => {
    if (isSubscription && paid) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubscription, paid])

  const title = paid ? t('payment.successTitle') : t('payment.failTitle')
  const message = paid
    ? (isSubscription ? t('payment.successSubscription')
       : isStay ? t('payment.successStay')
       : t('payment.successAppointment'))
    : t('payment.failMessage')

  function onPrimary() {
    if (isSubscription) {
      navigate('/dashboard/settings/subscription', { replace: true })
    } else if (paid && id && !isStay) {
      // Successful appointment — show its confirmation page (stays don't have one).
      navigate(`/booking-confirmation/${id}`, { replace: true })
    } else if (slug) {
      // Failed/abandoned online payment created no booking — back to booking.
      navigate(`/book/${slug}`, { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100', p: 2 }}>
      <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4 }}>
        <CardContent sx={{ p: 4, textAlign: 'center' }}>
          <Box
            sx={{
              width: 72, height: 72, borderRadius: '50%',
              bgcolor: paid ? 'success.light' : 'error.light',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              mx: 'auto', mb: 2,
            }}
          >
            {paid
              ? <CheckCircleOutlinedIcon sx={{ fontSize: 38, color: 'success.main' }} />
              : <ErrorOutlineOutlinedIcon sx={{ fontSize: 38, color: 'error.main' }} />}
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{message}</Typography>

          <Stack spacing={1}>
            <Button fullWidth variant="contained" onClick={onPrimary} data-testid="payment-return-primary">
              {isSubscription
                ? t('payment.backToSubscription')
                : paid && !isStay ? t('payment.viewBooking') : t('payment.backToBooking')}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
