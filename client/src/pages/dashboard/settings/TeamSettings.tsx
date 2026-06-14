import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Avatar,
  Stack, Divider, Alert, CircularProgress, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton,
} from '@mui/material'
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'

interface Member {
  id: string
  user_id: string
  role: 'owner' | 'admin'
  joined_at: string | null
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

  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitePhone, setInvitePhone] = useState('')
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)

    const [membersRes, invRes] = await Promise.all([
      supabase
        .from('org_members')
        .select('id, user_id, role, joined_at')
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
    setSuccess(`მოწვევა გაგზავნილია ${phone}-ზე`)
    setTimeout(() => setSuccess(null), 4000)
    load()
  }

  async function handleRemove(memberId: string) {
    await supabase.from('org_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  async function cancelInvite(invId: string) {
    await supabase.from('invitations').delete().eq('id', invId)
    setInvitations(prev => prev.filter(i => i.id !== invId))
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {t('settings.team')}
        </Typography>
        {role === 'owner' && (
          <Button
            variant="contained"
            startIcon={<PersonAddOutlinedIcon />}
            onClick={() => setInviteOpen(true)}
          >
            {t('settings.inviteAdmin')}
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      {/* Members list */}
      <Card sx={{ mb: 3 }}>
        {loading
          ? <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>
          : members.map((m, i) => (
            <Box key={m.id}>
              {i > 0 && <Divider />}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2 }}>
                <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}>
                  {m.user_id.slice(0, 2).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {m.user_id === user?.id ? 'თქვენ' : `მომხმარებელი ·${m.user_id.slice(-4)}`}
                  </Typography>
                  {m.joined_at && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      შეუერთდა: {new Date(m.joined_at).toLocaleDateString('ka-GE')}
                    </Typography>
                  )}
                </Box>
                <Chip
                  label={m.role === 'owner' ? 'მფლობელი' : 'ადმინი'}
                  size="small"
                  color={m.role === 'owner' ? 'primary' : 'default'}
                  variant={m.role === 'owner' ? 'filled' : 'outlined'}
                />
                {role === 'owner' && m.role !== 'owner' && m.user_id !== user?.id && (
                  <IconButton size="small" color="error" onClick={() => handleRemove(m.id)}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </IconButton>
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
                  <IconButton size="small" onClick={() => cancelInvite(inv.id)}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            ))}
          </Card>
        </>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="xs" fullWidth>
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
            disabled={inviting || invitePhone.length < 6}
          >
            {inviting ? <CircularProgress size={20} color="inherit" /> : 'გაგზავნა'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
