import { useEffect, useState } from 'react'
import { Box, Card, CardContent, LinearProgress, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'

/**
 * Always-visible dashboard usage meter (record §4.2): "43 / 150 bookings this
 * month" against the same server-derived usage the booking limit is enforced
 * with. Doubles as a passive upgrade surface as it fills (80% turns the bar
 * amber, 100% red — same thresholds as the subscription page).
 */
export default function UsageMeter() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [used, setUsed] = useState<number | null>(null)
  const [limit, setLimit] = useState<number | null>(null)

  useEffect(() => {
    if (!org) return
    supabase
      .rpc('org_usage_info', { p_org_id: org.id })
      .maybeSingle()
      .then(({ data }) => {
        const usage = data as { used?: number; appt_limit?: number | null } | null
        setUsed(usage?.used ?? null)
        setLimit(usage?.appt_limit ?? null)
      })
  }, [org])

  if (used === null || !limit) return null

  const pct = Math.min((used / limit) * 100, 100)

  return (
    <Card sx={{ mb: 4, maxWidth: 480 }} data-testid="usage-meter">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('subscription.bookingsThisMonth')}
          </Typography>
          <Typography variant="body2" sx={{ color: pct >= 80 ? 'error.main' : 'text.secondary', fontWeight: 600 }}>
            {used} / {limit}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={pct}
          aria-label={`${used} / ${limit}`}
          sx={{
            '& .MuiLinearProgress-bar': {
              bgcolor: pct >= 100 ? 'error.main' : pct >= 80 ? 'warning.main' : 'primary.main',
            },
          }}
        />
        {pct >= 80 && pct < 100 && (
          <Typography variant="caption" sx={{ color: 'warning.main', mt: 0.5, display: 'block' }}>
            {t('subscription.nearLimit')}
          </Typography>
        )}
        {pct >= 100 && (
          <Typography variant="caption" sx={{ color: 'error.main', mt: 0.5, display: 'block' }}>
            {t('subscription.limitReached')} — {t('subscription.bookingsBlocked')}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
