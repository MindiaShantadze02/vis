import { useEffect, useState } from 'react'
import {
  Box, Card, CardContent, Typography, Button, Stack, TextField, Alert, CircularProgress, Divider, Chip,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { PageHeader, SideDrawer, FormErrorAlert, ConfirmDialog, useToast } from '@/components/ui'
import UsageMeter from '@/components/UsageMeter'
import { useOrg } from '@/contexts/OrgContext'
import { useBillingPayment } from '@/hooks/useBillingPayment'
import { cardExpiryState } from '@/lib/billing'
import {
  formatCardNumber, formatCardExpiry, parseCardExpiry, isExpiryInFuture,
  isPlausibleCardNumber, detectCardBrand,
} from '@/lib/card'
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

/**
 * Settings → Billing. Running bill + card on file. Adding a card NEVER charges;
 * the business is only charged once a month for the appointments it received
 * (T2.2 disclaimer on the form). The card form tokenises client-side — only the
 * token + last4/brand/expiry are sent to save-card; a PAN never leaves here.
 *
 * The number/expiry fields reformat as the owner types (see lib/card.ts) rather
 * than demanding one exact shape, and the card can be removed again via
 * remove_org_card.
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
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

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
  const numberOk = isPlausibleCardNumber(number)
  // Parsing and expiry-checking are separate so the field can say WHICH it is:
  // "we can't read that" and "that card has expired" are different problems.
  const parsedExpiry = parseCardExpiry(expiry)
  const expiryOk = !!parsedExpiry && isExpiryInFuture(parsedExpiry)
  const numberInvalid = submitted && !numberOk
  const expiryInvalid = submitted && !expiryOk
  const expiryHelper = !expiryInvalid
    ? 'MM/YY'
    : parsedExpiry ? t('billing.cardExpiredInput') : t('billing.cardExpiryInvalid')

  async function handleSave() {
    setSubmitted(true)
    if (!org) return
    if (!numberOk || !parsedExpiry || !expiryOk) {
      focusFirstInvalidFieldAfterRender(document.querySelector('[data-testid="card-form"]') ?? document)
      return
    }

    setSaving(true)
    setError(null)
    const { data, error: fnErr } = await supabase.functions.invoke('save-card', {
      body: {
        org_id: org.id,
        // Real provider tokenises client-side; the mock stands in for that.
        token: `mock_card_${crypto.randomUUID()}`,
        last4: digits.slice(-4),
        brand: detectCardBrand(number),
        exp_month: parsedExpiry.month,
        exp_year: parsedExpiry.year,
      },
    })
    setSaving(false)
    if (fnErr || !data?.ok) { setError(t('billing.cardSaveFailed')); return }
    toast.success(t('billing.cardSaved'))
    setOpen(false); setNumber(''); setExpiry(''); setSubmitted(false)
    refreshBilling()
  }

  // Removing the card is allowed even while a bill is outstanding — it doesn't
  // dodge collection (a due charge with no card still routes into dunning), and
  // trapping someone's card details would be the worse failure. The confirm
  // copy says so plainly.
  async function handleRemove() {
    if (!org) return
    setRemoving(true)
    const { error: rpcErr } = await supabase.rpc('remove_org_card', { p_org_id: org.id })
    setRemoving(false)
    setConfirmRemove(false)
    if (rpcErr) { toast.error(t('billing.cardRemoveFailed')); return }
    toast.success(t('billing.cardRemoved'))
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
        <Alert severity="info" data-testid="billing-exempt">
          {t('billing.exempt')}
        </Alert>
      </Box>
    )
  }

  return (
    <Box>
      {/* The page intro belongs in PageHeader's subtitle slot, like any other
          page-level description — it used to be a loose <Typography> under the
          header, which no other page does. */}
      <PageHeader title={t('settings.billing')} subtitle={t('billing.intro')} />

      {(billing?.status === 'past_due' || billing?.status === 'suspended') && (
        <Alert
          severity={billing.status === 'suspended' ? 'error' : 'warning'}
          sx={{ mb: 3 }}
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

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('billing.cardOnFile')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('billing.cardOnFileHint')}
          </Typography>

          {billing?.card
            ? (
              <>
                <Typography variant="body2" data-testid="billing-card">
                  {(billing.card.brand ?? t('billing.card'))} ···· {billing.card.last4 ?? '····'}
                </Typography>
                {expiryState === 'expired' && (
                  <Alert severity="error" sx={{ mt: 2 }} data-testid="card-expired">{t('billing.cardExpired')}</Alert>
                )}
                {expiryState === 'expiring_soon' && (
                  <Alert severity="warning" sx={{ mt: 2 }} data-testid="card-expiring">{t('billing.cardExpiringSoon')}</Alert>
                )}
              </>
            )
            : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="billing-no-card">
                {t('billing.noCard')}
              </Typography>
            )}

          {/* Actions bottom-right, primary on the right — the same shape every
              other settings card uses (cf. BookingPageSettings' Save). Replacing
              the card is the primary act; removing it is the quiet destructive
              one beside it. */}
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            {billing?.card && (
              <Button color="error" data-testid="billing-remove-card" onClick={() => setConfirmRemove(true)}>
                {t('billing.removeCard')}
              </Button>
            )}
            <Button variant="contained" data-testid="billing-add-card" onClick={() => setOpen(true)}>
              {billing?.card ? t('billing.replaceCard') : t('billing.addCard')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {invoices.length > 0 && (
        <Card data-testid="billing-invoices">
          <CardContent sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              {t('billing.invoices')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              {t('billing.invoicesHint')}
            </Typography>
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
            {t('billing.cardDisclaimer', {
              base: billing?.baseFee ?? 15,
              price: billing?.smsPrice ?? 0.7,
            })}
          </Alert>
          <Stack spacing={2}>
            {/* Both fields reformat on every keystroke, so the owner can type
                or paste in whatever shape they like — digits only, with dashes,
                a 4-digit year — and still end up with a value that saves. No
                maxLength: the formatters cap the digits themselves, and a hard
                cap on the FORMATTED string would silently truncate a paste. */}
            <TextField
              label={t('billing.cardNumber')} value={number}
              onChange={e => setNumber(formatCardNumber(e.target.value))}
              fullWidth size="small" placeholder="4242 4242 4242 4242"
              error={numberInvalid}
              helperText={numberInvalid ? t('billing.cardNumberInvalid') : undefined}
              slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'cc-number', 'data-testid': 'card-number' } }}
            />
            <TextField
              label={t('billing.cardExpiry')} value={expiry}
              onChange={e => setExpiry(formatCardExpiry(e.target.value))}
              size="small" sx={{ maxWidth: 160 }} placeholder="09/29"
              error={expiryInvalid}
              helperText={expiryHelper}
              slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'cc-exp', 'data-testid': 'card-expiry' } }}
            />
          </Stack>
        </Box>
      </SideDrawer>

      <ConfirmDialog
        open={confirmRemove}
        title={t('billing.removeCardTitle')}
        message={t('billing.removeCardMessage')}
        confirmLabel={t('billing.removeCard')}
        destructive
        loading={removing}
        onClose={() => setConfirmRemove(false)}
        onConfirm={handleRemove}
      />
    </Box>
  )
}
