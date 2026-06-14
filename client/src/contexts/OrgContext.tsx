import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export interface Organisation {
  id: string
  name: string
  description: string | null
  slug: string
  contact_phone: string | null
  logo_url: string | null
  subscription_tier: 'free' | 'starter' | 'pro' | 'business'
  appointments_used_this_month: number
}

interface OrgContextValue {
  org: Organisation | null
  role: 'owner' | 'admin' | null
  loading: boolean
  refresh: () => Promise<void>
}

const OrgContext = createContext<OrgContextValue>({
  org: null,
  role: null,
  loading: true,
  refresh: async () => {},
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [role, setRole] = useState<'owner' | 'admin' | null>(null)
  const [loading, setLoading] = useState(true)

  const overrideOrgId = sessionStorage.getItem('grafiki_override_org_id')

  async function loadOrg() {
    if (!user) {
      setOrg(null)
      setRole(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      if (overrideOrgId) {
        const { data } = await supabase
          .from('organisations')
          .select('*')
          .eq('id', overrideOrgId)
          .single()
        if (data) { setOrg(data as Organisation); setRole('admin') }
      } else {
        const { data } = await supabase
          .from('org_members')
          .select('role, organisations(*)')
          .eq('user_id', user.id)
          .single()
        if (data) {
          setOrg(data.organisations as unknown as Organisation)
          setRole(data.role as 'owner' | 'admin')
        } else {
          setOrg(null)
          setRole(null)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading) loadOrg()
  }, [user, authLoading])

  return (
    <OrgContext.Provider value={{ org, role, loading, refresh: loadOrg }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
