import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertTitle, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { trialDaysLeft } from '@/lib/tiers'

/**
 * The dashboard's subscription surface (record §2/§4): a countdown banner for
 * the last 7 trial days, then — once expired — a one-time prominent notice
 * (dismissable, persisted in trial_expiry_ack_at) that collapses into a slim
 * permanent "choose a plan" strip. All in-app; never SMS.
 */
export default function SubscriptionBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { org, subscription, refresh } = useOrg()
  // Session-local fallback so dismissal works even when the persisting write
  // is rejected (organisations UPDATE is owner-only; admins get this instead).
  const [hidden, setHidden] = useState(false)

  if (!org || !subscription || subscription === 'active') return null

  const choosePlan = (
    <Button
      color="inherit"
      size="small"
      data-testid="banner-choose-plan"
      onClick={() => navigate('/dashboard/settings/subscription')}
      sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}
    >
      {t('subscription.choosePlan')}
    </Button>
  )

  if (subscription === 'trial') {
    const days = trialDaysLeft(org.trial_ends_at)
    if (days > 7) return null
    return (
      <Alert severity="warning" action={choosePlan} data-testid="trial-countdown-banner" sx={{ mb: 2 }}>
        {t('subscription.trialBanner', { count: days })}
      </Alert>
    )
  }

  // Expired. The full notice shows exactly once; acknowledging it leaves the
  // slim strip, which is intentionally not dismissible.
  if (!org.trial_expiry_ack_at && !hidden) {
    async function acknowledge() {
      setHidden(true)
      const { error } = await supabase
        .from('organisations')
        .update({ trial_expiry_ack_at: new Date().toISOString() })
        .eq('id', org!.id)
      if (!error) await refresh()
    }
    return (
      <Alert severity="error" onClose={acknowledge} action={choosePlan} data-testid="expired-notice" sx={{ mb: 2 }}>
        <AlertTitle sx={{ fontWeight: 700 }}>{t('subscription.expiredTitle')}</AlertTitle>
        {t('subscription.expiredBody')}
      </Alert>
    )
  }

  return (
    <Alert severity="error" icon={false} action={choosePlan} data-testid="expired-strip" sx={{ mb: 2, py: 0 }}>
      {t('subscription.expiredStrip')}
    </Alert>
  )
}
