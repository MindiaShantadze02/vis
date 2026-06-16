import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Avatar,
  Stack, Divider, Alert, CircularProgress, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Switch, FormControlLabel,
} from '@mui/material'
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone } from '@/lib/validation'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, LoadingState, ActionIconButton, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'

interface Member {
  id: string
  user_id: string
  role: 'owner' | 'admin'
  joined_at: string | null
  display_name: string | null
  title: string | null
  is_bookable: boolean
  sort_order: number
  user_phone?: string
}

interface Invitation {
  id: string
  phone_number: string
  role: string
  expires_at: string | null
  accepted_at: string | null
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('995') ? `+${digits}` : `+995${digits}`
}

export default function TeamSettings() {
  const { t } = useTranslation()
  const { org, role } = useOrg()
  const { user } = useAuth()
  const toast = useToast()

  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitePhone, setInvitePhone] = useState('')
  const [inviting, setInviting] = useState(false)

  // Edit member dialog
  const [editMember, setEditMember] = useState<Member | null>(null)
  const [editName, setEditName] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editBookable, setEditBookable] = useState(false)
  const [savingMember, setSavingMember] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)

    const [membersRes, invRes] = await Promise.all([
      supabase
        .from('org_members')
        .select('id, user_id, role, joined_at, display_name, title, is_bookable, sort_order')
        .eq('org_id', org.id)
        .order('joined_at'),
      supabase
        .from('invitations')
        .select('id, phone_number, role, expires_at, accepted_at')
        .eq('org_id', org.id)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ])

    setMembers((membersRes.data ?? []) as Member[])
    setInvitations((invRes.data ?? []) as Invitation[])
    setLoading(false)
  }

  async function handleInvite() {
    if (!org || !invitePhone.trim()) return
    setInviting(true)
    setError(null)

    const phone = formatPhone(invitePhone)
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: err } = await supabase.from('invitations').insert({
      org_id: org.id,
      phone_number: phone,
      role: 'admin',
      invited_by: user?.id,
      token,
      expires_at: expiresAt,
    })

    setInviting(false)
    if (err) { setError(err.message); return }

    setInviteOpen(false)
    setInvitePhone('')
    toast.success(`მოწვევა გაგზავნილია ${phone}-ზე`)
    load()
  }

  async function handleRemove(memberId: string) {
    await supabase.from('org_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
    toast.success(t('common.deleted'))
  }

  async function cancelInvite(invId: string) {
    await supabase.from('invitations').delete().eq('id', invId)
    setInvitations(prev => prev.filter(i => i.id !== invId))
    toast.success(t('common.deleted'))
  }

  function openEdit(m: Member) {
    setEditMember(m)
    setEditName(m.display_name ?? '')
    setEditTitle(m.title ?? '')
    setEditBookable(m.is_bookable)
  }

  async function saveMember() {
    if (!editMember) return
    setSavingMember(true)
    const patch = {
      display_name: editName.trim() || null,
      title: editTitle.trim() || null,
      is_bookable: editBookable,
    }
    const { error: err } = await supabase
      .from('org_members')
      .update(patch)
      .eq('id', editMember.id)
    setSavingMember(false)
    if (err) { setError(err.message); return }
    setMembers(prev => prev.map(m => m.id === editMember.id ? { ...m, ...patch } : m))
    setEditMember(null)
    toast.success(t('common.saved'))
  }

  const invitePhoneInvalid = invitePhone.trim().length > 0 && !isValidGeorgianPhone(invitePhone)

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader
        title={t('settings.team')}
        action={role === 'owner' && (
          <Button
            variant="contained"
            startIcon={<PersonAddOutlinedIcon />}
            onClick={() => setInviteOpen(true)}
          >
            {t('settings.inviteAdmin')}
          </Button>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Members list */}
      <Card sx={{ mb: 3 }}>
        {loading
          ? <LoadingState />
          : members.map((m, i) => (
            <Box key={m.id}>
              {i > 0 && <Divider />}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2 }}>
                <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}>
                  {(m.display_name?.trim() || m.user_id).slice(0, 2).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {m.display_name?.trim()
                      || (m.user_id === user?.id ? 'თქვენ' : `მომხმარებელი ·${m.user_id.slice(-4)}`)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {[m.title?.trim(), m.joined_at ? `შეუერთდა: ${new Date(m.joined_at).toLocaleDateString('ka-GE')}` : null]
                      .filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                {m.is_bookable && (
                  <Chip label={t('settings.bookable')} size="small" color="success" variant="outlined" />
                )}
                <Chip
                  label={m.role === 'owner' ? 'მფლობელი' : 'ადმინი'}
                  size="small"
                  color={m.role === 'owner' ? 'primary' : 'default'}
                  variant={m.role === 'owner' ? 'filled' : 'outlined'}
                />
                <ActionIconButton aria-label={t('settings.editMember')} onClick={() => openEdit(m)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                {role === 'owner' && m.role !== 'owner' && m.user_id !== user?.id && (
                  <ActionIconButton tone="danger" aria-label={t('settings.removeAdmin')} onClick={() => handleRemove(m.id)}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </ActionIconButton>
                )}
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5, color: 'text.secondary' }}>
            მოლოდინში მყოფი მოწვევები
          </Typography>
          <Card>
            {invitations.map((inv, i) => (
              <Box key={inv.id}>
                {i > 0 && <Divider />}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{inv.phone_number}</Typography>
                    {inv.expires_at && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        ვადა: {new Date(inv.expires_at).toLocaleDateString('ka-GE')}
                      </Typography>
                    )}
                  </Box>
                  <Chip label="მოლოდინში" size="small" color="warning" variant="outlined" />
                  <ActionIconButton tone="danger" aria-label={t('common.cancel')} onClick={() => cancelInvite(inv.id)}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </ActionIconButton>
                </Box>
              </Box>
            ))}
          </Card>
        </>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>ადმინის მოწვევა</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              ადმინი მიიღებს SMS-ს რეგისტრაციის ბმულით.
            </Typography>
            <TextField
              label="ტელეფონის ნომერი"
              value={invitePhone}
              onChange={e => setInvitePhone(e.target.value)}
              fullWidth
              placeholder="599 123 456"
              error={invitePhoneInvalid}
              helperText={invitePhoneInvalid ? t('validation.invalidPhone') : ' '}
              slotProps={{
                input: {
                  startAdornment: (
                    <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
                      🇬🇪 +995
                    </Typography>
                  ),
                },
                htmlInput: { inputMode: 'tel' as const },
              }}
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleInvite}
            disabled={inviting || !isValidGeorgianPhone(invitePhone)}
          >
            {inviting ? <CircularProgress size={20} color="inherit" /> : 'გაგზავნა'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit member dialog */}
      <Dialog open={!!editMember} onClose={() => setEditMember(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.editMember')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('settings.displayName')}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              fullWidth
              autoFocus
            />
            <TextField
              label={t('settings.staffTitle')}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              fullWidth
            />
            <FormControlLabel
              control={<Switch checked={editBookable} onChange={e => setEditBookable(e.target.checked)} />}
              label={t('settings.bookable')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditMember(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={saveMember} disabled={savingMember}>
            {savingMember ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
