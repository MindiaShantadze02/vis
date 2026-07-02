import { useEffect, useRef, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Avatar,
  Stack, Divider, Alert, CircularProgress, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Switch, FormControlLabel,
} from '@mui/material'
import { PersonAddOutlined as PersonAddOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { PhotoCameraOutlined as PhotoCameraOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidEmail, imageFileError, FIELD_LIMITS } from '@/lib/validation'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, LoadingState, ActionIconButton, useToast } from '@/components/ui'
import { LAYOUT, surface } from '@/theme/theme'

interface Member {
  id: string
  user_id: string | null
  role: 'owner' | 'admin' | 'staff'
  joined_at: string | null
  display_name: string | null
  title: string | null
  is_bookable: boolean
  sort_order: number
  avatar_url: string | null
  user_phone?: string
}

// Avatar with a small camera badge that triggers a file picker — shared by the
// edit and add-professional dialogs. Mirrors the logo picker in ProfileSettings.
function PhotoPicker({ src, initials, uploading, onPick }: {
  src: string | null
  initials: string
  uploading: boolean
  onPick: (file: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Box sx={{ position: 'relative', width: 72 }}>
      <Avatar src={src ?? undefined} sx={{ width: 72, height: 72, bgcolor: 'primary.main', fontSize: 26 }}>
        {initials}
      </Avatar>
      <Box
        onClick={() => ref.current?.click()}
        sx={{
          position: 'absolute', bottom: 0, right: 0,
          width: 26, height: 26, borderRadius: '50%',
          bgcolor: 'background.paper', border: '2px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          '&:hover': { bgcolor: surface.hover },
        }}
      >
        {uploading ? <CircularProgress size={12} /> : <PhotoCameraOutlinedIcon sx={{ fontSize: 14 }} />}
      </Box>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        data-testid="member-photo-input"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />
    </Box>
  )
}

interface Invitation {
  id: string
  phone_number: string | null
  email: string | null
  role: string
  expires_at: string | null
  accepted_at: string | null
}


export default function TeamSettings() {
  const { t, i18n } = useTranslation()
  const { org, role } = useOrg()
  const { user } = useAuth()
  const toast = useToast()

  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  // Edit member dialog
  const [editMember, setEditMember] = useState<Member | null>(null)
  const [editName, setEditName] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editBookable, setEditBookable] = useState(false)
  const [savingMember, setSavingMember] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  // Add-professional dialog (account-less staff profile)
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addBookable, setAddBookable] = useState(true)
  const [addPhotoFile, setAddPhotoFile] = useState<File | null>(null)
  const [addPhotoPreview, setAddPhotoPreview] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // Login members (owner/admin) vs. account-less professionals (role='staff').
  const teamMembers = members.filter(m => m.role !== 'staff')
  const professionals = members.filter(m => m.role === 'staff')

  const MEMBER_COLS = 'id, user_id, role, joined_at, display_name, title, is_bookable, sort_order, avatar_url'

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)

    const [membersRes, invRes] = await Promise.all([
      supabase
        .from('org_members')
        .select(MEMBER_COLS)
        .eq('org_id', org.id)
        .order('joined_at'),
      supabase
        .from('invitations')
        .select('id, phone_number, email, role, expires_at, accepted_at')
        .eq('org_id', org.id)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ])

    setMembers((membersRes.data ?? []) as Member[])
    setInvitations((invRes.data ?? []) as Invitation[])
    setLoading(false)
  }

  // Upload a photo to the member-photos bucket at "<org>/<member>.<ext>" and
  // return its cache-busted public URL (mirrors the logo upload). Toasts on
  // invalid/oversized files or upload errors and returns null.
  async function uploadMemberPhoto(memberId: string, file: File): Promise<string | null> {
    if (!org) return null
    const fileErr = imageFileError(file)
    if (fileErr) {
      toast.error(fileErr === 'fileTooLarge' ? t('validation.fileTooLarge', { max: 2 }) : t('validation.invalidImage'))
      return null
    }
    const ext = file.name.split('.').pop()
    const path = `${org.id}/${memberId}.${ext}`
    const { error: upErr } = await supabase.storage.from('member-photos').upload(path, file, { upsert: true })
    if (upErr) { toast.error(upErr.message); return null }
    const { data } = supabase.storage.from('member-photos').getPublicUrl(path)
    return `${data.publicUrl}?v=${Date.now()}`
  }

  // Edit dialog: upload immediately (the row already exists) and persist.
  async function handleEditPhoto(file: File) {
    if (!editMember) return
    setUploadingPhoto(true)
    const url = await uploadMemberPhoto(editMember.id, file)
    if (url) {
      await supabase.from('org_members').update({ avatar_url: url }).eq('id', editMember.id)
      setEditMember(m => (m ? { ...m, avatar_url: url } : m))
      setMembers(prev => prev.map(m => (m.id === editMember.id ? { ...m, avatar_url: url } : m)))
    }
    setUploadingPhoto(false)
  }

  function openAdd() {
    setAddName(''); setAddTitle(''); setAddBookable(true)
    setAddPhotoFile(null); setAddPhotoPreview(null); setError(null)
    setAddOpen(true)
  }

  // Add dialog: defer the upload until the row exists (we need its id for the
  // path), so just stage the file + a local preview here.
  function pickAddPhoto(file: File) {
    const fileErr = imageFileError(file)
    if (fileErr) {
      toast.error(fileErr === 'fileTooLarge' ? t('validation.fileTooLarge', { max: 2 }) : t('validation.invalidImage'))
      return
    }
    setAddPhotoFile(file)
    setAddPhotoPreview(URL.createObjectURL(file))
  }

  async function handleAddProfessional() {
    if (!org || addName.trim().length < 2) return
    setAdding(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('org_members')
      .insert({
        org_id: org.id,
        user_id: null,
        role: 'staff',
        is_bookable: addBookable,
        display_name: addName.trim(),
        title: addTitle.trim() || null,
        sort_order: professionals.length,
      })
      .select(MEMBER_COLS)
      .single()
    if (err || !data) { setAdding(false); setError(err?.message ?? 'insert_failed'); return }

    let created = data as Member
    if (addPhotoFile) {
      const url = await uploadMemberPhoto(created.id, addPhotoFile)
      if (url) {
        await supabase.from('org_members').update({ avatar_url: url }).eq('id', created.id)
        created = { ...created, avatar_url: url }
      }
    }
    setMembers(prev => [...prev, created])
    setAdding(false)
    setAddOpen(false)
    toast.success(t('common.saved'))
  }

  async function handleInvite() {
    if (!org || !inviteEmail.trim()) return
    setInviting(true)
    setError(null)

    const email = inviteEmail.trim().toLowerCase()
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: err } = await supabase.from('invitations').insert({
      org_id: org.id,
      email,
      role: 'admin',
      invited_by: user?.id,
      token,
      expires_at: expiresAt,
    })

    setInviting(false)
    if (err) { setError(err.message); return }

    setInviteOpen(false)
    setInviteEmail('')
    toast.success(t('settings.inviteSent', { email }))
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

  const inviteEmailInvalid = inviteEmail.trim().length > 0 && !isValidEmail(inviteEmail)

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader
        title={t('settings.team')}
        action={role === 'owner' && (
          <Button
            variant="contained"
            startIcon={<PersonAddOutlinedIcon />}
            onClick={() => setInviteOpen(true)}
            data-testid="team-invite-btn"
          >
            {t('settings.inviteAdmin')}
          </Button>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Members list (login owner/admin) */}
      <Card sx={{ mb: 3 }}>
        {loading
          ? <LoadingState />
          : teamMembers.map((m, i) => (
            <Box key={m.id}>
              {i > 0 && <Divider />}
              <Box data-testid="member-row" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2 }}>
                <Avatar src={m.avatar_url ?? undefined} sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}>
                  {(m.display_name?.trim() || m.user_id || '?').slice(0, 2).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {m.display_name?.trim()
                      || (m.user_id === user?.id ? t('settings.you') : t('settings.userLabel', { id: (m.user_id ?? '').slice(-4) }))}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {[m.title?.trim(), m.joined_at ? t('settings.joined', { date: new Date(m.joined_at).toLocaleDateString(i18n.language) }) : null]
                      .filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                {m.is_bookable && (
                  <Chip label={t('settings.bookable')} size="small" color="success" variant="outlined" />
                )}
                <Chip
                  label={m.role === 'owner' ? t('settings.owner') : t('settings.admin')}
                  size="small"
                  color={m.role === 'owner' ? 'primary' : 'default'}
                  variant={m.role === 'owner' ? 'filled' : 'outlined'}
                />
                <ActionIconButton aria-label={t('settings.editMember')} data-testid="member-edit" onClick={() => openEdit(m)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                {role === 'owner' && m.role !== 'owner' && m.user_id !== user?.id && (
                  <ActionIconButton tone="danger" aria-label={t('settings.removeAdmin')} data-testid="member-delete" onClick={() => handleRemove(m.id)}>
                    <DeleteOutlinedIcon fontSize="small" />
                  </ActionIconButton>
                )}
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Professionals — bookable staff profiles without a login account */}
      {!loading && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {t('settings.professionals')}
            </Typography>
            {role === 'owner' && (
              <Button
                size="small"
                startIcon={<PersonAddOutlinedIcon />}
                onClick={openAdd}
                data-testid="add-professional-btn"
              >
                {t('settings.addProfessional')}
              </Button>
            )}
          </Box>
          <Card sx={{ mb: 3 }}>
            {professionals.length === 0
              ? (
                <Box sx={{ px: 2.5, py: 3, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t('settings.noProfessionals')}
                  </Typography>
                </Box>
              )
              : professionals.map((m, i) => (
                <Box key={m.id}>
                  {i > 0 && <Divider />}
                  <Box data-testid="professional-row" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2 }}>
                    <Avatar src={m.avatar_url ?? undefined} sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}>
                      {(m.display_name?.trim() || '?').slice(0, 2).toUpperCase()}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.display_name?.trim() || '—'}</Typography>
                      {m.title?.trim() && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{m.title.trim()}</Typography>
                      )}
                    </Box>
                    {m.is_bookable
                      ? <Chip label={t('settings.bookable')} size="small" color="success" variant="outlined" />
                      : <Chip label={t('settings.hidden')} size="small" variant="outlined" />}
                    <ActionIconButton aria-label={t('settings.editMember')} data-testid="professional-edit" onClick={() => openEdit(m)}>
                      <EditOutlinedIcon fontSize="small" />
                    </ActionIconButton>
                    {role === 'owner' && (
                      <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="professional-delete" onClick={() => handleRemove(m.id)}>
                        <DeleteOutlinedIcon fontSize="small" />
                      </ActionIconButton>
                    )}
                  </Box>
                </Box>
              ))
            }
          </Card>
        </>
      )}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5, color: 'text.secondary' }}>
            {t('settings.pendingInvites')}
          </Typography>
          <Card>
            {invitations.map((inv, i) => (
              <Box key={inv.id}>
                {i > 0 && <Divider />}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{inv.email ?? inv.phone_number}</Typography>
                    {inv.expires_at && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('settings.expires', { date: new Date(inv.expires_at).toLocaleDateString(i18n.language) })}
                      </Typography>
                    )}
                  </Box>
                  <Chip label={t('dashboard.pending')} size="small" color="warning" variant="outlined" data-testid="invite-row" />
                  <ActionIconButton tone="danger" aria-label={t('common.cancel')} data-testid="invite-cancel" onClick={() => cancelInvite(inv.id)}>
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
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.inviteAdmin')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('settings.inviteHelp')}
            </Typography>
            <TextField
              required
              label={t('common.email')}
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              fullWidth
              placeholder="admin@example.com"
              error={inviteEmailInvalid}
              helperText={inviteEmailInvalid ? t('validation.invalidEmail') : ' '}
              slotProps={{ htmlInput: { inputMode: 'email' as const, maxLength: FIELD_LIMITS.email, 'data-testid': 'invite-email' } }}
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleInvite}
            disabled={inviting || !isValidEmail(inviteEmail)}
            data-testid="invite-send"
          >
            {inviting ? <CircularProgress size={20} color="inherit" /> : t('common.send')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit member dialog */}
      <Dialog open={!!editMember} onClose={() => setEditMember(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.editMember')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <PhotoPicker
                src={editMember?.avatar_url ?? null}
                initials={(editName.trim() || '?').slice(0, 2).toUpperCase()}
                uploading={uploadingPhoto}
                onPick={handleEditPhoto}
              />
            </Box>
            <TextField
              label={t('settings.displayName')}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              fullWidth
              autoFocus
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'member-name' } }}
            />
            <TextField
              label={t('settings.staffTitle')}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.title, 'data-testid': 'member-title' } }}
            />
            <FormControlLabel
              control={<Switch checked={editBookable} onChange={e => setEditBookable(e.target.checked)} data-testid="member-bookable" />}
              label={t('settings.bookable')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditMember(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={saveMember} disabled={savingMember} data-testid="member-save">
            {savingMember ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add-professional dialog (account-less staff profile) */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.addProfessional')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('settings.addProfessionalHelp')}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <PhotoPicker
                src={addPhotoPreview}
                initials={(addName.trim() || '?').slice(0, 2).toUpperCase()}
                uploading={false}
                onPick={pickAddPhoto}
              />
            </Box>
            <TextField
              label={t('settings.displayName')}
              value={addName}
              onChange={e => setAddName(e.target.value)}
              fullWidth
              autoFocus
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'professional-name' } }}
            />
            <TextField
              label={t('settings.staffTitle')}
              value={addTitle}
              onChange={e => setAddTitle(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.title, 'data-testid': 'professional-title' } }}
            />
            <FormControlLabel
              control={<Switch checked={addBookable} onChange={e => setAddBookable(e.target.checked)} data-testid="professional-bookable" />}
              label={t('settings.bookable')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleAddProfessional}
            disabled={adding || addName.trim().length < 2}
            data-testid="professional-save"
          >
            {adding ? <CircularProgress size={20} color="inherit" /> : t('common.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
