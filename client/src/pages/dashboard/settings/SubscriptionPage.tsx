import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, LinearProgress,
  Stack, Chip, Divider, CircularProgress,
} from '@mui/material'
import { Check as CheckIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { dateLocale } from '@/lib/dateLocale'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader } from '@/components/ui'
import { TIERS, type Tier } from '@/lib/tiers'

export default function SubscriptionPage() {
  const { t } = useTranslation()
  const { org, subscription, entitlements } = useOrg()

  const [used, setUsed] = useState<number | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [periodEnd, setPeriodEnd] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState<Tier | null>(null)

  const currentTier: Tier = org?.subscription_tier ?? 'solo'
  const expires = org?.subscription_expires_at

  useEffect(() => {
    if (org) loadUsage()
  }, [org])

  async function loadUsage() {
    if (!org) return
    setLoading(true)
    // Server-derived usage for the org's current billing period — same
    // source the booking limit is enforced against, so the numbers match.
    const { data } = await supabase
      .rpc('org_usage_info', { p_org_id: org.id })
      .maybeSingle()
    const usage = data as { used?: number; appt_limit?: number | null; period_end?: string | null } | null
    setUsed(usage?.used ?? 0)
    setLimit(usage?.appt_limit ?? null)
    setPeriodEnd(usage?.period_end ?? null)
    setLoading(false)
  }

  // Kick off a tier upgrade: create-payment recomputes the price server-side,
  // records a pending subscription_payment, and returns the gateway checkout
  // URL (mock for now). The org's tier flips once payment clears.
  async function handleUpgrade(tier: Tier) {
    if (!org) return
    setUpgrading(tier)
    const { data, error } = await supabase.functions.invoke('create-payment', {
      body: { purpose: 'subscription', org_id: org.id, tier, returnBaseUrl: window.location.origin },
    })
    if (error || !data?.checkoutUrl) {
      setUpgrading(null)
      return
    }
    window.location.assign(data.checkoutUrl)
  }

  const pct = limit && used !== null ? Math.min((used / limit) * 100, 100) : 0
  const nearLimit = limit && used !== null && used >= limit * 0.8

  return (
    <Box>
      <PageHeader title={t('settings.subscription')} />

      {/* Current plan */}
      <Card sx={{ mb: 4 }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('subscription.currentPlan')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Chip
                  label={t(`tiers.${currentTier}.label`)}
                  size="small"
                  sx={{ bgcolor: 'text.primary', color: 'background.paper', fontWeight: 600 }}
                />
                {subscription === 'trial' && (
                  <Chip
                    label={t('subscription.trialChip')}
                    size="small"
                    color="warning"
                    variant="outlined"
                    data-testid="trial-chip"
                    sx={{ fontWeight: 600 }}
                  />
                )}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t(`tiers.${currentTier}.price`)}
                </Typography>
              </Box>
              {/* Spelled-out month — "05/08/2026" is ambiguous (DD/MM vs MM/DD). */}
              {subscription === 'trial' && org && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                  {t('subscription.trialEndsOn', { date: format(new Date(org.trial_ends_at), 'd MMMM yyyy', { locale: dateLocale() }) })}
                </Typography>
              )}
              {subscription !== 'trial' && expires && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                  {t('subscription.expiresOn', { date: format(new Date(expires), 'd MMMM yyyy', { locale: dateLocale() }) })}
                </Typography>
              )}
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Usage bar */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('subscription.bookingsThisMonth')}
              </Typography>
              {loading
                ? <CircularProgress size={14} />
                : (
                  <Typography variant="body2" sx={{ color: nearLimit ? 'error.main' : 'text.secondary' }}>
                    {used} / {limit ?? '∞'}
                  </Typography>
                )
              }
            </Box>
            {limit && (
              <LinearProgress
                variant="determinate"
                value={pct}
                aria-label={`${used ?? 0} / ${limit}`}
                sx={{
                  // Over-allowance is metered, not blocked → amber, never red.
                  '& .MuiLinearProgress-bar': {
                    bgcolor: pct >= 80 ? 'warning.main' : 'primary.main',
                  },
                }}
              />
            )}
            {periodEnd && (
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
                {t('subscription.renews', { date: format(new Date(periodEnd), 'd MMMM yyyy', { locale: dateLocale() }) })}
              </Typography>
            )}
            {nearLimit && limit && used !== null && used < limit && (
              <Typography variant="caption" sx={{ color: 'warning.main', mt: 0.5, display: 'block' }}>
                {t('subscription.nearLimit')}
              </Typography>
            )}
            {/* Metered overage (active orgs only; trial is a soft allowance so
                overageCount stays 0). Display only until billing is wired. */}
            {entitlements && entitlements.overageCount > 0 && (
              <Typography variant="caption" data-testid="subscription-overage" sx={{ color: 'warning.main', mt: 0.5, display: 'block', fontWeight: 600 }}>
                {t('subscription.overageSummary', { count: entitlements.overageCount, cost: entitlements.overageCost })}
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Tier cards */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        {t('subscription.comparePlans')}
      </Typography>
      <Stack spacing={2}>
        {TIERS.map(tier => {
          const isCurrent = tier.key === currentTier
          // A trial/expired org hasn't bought anything yet, so its "current"
          // tier is still purchasable (that's the whole conversion path).
          const canBuy = !isCurrent || subscription !== 'active'
          return (
            <Card
              key={tier.key}
              // Current plan gets a single accent hairline; the recommended
              // plan keeps a subtle accent too; the rest stay neutral.
              sx={{ borderColor: isCurrent || tier.recommended ? 'primary.main' : 'divider' }}
            >
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {t(`tiers.${tier.key}.label`)}
                      </Typography>
                      {tier.recommended && !isCurrent && (
                        <Chip label={t('subscription.recommended')} size="small" color="primary" sx={{ fontWeight: 600 }} />
                      )}
                      {isCurrent && (
                        <Chip label={t('subscription.current')} size="small" sx={{ bgcolor: 'text.primary', color: 'background.paper', fontWeight: 600 }} />
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', mb: 1.5 }}>
                      {t(`tiers.${tier.key}.price`)}
                    </Typography>
                    <Stack spacing={0.5}>
                      {(t(`tiers.${tier.key}.features`, { returnObjects: true }) as string[]).map(f => (
                        <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
                          <Typography variant="caption">{f}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>

                  {canBuy && (
                    <Button
                      variant={tier.recommended ? 'contained' : 'outlined'}
                      size="small"
                      onClick={() => handleUpgrade(tier.key)}
                      disabled={upgrading !== null}
                      data-testid={`buy-${tier.key}`}
                      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {upgrading === tier.key
                        ? <CircularProgress size={16} />
                        : subscription === 'active' ? t('subscription.upgrade') : t('subscription.choosePlan')}
                    </Button>
                  )}
                </Box>
              </CardContent>
            </Card>
          )
        })}
      </Stack>

      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 3, textAlign: 'center' }}>
        {t('subscription.footer')}
      </Typography>
    </Box>
  )
}
