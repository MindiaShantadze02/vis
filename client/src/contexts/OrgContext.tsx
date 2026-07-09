import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { subscriptionState, type SubscriptionState, type Tier } from '@/lib/tiers'

export interface Organisation {
  id: string
  name: string
  description: string | null
  slug: string
  contact_phone: string | null
  logo_url: string | null
  subscription_tier: Tier
  subscription_expires_at: string | null
  trial_ends_at: string
  trial_expiry_ack_at: string | null
  link_share_done_at: string | null
  checklist_dismissed_at: string | null
  booking_theme: string | null
  reviews_enabled: boolean
}

interface OrgContextValue {
  org: Organisation | null
  role: 'owner' | 'admin' | null
  /** trial | active | expired, derived the same way as the DB's org_subscription_state. */
  subscription: SubscriptionState | null
  loading: boolean
  refresh: () => Promise<void>
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  role: null,
  subscription: null,
  loading: true,
  refresh: async () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [role, setRole] = useState<'owner' | 'admin' | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadOrg() {
    if (!user) {
      setOrg(null)
      setRole(null)
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
        setOrg(data.organisations as unknown as Organisation)
        setRole(data.role as 'owner' | 'admin')
      } else {
        setOrg(null)
        setRole(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading) loadOrg()
  }, [user, authLoading])

  // Derived once here so banners / gates all agree on the state.
  const subscription = org
    ? subscriptionState(org.trial_ends_at, org.subscription_expires_at)
    : null

  return (
    <OrgContext.Provider value={{ org, role, subscription, loading, refresh: loadOrg }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
