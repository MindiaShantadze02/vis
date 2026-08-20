import { useState } from 'react'
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Typography, TextField, Link as MuiLink,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@/contexts/OrgContext'
import { useBillingPayment } from '@/hooks/useBillingPayment'
import { currentBillTotal } from '@/lib/billing'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ui'
import { surface } from '@/theme/theme'
import { anim } from '@/theme/animations'

const BILLING_PATH = '/dashboard/settings/billing'

/**
 * Hard block shown to an owner whose business is behind on its bill. The server
 * is the real enforcement (org_can_accept_appointment gates every booking write
 * since 20260816120000) — this explains WHY the booking page went dark and gives
 * the one action that lifts it.
 *
 * Deliberately not dismissable: no `onClose`, so Esc and backdrop clicks are
 * inert (the same idiom ConfirmDialog uses while loading). The owner's ways out
 * are Pay now, Add card, or Log out. The caller hides this on Settings → Billing
 * and Settings → Account so those stay usable.
 */
export default function BillingBlockedDialog({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { org, billing } = useOrg()
  const { payNow, paying } = useBillingPayment()
  const toast = useToast()

  // Article 19: this suspension is a solely-automated decision that stops the
  // business trading, so there has to be a way to put it in front of a person.
  // Accepting the appeal grants a dated hold that unblocks bookings while it is
  // considered — the debt itself is untouched.
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealText, setAppealText] = useState('')
  const [sending, setSending] = useState(false)

  async function sendAppeal() {
    if (!org) return
    setSending(true)
    const { data, error } = await supabase.rpc('request_billing_review', {
      p_org_id: org.id,
      p_message: appealText,
    })
    setSending(false)
    if (error) { toast.error(error.message); return }
    const res = data as { ok: boolean; error?: string }
    if (!res.ok) {
      toast.error(
        res.error === 'already_open' ? t('billing.appealAlreadyOpen')
        : res.error === 'message_too_short' ? t('billing.appealTooShort')
        : (res.error ?? 'error'),
      )
      return
    }
    toast.success(t('billing.appealSent'))
    setAppealOpen(false)
    setAppealText('')
  }

  const outstanding = billing ? currentBillTotal(billing) : null
  const card = billing?.card ?? null

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          'data-testid': 'billing-blocked-dialog',
          sx: { animation: anim.scaleIn },
        } as never,
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>{t('billing.blockedTitle')}</DialogTitle>

      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('billing.blockedBody')}
        </Typography>

        {/* Amount panel — same language as UsageMeter: uppercase caption, hero
            figure, hairline-separated secondary row. */}
        <Box sx={{ mt: 2.5, p: 2.5, borderRadius: 2, bgcolor: surface.subtle, border: '1px solid', borderColor: 'divider' }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            {t('billing.blockedOutstanding')}
          </Typography>

          {outstanding === null ? (
            <CircularProgress size={22} sx={{ display: 'block', mt: 1 }} />
          ) : (
            <Typography
              variant="h3"
              sx={{ fontWeight: 800, color: 'primary.main', lineHeight: 1.05, mt: 0.5 }}
              data-testid="billing-blocked-amount"
            >
              ₾{outstanding}
            </Typography>
          )}

          <Box
            sx={{
              mt: 1.75, pt: 1.5, borderTop: '1px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('billing.card')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {card ? `•••• ${card.last4}` : t('billing.noCard')}
            </Typography>
          </Box>
        </Box>

        {!card && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
            {t('billing.blockedNoCard')}
          </Typography>
        )}

        {/* Art. 19 human review. Deliberately understated — paying is still the
            normal way out, this is the safeguard for when the decision is wrong. */}
        {!appealOpen ? (
          <MuiLink
            component="button"
            type="button"
            variant="caption"
            underline="hover"
            onClick={() => setAppealOpen(true)}
            data-testid="billing-appeal-open"
            sx={{ display: 'block', mt: 2, color: 'text.secondary' }}
          >
            {t('billing.appealCta')}
          </MuiLink>
        ) : (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('billing.appealTitle')}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              {t('billing.appealBody')}
            </Typography>
            <TextField
              fullWidth multiline minRows={3} size="small"
              placeholder={t('billing.appealPlaceholder')}
              value={appealText}
              onChange={e => setAppealText(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 1000, 'data-testid': 'billing-appeal-text' } }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={sendAppeal}
              disabled={sending}
              data-testid="billing-appeal-send"
              sx={{ mt: 1.5 }}
            >
              {sending ? <CircularProgress size={16} color="inherit" /> : t('billing.appealSubmit')}
            </Button>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between' }}>
        <Button color="inherit" onClick={handleLogout} data-testid="billing-blocked-logout">
          {t('common.logout')}
        </Button>

        {card ? (
          <Button
            variant="contained"
            onClick={payNow}
            disabled={paying}
            data-testid="billing-blocked-pay"
          >
            {paying ? <CircularProgress size={20} color="inherit" /> : t('billing.payNow')}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => navigate(BILLING_PATH)}
            data-testid="billing-blocked-add-card"
          >
            {t('billing.blockedAddCard')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
