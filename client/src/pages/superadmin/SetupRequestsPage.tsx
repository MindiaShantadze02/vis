import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Card, CardContent, Typography, Button, Chip, IconButton, Stack,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { SupportOutlined as SupportOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { slugify } from '@/lib/slug'
import { formatGeorgianPhone, isValidGeorgianPhone, displayGeorgianPhone } from '@/lib/validation'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, useToast } from '@/components/ui'

interface SetupRequest {
  id: string
  created_at: string
  user_id: string
  org_id: string | null
  phone: string
  contact_email: string | null
  business_name: string
  address: string | null
  details: string
  status: 'pending' | 'completed'
  completed_at: string | null
}

/**
 * Concierge onboarding queue: businesses that asked us to set their account up
 * for them (submitted from the onboarding help form). Work a request by
 * creating the business (when the requester never finished onboarding) and
 * filling in services/specialists/hours on the org detail page, then mark it
 * completed — that texts the requester that everything is ready
 * (setup_complete SMS via the DB trigger).
 */
export default function SetupRequestsPage() {
  const navigate = useNavigate()
  const toast = useToast()

  const [requests, setRequests] = useState<SetupRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmComplete, setConfirmComplete] = useState<SetupRequest | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SetupRequest | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('setup_requests')
      .select('*')
      .order('status', { ascending: false }) // 'pending' > 'completed' — open work first
      .order('created_at', { ascending: true })
    setRequests((data ?? []) as SetupRequest[])
    setLoading(false)
  }

  // Requester never finished onboarding — create the org for them (owner_id =
  // requester, same shape onboarding uses) and link it to the request.
  async function createOrg(r: SetupRequest) {
    setWorking(true)
    const suffix = Math.random().toString(36).slice(2, 6)
    const slug = slugify(r.business_name) || `org-${suffix}`
    // The request snapshots auth.users.phone ("995XXXXXXXXX"); organisations
    // stores the bare 9-digit national form (organisations_contact_phone_format).
    const localPhone = formatGeorgianPhone(r.phone)
    const orgRow = {
      name: r.business_name,
      slug,
      address: r.address,
      contact_phone: isValidGeorgianPhone(localPhone) ? localPhone : null,
      contact_email: r.contact_email,
      owner_id: r.user_id,
    }
    let attempt = await supabase.from('organisations').insert(orgRow).select('id').single()
    if (attempt.error?.code === '23505') {
      attempt = await supabase.from('organisations').insert({ ...orgRow, slug: `${slug}-${suffix}` }).select('id').single()
    }
    if (attempt.error) { setWorking(false); toast.error(attempt.error.message); return }
    const orgId = attempt.data!.id

    const { error: memberErr } = await supabase
      .from('org_members')
      .insert({ org_id: orgId, user_id: r.user_id, role: 'owner', joined_at: new Date().toISOString() })
    if (memberErr) { setWorking(false); toast.error(memberErr.message); return }

    await supabase.from('setup_requests').update({ org_id: orgId }).eq('id', r.id)
    setWorking(false)
    toast.success('ბიზნესი შეიქმნა')
    navigate(`/superadmin/orgs/${orgId}`)
  }

  async function completeRequest() {
    if (!confirmComplete) return
    setWorking(true)
    const { data, error } = await supabase.rpc('complete_setup_request', { p_id: confirmComplete.id })
    setWorking(false)
    const res = data as { ok?: boolean; error?: string } | null
    if (error || !res?.ok) { toast.error(error?.message ?? res?.error ?? 'ვერ დასრულდა'); return }
    toast.success('დასრულდა — SMS გაეგზავნა ბიზნესს')
    setConfirmComplete(null)
    load()
  }

  async function deleteRequest() {
    if (!confirmDelete) return
    setWorking(true)
    const { error } = await supabase.from('setup_requests').delete().eq('id', confirmDelete.id)
    setWorking(false)
    if (error) { toast.error(error.message); return }
    setConfirmDelete(null)
    setRequests(prev => prev.filter(r => r.id !== confirmDelete.id))
  }

  if (loading) return <LoadingState />

  return (
    <Box sx={{ maxWidth: 860 }}>
      <PageHeader title="დახმარების მოთხოვნები" subtitle="ბიზნესები, რომლებსაც კონფიგურაცია ჩვენგან სჭირდებათ" />

      {requests.length === 0
        ? <EmptyState icon={<SupportOutlinedIcon />} title="მოთხოვნები არ არის" />
        : (
          <Stack spacing={2}>
            {requests.map(r => (
              <Card key={r.id} data-testid="setup-request-card">
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{r.business_name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        {displayGeorgianPhone(r.phone)}{r.contact_email ? ` · ${r.contact_email}` : ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {r.address ? `${r.address} · ` : ''}{format(new Date(r.created_at), 'dd MMM yyyy HH:mm')}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={r.status === 'pending' ? 'მოლოდინში' : 'დასრულებული'}
                      color={r.status === 'pending' ? 'warning' : 'success'}
                      sx={{ fontWeight: 600 }}
                    />
                    <IconButton size="small" onClick={() => setConfirmDelete(r)} aria-label="წაშლა">
                      <DeleteOutlinedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Box>

                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary', mb: 2 }}>
                    {r.details}
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    {r.org_id
                      ? (
                        <Button size="small" variant="outlined" onClick={() => navigate(`/superadmin/orgs/${r.org_id}`)}>
                          ორგანიზაციის გახსნა
                        </Button>
                      )
                      : (
                        <Button size="small" variant="contained" disabled={working} onClick={() => createOrg(r)} data-testid="setup-request-create-org">
                          ბიზნესის შექმნა
                        </Button>
                      )}
                    {r.status === 'pending' && (
                      <Button size="small" variant="contained" color="success" onClick={() => setConfirmComplete(r)} data-testid="setup-request-complete">
                        დასრულება + SMS
                      </Button>
                    )}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

      <ConfirmDialog
        open={!!confirmComplete}
        title="მოთხოვნის დასრულება"
        message={confirmComplete ? `დარწმუნებული ხართ? „${confirmComplete.business_name}" მიიღებს SMS-ს, რომ ყველაფერი მზადაა (${displayGeorgianPhone(confirmComplete.phone)}).` : ''}
        confirmLabel="დასრულება"
        destructive={false}
        loading={working}
        onConfirm={completeRequest}
        onClose={() => setConfirmComplete(null)}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title="მოთხოვნის წაშლა"
        message={confirmDelete ? `წაიშალოს „${confirmDelete.business_name}"-ის მოთხოვნა?` : ''}
        confirmLabel="წაშლა"
        loading={working}
        onConfirm={deleteRequest}
        onClose={() => setConfirmDelete(null)}
      />
    </Box>
  )
}
