import { Box, Card, CardContent, LinearProgress, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useEntitlements } from '@/hooks/useEntitlement'

/**
 * Always-visible dashboard usage meter: "76 / 1120 bookings this period" against
 * the total appointments available. Reads the org's entitlements from context
 * (get_org_entitlements) — no extra round-trip.
 *
 * Hard-cap model (2026-07-22): the monthly included allowance is free; past it,
 * each booking spends one purchased EXTRA APPOINTMENT (credit_balance), and with
 * none left new bookings are blocked. Purchased extras are folded into the total
 * count (capacity = max(used, included) + credit_balance) so the denominator is
 * the real number of appointments the org can still make this period.
 */
export default function UsageMeter() {
  const { t } = useTranslation()
  const ent = useEntitlements()

  // Unlimited tiers (null allowance) have nothing to meter.
  if (!ent || ent.included == null) return null

  const { used, included, creditBalance, state } = ent
  // Total pool = what's been used-or-included plus any bought extras. Stays
  // stable as extras are consumed (a used extra moves from balance into `used`).
  const capacity = Math.max(used, included) + creditBalance
  const pct = capacity > 0 ? Math.min((used / capacity) * 100, 100) : 0
  // Only ACTIVE orgs are hard-capped. Trials have a soft allowance (never blocked,
  // never spend credits), and an expired org needs to renew — not buy extras — and
  // is handled by its own banner. So "out of appointments" applies to active only.
  const blocked = state === 'active' && creditBalance === 0 && used >= included
  const nearLimit = pct >= 80

  return (
    <Card sx={{ mb: 4, maxWidth: 480 }} data-testid="usage-meter">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('subscription.bookingsThisMonth')}
          </Typography>
          <Typography variant="body2" sx={{ color: blocked ? 'error.main' : nearLimit ? 'warning.main' : 'text.secondary', fontWeight: 600 }}>
            {used} / {capacity}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          aria-label={`${used} / ${capacity}`}
          sx={{
            '& .MuiLinearProgress-bar': {
              bgcolor: blocked ? 'error.main' : nearLimit ? 'warning.main' : 'primary.main',
            },
          }}
        />
        {blocked ? (
          <Typography variant="caption" data-testid="usage-blocked" sx={{ color: 'error.main', mt: 0.5, display: 'block', fontWeight: 600 }}>
            {t('subscription.outOfAppointments')}
          </Typography>
        ) : nearLimit ? (
          <Typography variant="caption" sx={{ color: 'warning.main', mt: 0.5, display: 'block' }}>
            {t('subscription.nearLimit')}
          </Typography>
        ) : creditBalance > 0 ? (
          // Clarify how the total is made up so the big denominator makes sense.
          <Typography variant="caption" data-testid="usage-extra" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
            {t('subscription.extraIncluded', { count: creditBalance })}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}
