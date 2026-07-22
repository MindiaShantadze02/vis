import { Box, Card, CardContent, LinearProgress, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useEntitlements } from '@/hooks/useEntitlement'
import { usagePercent, overAllowance } from '@/lib/entitlements'

/**
 * Always-visible dashboard usage meter: "43 / 100 bookings this period" against
 * the same server-derived allowance the booking flow meters. Reads the org's
 * entitlements from context (get_org_entitlements) — no extra round-trip.
 *
 * Hard-cap model (2026-07-22): the included allowance is free; past it, each
 * booking spends one purchased EXTRA APPOINTMENT (credit_balance), and with none
 * left new bookings are blocked. The meter surfaces the extra-appointment balance
 * always, and the over-plan / out-of-appointments state when relevant. 80% amber.
 */
export default function UsageMeter() {
  const { t } = useTranslation()
  const ent = useEntitlements()

  // Unlimited tiers (null allowance) have nothing to meter.
  if (!ent || ent.included == null) return null

  const { used, included, creditBalance } = ent
  const pct = usagePercent(used, included)
  const over = overAllowance(used, included)

  return (
    <Card sx={{ mb: 4, maxWidth: 480 }} data-testid="usage-meter">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('subscription.bookingsThisMonth')}
          </Typography>
          <Typography variant="body2" sx={{ color: over > 0 ? 'warning.main' : pct >= 80 ? 'warning.main' : 'text.secondary', fontWeight: 600 }}>
            {used} / {included}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          aria-label={`${used} / ${included}`}
          sx={{
            '& .MuiLinearProgress-bar': {
              bgcolor: pct >= 100 ? 'warning.main' : pct >= 80 ? 'warning.main' : 'primary.main',
            },
          }}
        />
        {over > 0 ? (
          // Over the plan → spending extra appointments. Show how many remain,
          // or an out-of-appointments prompt when the balance is exhausted.
          creditBalance > 0 ? (
            <Typography variant="caption" data-testid="usage-extra" sx={{ color: 'warning.main', mt: 0.5, display: 'block', fontWeight: 600 }}>
              {t('subscription.extraLeft', { count: creditBalance })}
            </Typography>
          ) : (
            <Typography variant="caption" data-testid="usage-blocked" sx={{ color: 'error.main', mt: 0.5, display: 'block', fontWeight: 600 }}>
              {t('subscription.outOfAppointments')}
            </Typography>
          )
        ) : creditBalance > 0 ? (
          // Under the plan but holding a top-up balance → keep it visible.
          <Typography variant="caption" data-testid="usage-extra" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
            {t('subscription.extraAvailable', { count: creditBalance })}
          </Typography>
        ) : pct >= 80 && (
          <Typography variant="caption" sx={{ color: 'warning.main', mt: 0.5, display: 'block' }}>
            {t('subscription.nearLimit')}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
