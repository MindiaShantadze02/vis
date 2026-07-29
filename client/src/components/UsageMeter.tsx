import { Box, Card, CardContent, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@/contexts/OrgContext'

/**
 * Always-visible dashboard running bill: "this month so far: 34 appointments ·
 * ₾34". Post-paid usage billing — signup is free and the business is charged
 * once a month for the appointments it used. Reads the org's billing snapshot
 * from context (get_org_billing_status) — no extra round-trip. Shows the
 * rolled-forward balance when non-zero and flags past_due / suspended.
 *
 * (The full line-item breakdown link + live-update assertions are T2.1.)
 */
export default function UsageMeter() {
  const { t } = useTranslation()
  const { billing } = useOrg()

  if (!billing) return null

  const { appointmentCount, runningAmount, rolledForward, status } = billing

  return (
    <Card sx={{ mb: 4, maxWidth: 480 }} data-testid="usage-meter">
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.25 }}>
          {t('billing.thisMonthSoFar')}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700 }} data-testid="usage-running">
          {t('billing.apptsAndAmount', { count: appointmentCount, amount: runningAmount })}
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          {rolledForward > 0 && (
            <Typography variant="caption" data-testid="usage-rolled" sx={{ color: 'text.secondary', display: 'block' }}>
              {t('billing.rolledForward', { amount: rolledForward })}
            </Typography>
          )}
          {status === 'past_due' && (
            <Typography variant="caption" sx={{ color: 'warning.main', display: 'block', fontWeight: 600 }}>
              {t('billing.pastDue')}
            </Typography>
          )}
          {status === 'suspended' && (
            <Typography variant="caption" data-testid="usage-suspended" sx={{ color: 'error.main', display: 'block', fontWeight: 600 }}>
              {t('billing.suspended')}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}
