import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@/contexts/OrgContext'
import { useBillingPayment } from '@/hooks/useBillingPayment'
import { currentBillTotal } from '@/lib/billing'
import { supabase } from '@/lib/supabase'
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
  const { billing } = useOrg()
  const { payNow, paying } = useBillingPayment()

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
