import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useToast } from '@/components/ui'

/**
 * "Pay now" — settle every outstanding billing period and recover the org.
 * `settle_usage_charge` flips billing_status back to 'active' once nothing is
 * left pending/failed, which is what lifts the booking block.
 *
 * Shared by Settings → Billing and the blocking dialog so the two can't drift.
 *
 * Refreshes BOTH billing snapshots on success: `refreshBilling()` for the fresh
 * status the gate reads, and `refresh()` because `organisations.billing_status`
 * is the gate's fail-closed fallback and would otherwise stay stale until the
 * next auth change.
 *
 * NOTE: `pay_org_outstanding` is mock-provider only — it raises
 * `provider_not_configured` against a real gateway. Wiring the 'usage' checkout
 * purpose through create-payment is a separate task.
 */
export function useBillingPayment() {
  const { t } = useTranslation()
  const toast = useToast()
  const { org, refresh, refreshBilling } = useOrg()
  const [paying, setPaying] = useState(false)

  async function payNow(): Promise<boolean> {
    if (!org || paying) return false
    setPaying(true)
    const { error } = await supabase.rpc('pay_org_outstanding', { p_org_id: org.id })
    setPaying(false)
    if (error) {
      toast.error(t('billing.payFailed'))
      return false
    }
    toast.success(t('billing.paid'))
    await Promise.all([refreshBilling(), refresh()])
    return true
  }

  return { payNow, paying }
}
