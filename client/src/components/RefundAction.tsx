import { useEffect, useState } from 'react'
import {
  Box, Typography, Button, TextField, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert,
} from '@mui/material'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'
import { refundGate } from '@/lib/refund'
import type { Appointment } from '@/types/appointment'

// Returning a customer's money, from the appointment drawer.
//
// This lives in the drawer BODY rather than its action footer on purpose: the
// footer is gated on an approved appointment, and a refund has to be reachable
// from a completed visit, a no-show, or a booking cancelled last week without
// one. It also lets the read-only calendar drawer host it without growing an
// action bar of its own.
//
// The cancel dialog's "refund the customer" checkbox stays where it is — that
// is the atomic "cancel AND refund" intent, whose all-or-nothing guarantee is
// why the edge function exists. This is the money-only door.

const MAX_REASON = 200

interface Quote {
  amount: number
  currency: string
  /** True when confirming will also cancel the booking (it is still live). */
  willCancel: boolean
  isDeposit: boolean
}

interface RefundRecord {
  amount: number
  currency: string
  created_at: string
  initiated_by_name: string | null
  reason: string | null
}

interface Props {
  appt: Appointment
  /** Hidden while another destructive flow owns the drawer (the cancel confirm). */
  suppressed?: boolean
  /** `cancelled` reports whether the server also cancelled the booking (it does
   *  that only for a still-live one), so the open drawer can patch its status
   *  instead of showing a stale "approved" until it is reopened. */
  onRefunded: (result: { cancelled: boolean }) => void
}

export default function RefundAction({ appt, suppressed = false, onRefunded }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const gate = refundGate(appt)

  const [open, setOpen] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [record, setRecord] = useState<RefundRecord | null>(null)

  // Drop a stale receipt when the drawer switches appointments. Render-phase
  // reset rather than an effect, so it never paints another booking's refund.
  const recordKey = `${appt.id}:${gate}`
  const [loadedKey, setLoadedKey] = useState(recordKey)
  if (loadedKey !== recordKey) {
    setLoadedKey(recordKey)
    setRecord(null)
  }

  // The receipt for an already-refunded payment. Read straight from the ledger
  // (org members can SELECT their own rows); payment_log stays superadmin-only.
  useEffect(() => {
    if (gate !== 'refunded') return
    let cancelled = false
    supabase
      .from('appointment_refunds')
      .select('amount, currency, created_at, initiated_by_name, reason')
      .eq('appointment_id', appt.id)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setRecord((data?.[0] as RefundRecord | undefined) ?? null)
      })
    return () => { cancelled = true }
  }, [appt.id, gate])

  if (suppressed || gate === 'none') return null

  // Already refunded: show what was returned. Refunds taken before this ledger
  // existed have no row — fall back to the plain payment line rather than an
  // empty box.
  if (gate === 'refunded') {
    if (!record) return null
    return (
      <Box
        data-testid="appt-refund-summary"
        sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t('dashboard.refundedOn', {
            amount: Number(record.amount),
            currency: record.currency === 'GEL' ? '₾' : record.currency,
            date: format(new Date(record.created_at), 'd MMM yyyy', { locale: dateLocale() }),
          })}
        </Typography>
        {record.initiated_by_name && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {t('dashboard.refundedBy', { name: record.initiated_by_name })}
          </Typography>
        )}
        {record.reason && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {record.reason}
          </Typography>
        )}
      </Box>
    )
  }

  /** Ask the server what would actually be returned, then open the dialog. */
  async function startRefund() {
    setOpen(true)
    setQuote(null)
    setQuoteError(null)
    setReason('')
    const { data, error } = await supabase.functions.invoke('refund-payment', {
      body: { appointment_id: appt.id, mode: 'quote' },
    })
    if (error || !data?.ok) { setQuoteError(t('dashboard.refundQuoteFailed')); return }
    if (!data.refundable) { setQuoteError(messageFor(data.code)); return }
    setQuote({
      amount: Number(data.amount),
      currency: data.currency,
      willCancel: !!data.will_cancel,
      isDeposit: !!data.is_deposit,
    })
  }

  function messageFor(code: string | undefined): string {
    switch (code) {
      case 'already_refunded': return t('dashboard.refundAlreadyRefunded')
      case 'not_refundable':
      case 'charge_not_found': return t('dashboard.refundNotRefundable')
      case 'refund_unavailable': return t('dashboard.refundUnavailable')
      default: return t('dashboard.refundFailed')
    }
  }

  async function confirmRefund() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('refund-payment', {
      body: { appointment_id: appt.id, reason: reason.trim() || null },
    })
    setBusy(false)
    if (error || !data?.ok) {
      // supabase-js wraps a non-2xx in a FunctionsHttpError; the body carries
      // the specific code, which is worth showing — "refunds aren't wired up for
      // this provider" and "already refunded" need different reactions.
      const code = await readErrorCode(error)
      toast.error(messageFor(code))
      return
    }
    toast.success(data.cancelled ? t('dashboard.refundDone') : t('dashboard.refundOnlyDone'))
    setOpen(false)
    onRefunded({ cancelled: !!data.cancelled })
  }

  return (
    <>
      <Box>
        <Button
          variant="outlined"
          color="warning"
          size="small"
          onClick={startRefund}
          data-testid="appt-refund"
        >
          {t('dashboard.refundAction')}
        </Button>
      </Box>

      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('dashboard.refundTitle')}</DialogTitle>
        <DialogContent>
          {quoteError && <Alert severity="error" sx={{ mb: 2 }}>{quoteError}</Alert>}

          {!quote && !quoteError && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={22} />
            </Box>
          )}

          {quote && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                {t('dashboard.refundConfirmBody', {
                  amount: quote.amount,
                  currency: quote.currency === 'GEL' ? '₾' : quote.currency,
                })}
              </Typography>
              {quote.isDeposit && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  {t('dashboard.refundDepositNote')}
                </Typography>
              )}
              {/* Only a still-live booking loses its slot; say which it is. */}
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
                {quote.willCancel ? t('dashboard.refundAlsoCancels') : t('dashboard.refundKeepsBooking')}
              </Typography>

              <TextField
                fullWidth
                size="small"
                label={t('dashboard.refundReasonLabel')}
                value={reason}
                onChange={e => setReason(e.target.value)}
                helperText={t('dashboard.refundReasonHelp')}
                slotProps={{ htmlInput: { maxLength: MAX_REASON, 'data-testid': 'appt-refund-reason' } }}
              />

              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
                {t('dashboard.refundSmsNote')}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} disabled={busy} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={confirmRefund}
            disabled={busy || !quote}
            variant="contained"
            color="error"
            data-testid="appt-refund-confirm"
          >
            {busy ? <CircularProgress size={20} color="inherit" /> : t('dashboard.refundAction')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/** Pull the server's error code out of a supabase-js FunctionsHttpError. */
async function readErrorCode(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: Response } | null)?.context
  if (!context || typeof context.json !== 'function') return undefined
  try {
    const body = await context.json()
    return typeof body?.error === 'string' ? body.error : undefined
  } catch {
    return undefined
  }
}
