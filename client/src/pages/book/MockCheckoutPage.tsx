import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Box, Card, CardContent, Typography, Button, Stack, Chip, CircularProgress, Alert,
} from '@mui/material'
import { CreditCardOutlined as CreditCardOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { LAYOUT } from '@/theme/theme'

// Mock/sandbox checkout. Stands in for a real bank gateway's hosted page: it
// shows the amount and lets the developer simulate a success or failure, then
// calls payment-webhook (mock branch) and forwards to /payment-return. Swapped
// out entirely once BOG/TBC are wired in — see _shared/payments/mock.ts.
export default function MockCheckoutPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ref = params.get('ref') ?? ''
  const purpose = params.get('purpose') ?? ''
  const id = params.get('id') ?? ''
  const amount = params.get('amount') ?? ''
  const currency = params.get('currency') ?? 'GEL'
  const label = params.get('label') ?? ''
  const slug = params.get('slug') ?? ''

  const valid = ref && (purpose === 'appointment' || purpose === 'subscription' || purpose === 'stay' || purpose === 'credit') && id

  async function settle(outcome: 'paid' | 'failed') {
    setLoading(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('payment-webhook', {
      body: { provider: 'mock', purpose, id, ref, outcome },
    })
    setLoading(false)
    if (fnErr || !data?.ok) {
      setError(t('payment.settleFailed'))
      return
    }
    // On a paid appointment the webhook returns the freshly-created appointment
    // id; forward it (plus the slug, for routing a failure back to booking).
    const returnId = purpose === 'appointment' && outcome === 'paid' ? (data.appointment_id ?? '') : id
    const q = new URLSearchParams({ purpose, id: returnId, outcome })
    if (slug) q.set('slug', slug)
    navigate(`/payment-return?${q.toString()}`, { replace: true })
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.100', p: 2 }}>
      <Card sx={{ maxWidth: LAYOUT.narrowCard, width: '100%', borderRadius: 4 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <Chip label={t('payment.sandbox')} color="warning" size="small" />
          </Box>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <CreditCardOutlinedIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('payment.mockTitle')}</Typography>
            {label && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{label}</Typography>
            )}
            {amount && (
              <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', mt: 1.5 }}>
                {amount} {currency === 'GEL' ? '₾' : currency}
              </Typography>
            )}
          </Box>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {!valid && <Alert severity="error" sx={{ mb: 2 }}>{t('payment.invalidSession')}</Alert>}

          <Stack spacing={1.5}>
            <Button
              fullWidth variant="contained" size="large" color="success"
              disabled={loading || !valid}
              onClick={() => settle('paid')}
              data-testid="mock-pay-success"
            >
              {loading ? <CircularProgress size={22} color="inherit" /> : t('payment.simulateSuccess')}
            </Button>
            <Button
              fullWidth variant="outlined" size="large" color="error"
              disabled={loading || !valid}
              onClick={() => settle('failed')}
              data-testid="mock-pay-fail"
            >
              {t('payment.simulateFail')}
            </Button>
          </Stack>

          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 3, textAlign: 'center' }}>
            {t('payment.sandboxNote')}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
