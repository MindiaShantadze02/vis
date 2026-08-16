import { useEffect, useState } from 'react'
import {
  Box, Card, CardContent, Typography, Button, Stack, TextField, Alert, CircularProgress, Divider, Chip,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { PageHeader, SideDrawer, FormErrorAlert, useToast } from '@/components/ui'
import UsageMeter from '@/components/UsageMeter'
import { useOrg } from '@/contexts/OrgContext'
import { useBillingPayment } from '@/hooks/useBillingPayment'
import { cardExpiryState } from '@/lib/billing'
import { supabase } from '@/lib/supabase'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'

interface Invoice {
  id: string
  period_start: string
  period_end: string
  appointment_count: number
  amount_due: number
  amount_rolled_forward: number
  status: 'pending' | 'charged' | 'failed' | 'waived'
}

const INVOICE_CHIP: Record<Invoice['status'], 'success' | 'warning' | 'error' | 'default'> = {
  charged: 'success', pending: 'warning', failed: 'error', waived: 'default',
}

// Brand from the IIN (display only; a real provider returns the brand).
function detectBrand(digits: string): string {
  if (digits.startsWith('4')) return 'visa'
  if (/^5[1-5]/.test(digits)) return 'mastercard'
  if (/^(34|37)/.test(digits)) return 'amex'
  return 'card'
}

/**
 * Settings → Billing. Running bill + card on file. Adding a card NEVER charges;
 * the business is only charged once a month for the appointments it received
 * (T2.2 disclaimer on the form). The card form tokenises client-side — only the
 * token + last4/brand/expiry are sent to save-card; a PAN never leaves here.
 */
export default function BillingPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const { org, billing, refreshBilling } = useOrg()

  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState('')
  const [expiry, setExpiry] = useState('') // MM/YY
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // "Pay now" clears the outstanding balance (mock settles it) and restores the
  // org to active immediately (settle_usage_charge recovers when nothing's left).
  // Shared with the blocking dialog — see useBillingPayment.
  const { payNow, paying } = useBillingPayment()

  // Past invoices (closed periods) — the line-item breakdown behind the running
  // bill. Owners read their own via RLS.
  const [invoices, setInvoices] = useState<Invoice[]>([])
  useEffect(() => {
    if (!org) return
    supabase
      .from('billing_periods')
      .select('id, period_start, period_end, appointment_count, amount_due, amount_rolled_forward, status')
      .eq('org_id', org.id)
      .neq('status', 'open')
      .order('period_start', { ascending: false })
      .limit(24)
      .then(({ data }) => setInvoices((data ?? []) as Invoice[]))
  }, [org, billing])

  const digits = number.replace(/\D/g, '')
  const expMatch = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim())
  const expiryOk = (() => {
    if (!expMatch) return false
    const mm = Number(expMatch[1]); const yy = 2000 + Number(expMatch[2])
    if (!(mm >= 1 && mm <= 12)) return false
    return Date.UTC(yy, mm, 0, 23, 59, 59) >= Date.now()
  })()
  const numberOk = digits.length >= 13 && digits.length <= 19
  const numberInvalid = submitted && !numberOk
  const expiryInvalid = submitted && !expiryOk

  async function handleSave() {
    setSubmitted(true)
    if (!org) return
    if (!numberOk || !expiryOk) {
      focusFirstInvalidFieldAfterRender(document.querySelector('[data-testid="card-form"]') ?? document)
      return
    }
    const mm = Number(expMatch![1]); const yy = 2000 + Number(expMatch![2])

    setSaving(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('save-card', {
      body: {
        org_id: org.id,
        // Real provider tokenises client-side; the mock stands in for that.
        token: `mock_card_${crypto.randomUUID()}`,
        last4: digits.slice(-4),
        brand: detectBrand(digits),
        exp_month: mm,
        exp_year: yy,
      },
    })
    setSaving(false)
    if (fnErr || !data?.ok) { setError(t('billing.cardSaveFailed')); return }
    toast.success(t('billing.cardSaved'))
    setOpen(false); setNumber(''); setExpiry(''); setSubmitted(false)
    refreshBilling()
  }

  const expiryState = cardExpiryState(billing?.card?.expiresAt ?? null)

  // Superadmin-owned orgs are never invoiced (organisations.billing_exempt,
  // platform-set and not tenant-writable), so the whole money side of this page
  // — running bill, dunning banner, card, invoices — has nothing to show.
  if (org?.billing_exempt) {
    return (
      <Box>
        <PageHeader title={t('settings.billing')} />
        <Alert severity="info" data-testid="billing-exempt" sx={{ maxWidth: 480 }}>
          {t('billing.exempt')}
        </Alert>
      </Box>
    )
  }

  return (
    <Box>
      <PageHeader title={t('settings.billing')} />
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('billing.intro')}
      </Typography>

      {(billing?.status === 'past_due' || billing?.status === 'suspended') && (
        <Alert
          severity={billing.status === 'suspended' ? 'error' : 'warning'}
          sx={{ mb: 2 }}
          data-testid="billing-dunning"
          action={
            <Button color="inherit" size="small" onClick={payNow} disabled={paying} data-testid="billing-pay-now">
              {paying ? <CircularProgress size={18} color="inherit" /> : t('billing.payNow')}
            </Button>
          }
        >
          {billing.status === 'suspended' ? t('billing.suspendedBanner') : t('billing.pastDueBanner')}
        </Alert>
      )}

      <UsageMeter />

      <Card sx={{ maxWidth: 480 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('billing.cardOnFile')}</Typography>
            <Button size="small" variant="outlined" data-testid="billing-add-card" onClick={() => setOpen(true)}>
              {billing?.card ? t('billing.replaceCard') : t('billing.addCard')}
            </Button>
          </Box>
          {billing?.card
            ? (
              <>
                <Typography variant="body2" data-testid="billing-card">
                  {(billing.card.brand ?? t('billing.card'))} ···· {billing.card.last4 ?? '····'}
                </Typography>
                {expiryState === 'expired' && (
                  <Alert severity="error" sx={{ mt: 1 }} data-testid="card-expired">{t('billing.cardExpired')}</Alert>
                )}
                {expiryState === 'expiring_soon' && (
                  <Alert severity="warning" sx={{ mt: 1 }} data-testid="card-expiring">{t('billing.cardExpiringSoon')}</Alert>
                )}
              </>
            )
            : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="billing-no-card">
                {t('billing.noCard')}
              </Typography>
            )}
        </CardContent>
      </Card>

      {invoices.length > 0 && (
        <Card sx={{ maxWidth: 480, mt: 3 }} data-testid="billing-invoices">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('billing.invoices')}</Typography>
            {invoices.map((inv, i) => (
              <Box key={inv.id}>
                {i > 0 && <Divider />}
                <Box sx={{ py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {new Date(inv.period_start).toLocaleDateString('ka-GE', { year: 'numeric', month: 'short' })}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t('billing.invoiceAppts', { count: inv.appointment_count })}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    ₾{inv.status === 'waived' ? inv.amount_rolled_forward : inv.amount_due}
                  </Typography>
                  <Chip size="small" color={INVOICE_CHIP[inv.status]} label={t(`billing.status_${inv.status}`)} />
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        disableClose={saving}
        title={billing?.card ? t('billing.replaceCard') : t('billing.addCard')}
        width={460}
        data-testid="card-form"
        actions={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="card-save">
              {saving ? <CircularProgress size={20} color="inherit" /> : t('billing.saveCard')}
            </Button>
          </>
        }
      >
        <Box>
          <FormErrorAlert message={error} data-testid="card-error" />
          <Alert severity="info" sx={{ mb: 2 }} data-testid="card-disclaimer">
            {t('billing.cardDisclaimer', { price: billing?.appointmentPrice ?? 1 })}
          </Alert>
          <Stack spacing={2}>
            <TextField
              label={t('billing.cardNumber')} value={number}
              onChange={e => setNumber(e.target.value)}
              fullWidth size="small" placeholder="4242 4242 4242 4242"
              error={numberInvalid}
              helperText={numberInvalid ? t('billing.cardNumberInvalid') : undefined}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 23, 'data-testid': 'card-number' } }}
            />
            <TextField
              label={t('billing.cardExpiry')} value={expiry}
              onChange={e => setExpiry(e.target.value)}
              size="small" sx={{ maxWidth: 160 }} placeholder="09/29"
              error={expiryInvalid}
              helperText={expiryInvalid ? t('billing.cardExpiryInvalid') : 'MM/YY'}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 5, 'data-testid': 'card-expiry' } }}
            />
          </Stack>
        </Box>
      </SideDrawer>
    </Box>
  )
}
