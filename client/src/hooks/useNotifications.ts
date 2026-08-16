import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export interface Notification {
  id: string
  created_at: string
  type: 'new_appointment' | 'appointment_cancelled'
  appointment_id: string | null
  title: string
  body: string | null
  read_at: string | null
}

const FETCH_LIMIT = 30

/**
 * Loads the signed-in admin's notifications and keeps them live via a Supabase
 * realtime subscription. RLS scopes both the initial fetch and the realtime
 * stream to `user_id = auth.uid()`, so no org filtering is needed here.
 */
export function useNotifications() {
  const { user } = useAuth()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('id, created_at, type, appointment_id, title, body, read_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT)
    setItems((data ?? []) as Notification[])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // Live updates: prepend new notifications as they're inserted. The filter
  // restricts the stream to this user; RLS enforces it server-side too.
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        payload => {
          const incoming = payload.new as Notification
          setItems(prev =>
            prev.some(n => n.id === incoming.id)
              ? prev
              : [incoming, ...prev].slice(0, FETCH_LIMIT)
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user])

  const unreadCount = items.reduce((n, item) => (item.read_at ? n : n + 1), 0)

  // Marks every unread notification read. Optimistic: the badge clears
  // immediately, the DB write reconciles in the background.
  const markAllRead = useCallback(async () => {
    if (!user) return
    if (!items.some(n => !n.read_at)) return
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: now })))
    await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('user_id', user.id)
      .is('read_at', null)
  }, [user, items])

  return { items, loading, unreadCount, markAllRead, reload: load }
}
