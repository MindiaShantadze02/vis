import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { parseBillingStatus, type BillingStatus, type BillingState } from '@/lib/billing'

export interface Organisation {
  id: string
  name: string
  description: string | null
  slug: string
  contact_phone: string | null
  // Merchant legal disclosure fields (E-Commerce Law Art. 4 / Consumer Law Art. 5).
  contact_email: string | null
  address: string | null
  logo_url: string | null
  // Optional wide banner for the public booking page (uploaded in Booking-page
  // settings; stored in the `logos` bucket at {org_id}/cover.{ext}).
  cover_url: string | null
  // Post-paid billing state (active / past_due / suspended). Suspended blocks
  // new bookings; data and the booking page stay alive.
  billing_status: BillingState
  link_share_done_at: string | null
  checklist_dismissed_at: string | null
  booking_theme: string | null
  reviews_enabled: boolean
  require_approval: boolean
  // Cancellation policy (migration 090): the free-cancel/refund window,
  // consumed by self-service cancel-with-refund.
  cancellation_window_hours: number
  // Org-default deposit (services with NULL deposit_type inherit it) + whether
  // an in-window cancel refunds the deposit.
  deposit_type: 'none' | 'fixed' | 'percent'
  deposit_value: number | null
  deposit_refundable: boolean
}

interface OrgContextValue {
  org: Organisation | null
  role: 'owner' | 'admin' | null
  /**
   * Post-paid billing snapshot from get_org_billing_status (running bill,
   * rolled-forward balance, card on file). Null until loaded / when signed out.
   */
  billing: BillingStatus | null
  loading: boolean
  refresh: () => Promise<void>
  /** Re-fetch just the billing snapshot (e.g. after a booking changes the count). */
  refreshBilling: () => Promise<void>
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  role: null,
  billing: null,
  loading: true,
  refresh: async () => {},
  refreshBilling: async () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [role, setRole] = useState<'owner' | 'admin' | null>(null)
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch the org's post-paid billing snapshot in one round-trip. Best-effort:
  // a failure just leaves the running-bill widget to no-op rather than blocking
  // the dashboard.
  async function loadBilling(orgId: string) {
    const { data, error } = await supabase.rpc('get_org_billing_status', { p_org_id: orgId })
    if (error) { console.error('[OrgContext] get_org_billing_status failed:', error); return }
    setBilling(parseBillingStatus(data))
  }

  async function loadOrg() {
    if (!user) {
      setOrg(null)
      setRole(null)
      setBilling(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // A user may end up with more than one membership (e.g. duplicate orgs
      // created by repeated onboarding). .single() throws on >1 rows, which
      // would null out `org` and bounce them back to onboarding forever — so
      // take the most recent membership instead of assuming exactly one.
      const { data, error } = await supabase
        .from('org_members')
        .select('role, organisations(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) console.error('[OrgContext] org_members load failed:', error)
      if (data) {
        const loaded = data.organisations as unknown as Organisation
        setOrg(loaded)
        setRole(data.role as 'owner' | 'admin')
        void loadBilling(loaded.id)
      } else {
        setOrg(null)
        setRole(null)
        setBilling(null)
      }
    } finally {
      setLoading(false)
    }
  }

  async function refreshBilling() {
    if (org) await loadBilling(org.id)
  }

  useEffect(() => {
    if (!authLoading) loadOrg()
  }, [user, authLoading])

  return (
    <OrgContext.Provider value={{ org, role, billing, loading, refresh: loadOrg, refreshBilling }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
