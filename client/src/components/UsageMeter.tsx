import { Box, Card, CardContent, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@/contexts/OrgContext'

/**
 * Always-visible dashboard running bill. Signup is free; the business pays a
 * flat monthly subscription plus, with the SMS add-on on, a fee per public
 * booking. Reads the org's billing snapshot from context
 * (get_org_billing_status) — no extra round-trip.
 *
 * The business's gross revenue (`earned`) is the hero figure; what it owes Vis
 * (`runningAmount`) sits below as a quiet secondary line, itemised so the owner
 * can see which half is the subscription and which half is SMS. A first period
 * reads as subscription-free; rolled-forward / past_due / suspended are flagged
 * last.
 */
export default function UsageMeter() {
  const { t } = useTranslation()
  const { org, billing } = useOrg()

  // Superadmin-owned orgs are never invoiced — there is no running bill.
  if (org?.billing_exempt) return null
  if (!billing) return null

  const {
    appointmentCount, runningAmount, earned, rolledForward, status,
    baseDue, smsCount, smsPrice,
  } = billing
  const hasUsage = appointmentCount > 0
  const hasFooter = rolledForward > 0 || status === 'past_due' || status === 'suspended'

  return (
    // Full width + p:3 to match every other dashboard card. The hero figure
    // stays large; only the frame changes.
    <Card sx={{ mb: 3 }} data-testid="usage-meter">
      <CardContent sx={{ p: 3 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          {t('billing.thisMonthSoFar')}
        </Typography>

        {/* Earned — the hero figure. */}
        <Typography
          variant="h3"
          sx={{ fontWeight: 800, color: 'primary.main', lineHeight: 1.05, mt: 0.5 }}
          data-testid="usage-earned"
        >
          ₾{earned}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          {t('billing.earnedLabel')}
          {hasUsage ? ` · ${t('billing.apptsThisMonth', { count: appointmentCount })}` : ''}
        </Typography>

        {/* Commission — quiet secondary line, set off by a hairline. */}
        <Box
          sx={{
            mt: 1.75, pt: 1.5, borderTop: '1px solid', borderColor: 'divider',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1,
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('billing.commissionLabel')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }} data-testid="usage-running">
            ₾{runningAmount}
          </Typography>
        </Box>
        {/* Itemised: a flat fee and a usage fee are different things, and an
            owner who turned SMS on should be able to see what it cost. */}
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 0.5 }} data-testid="usage-breakdown">
          {baseDue > 0
            ? t('billing.baseLine', { amount: baseDue })
            : t('billing.baseFreeFirstMonth')}
          {smsCount > 0
            ? ` · ${t('billing.smsLine', { count: smsCount, price: smsPrice })}`
            : ''}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
          {t('billing.billedMonthEnd')}
        </Typography>

        {hasFooter && (
          <Box sx={{ mt: 1 }}>
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
        )}
      </CardContent>
    </Card>
  )
}
