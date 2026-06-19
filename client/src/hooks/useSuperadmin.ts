import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Resolves whether the current user is a platform superadmin via the
 * is_superadmin() RPC (the table-backed source of truth, migration 026).
 * Used by the route guard and the dashboard nav link. Re-checks when the
 * signed-in user changes.
 */
export function useSuperadmin(): { isSuperadmin: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuth()
  const [isSuperadmin, setIsSuperadmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) { setIsSuperadmin(false); setLoading(false); return }

    let active = true
    setLoading(true)
    supabase.rpc('is_superadmin').then(({ data }) => {
      if (active) { setIsSuperadmin(data === true); setLoading(false) }
    })
    return () => { active = false }
  }, [user, authLoading])

  return { isSuperadmin, loading }
}
