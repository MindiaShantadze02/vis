import { Box, Card, CardContent, LinearProgress, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useEntitlements } from '@/hooks/useEntitlement'
import { usagePercent, overAllowance } from '@/lib/entitlements'

/**
 * Always-visible dashboard usage meter: "43 / 100 bookings this period" against
 * the same server-derived allowance the booking flow meters. Reads the org's
 * entitlements from context (get_org_entitlements) — no extra round-trip.
 *
 * Bookings beyond the included allowance are no longer blocked (2026-07-17):
 * once over, the bar fills and an "N over your plan · ₾Z" line shows the metered
 * overage (display only until billing is wired). 80% turns the bar amber.
 */
export default function UsageMeter() {
  const { t } = useTranslation()
  const ent = useEntitlements()

  // Unlimited tiers (null allowance) have nothing to meter.
  if (!ent || ent.included == null) return null

  const { used, included, overageCount, overageCost } = ent
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
          <Typography variant="caption" data-testid="usage-overage" sx={{ color: 'warning.main', mt: 0.5, display: 'block', fontWeight: 600 }}>
            {t('subscription.overageSummary', { count: overageCount, cost: overageCost })}
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
