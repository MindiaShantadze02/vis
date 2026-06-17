import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Box, Typography, Button, Stack, CircularProgress } from '@mui/material'
import MailOutlineIcon from '@mui/icons-material/MailOutlined'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { useToast } from '@/components/ui'

interface Invite {
  id: string
  token: string
  role: string
  org_name: string
}

/** Maps an accept_invitation() error code to a Georgian message. */
const ACCEPT_ERRORS: Record<string, string> = {
  already_in_org: 'თქვენ უკვე ხართ ორგანიზაციის წევრი',
  expired: 'მოწვევის ვადა გავიდა',
  wrong_account: 'ეს მოწვევა სხვა ანგარიშზეა გაგზავნილი',
  not_found: 'მოწვევა ვერ მოიძებნა',
  not_authenticated: 'გთხოვთ თავიდან შეხვიდეთ',
}

/**
 * Banner shown to a logged-in user who has a pending invitation addressed to
 * their email. Accepting joins them to the org. Renders nothing when there are
 * no invites, so it's safe to mount unconditionally at the top of a page.
 */
export default function PendingInvites() {
  const { user } = useAuth()
  const { refresh } = useOrg()
  const toast = useToast()
  const navigate = useNavigate()

  const [invites, setInvites] = useState<Invite[]>([])
  const [accepting, setAccepting] = useState<string | null>(null)

  const email = user?.email?.toLowerCase() ?? null

  const load = useCallback(async () => {
    if (!email) return
    const { data } = await supabase
      .from('invitations')
      .select('id, token, role, organisations(name)')
      .eq('email', email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    setInvites((data ?? []).map(row => {
      const r = row as Record<string, unknown>
      const orgRel = r.organisations as { name?: string } | { name?: string }[] | null
      const org = Array.isArray(orgRel) ? orgRel[0] : orgRel
      return { id: r.id as string, token: r.token as string, role: r.role as string, org_name: org?.name ?? '—' }
    }))
  }, [email])

  useEffect(() => { load() }, [load])

  async function accept(inv: Invite) {
    setAccepting(inv.id)
    const { data, error } = await supabase.rpc('accept_invitation', { p_token: inv.token })
    setAccepting(null)

    if (error) { toast.error(error.message); return }

    const result = data as { ok: boolean; error?: string }
    if (!result?.ok) {
      toast.error(ACCEPT_ERRORS[result?.error ?? ''] ?? 'მოწვევის მიღება ვერ მოხერხდა')
      // If it's already accepted/expired/taken, drop it from the list.
      if (result?.error && result.error !== 'not_authenticated') {
        setInvites(prev => prev.filter(i => i.id !== inv.id))
      }
      return
    }

    setInvites(prev => prev.filter(i => i.id !== inv.id))
    toast.success(`შეუერთდით ორგანიზაციას: ${inv.org_name}`)
    await refresh()
    // From onboarding this lands them on the dashboard; on the dashboard the
    // refreshed org context simply re-renders the full view.
    navigate('/dashboard')
  }

  if (invites.length === 0) return null

  return (
    <Stack spacing={1.5} sx={{ mb: 3 }}>
      {invites.map(inv => (
        <Card key={inv.id} sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, borderLeft: '3px solid', borderColor: 'primary.main' }}>
          <MailOutlineIcon sx={{ color: 'primary.main' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              მოწვევა: <b>{inv.org_name}</b>
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              თქვენ მიწვეული ხართ {inv.role === 'owner' ? 'მფლობელად' : 'ადმინად'}
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            onClick={() => accept(inv)}
            disabled={accepting !== null}
          >
            {accepting === inv.id ? <CircularProgress size={18} color="inherit" /> : 'მიღება'}
          </Button>
        </Card>
      ))}
    </Stack>
  )
}
