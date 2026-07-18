import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tierInfo } from '@/lib/tiers'
import {
  Box, Typography, Card, Button, TextField, Avatar,
  Stack, Divider, Alert, CircularProgress, Chip,
  Switch, FormControlLabel,
} from '@mui/material'
import { PersonAddOutlined as PersonAddOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { PhotoCameraOutlined as PhotoCameraOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, formatGeorgianPhone, imageFileError, FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, LoadingState, ActionIconButton, useToast, SideDrawer } from '@/components/ui'
import { surface } from '@/theme/theme'

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

const MEMBER_PHOTO_BUCKET = 'member-photos'

// Extract the storage object path ("<org>/<member>.<ext>") from a stored
// avatar_url so we can delete it via the Storage API. Returns null for external
// or malformed URLs.
function memberPhotoPath(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null
  const marker = `/${MEMBER_PHOTO_BUCKET}/`
  const at = avatarUrl.indexOf(marker)
  if (at === -1) return null
  return avatarUrl.slice(at + marker.length).split('?')[0] || null
}


export default function TeamSettings() {
  const { t, i18n } = useTranslation()
  const { org, role } = useOrg()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitePhone, setInvitePhone] = useState('')
  // Set on the first Invite attempt: flags the empty phone inline too.
  const [inviteSubmitted, setInviteSubmitted] = useState(false)
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
  // Set on the first Add attempt of the open dialog: flags the empty name inline.
  const [addSubmitted, setAddSubmitted] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addBookable, setAddBookable] = useState(true)
  const [addPhotoFile, setAddPhotoFile] = useState<File | null>(null)
  const [addPhotoPreview, setAddPhotoPreview] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // Login members (owner/admin) vs. account-less professionals (role='staff').
  const teamMembers = members.filter(m => m.role !== 'staff')
  const professionals = members.filter(m => m.role === 'staff')

  // The DB trigger (enforce_staff_limit) rejects making one more member
  // bookable than the tier allows — turn that into an upgrade prompt instead
  // of a raw Postgres error.
  const staffLimitHit = error === t('settings.staffLimitReached', { limit: tierInfo(org?.subscription_tier).staffLimit })
  function memberErrorMessage(raw: string): string {
    return raw.includes('staff_limit_reached')
      ? t('settings.staffLimitReached', { limit: tierInfo(org?.subscription_tier).staffLimit })
      : raw
  }

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
    const { error: upErr } = await supabase.storage.from(MEMBER_PHOTO_BUCKET).upload(path, file, { upsert: true })
    if (upErr) { toast.error(upErr.message); return null }
    const { data } = supabase.storage.from(MEMBER_PHOTO_BUCKET).getPublicUrl(path)
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
    setAddSubmitted(false)
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
    if (!org) return
    // Flag the name inline and pull it into view instead of toasting.
    setAddSubmitted(true)
    if (addName.trim().length < 2) {
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDialog-root') ?? document)
      return
    }
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
    if (err || !data) { setAdding(false); setAddOpen(false); setError(memberErrorMessage(err?.message ?? 'insert_failed')); return }

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
    if (!org) return
    // Flag the phone inline and pull it into view instead of toasting.
    setInviteSubmitted(true)
    if (!isValidGeorgianPhone(invitePhone)) {
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDialog-root') ?? document)
      return
    }
    setInviting(true)
    setError(null)

    // Store the national 9-digit form so it matches the caller's phone claim
    // (see accept_invitation / invitations_invitee_select in migration 063).
    const phone = formatGeorgianPhone(invitePhone)
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
    toast.success(t('settings.inviteSent', { phone }))
    load()
  }

  async function handleRemove(memberId: string) {
    const avatarUrl = members.find(m => m.id === memberId)?.avatar_url ?? null
    await supabase.from('org_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
    // Best-effort cleanup of the member's photo so it isn't orphaned in the
    // bucket. storage.protect_delete blocks SQL deletes, so this must go through
    // the Storage API; a failure here is non-fatal (the row is already gone).
    const path = memberPhotoPath(avatarUrl)
    if (path) await supabase.storage.from(MEMBER_PHOTO_BUCKET).remove([path])
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
    if (err) { setEditMember(null); setError(memberErrorMessage(err.message)); return }
    setMembers(prev => prev.map(m => m.id === editMember.id ? { ...m, ...patch } : m))
    setEditMember(null)
    toast.success(t('common.saved'))
  }

  const invitePhoneInvalid = (inviteSubmitted || invitePhone.trim().length > 0) && !isValidGeorgianPhone(invitePhone)
  const addNameTooShort = (addSubmitted || addName.trim().length > 0) && addName.trim().length < 2

  return (
    <Box>
      <PageHeader
        title={t('settings.team')}
        action={role === 'owner' && (
          <Button
            variant="contained"
            startIcon={<PersonAddOutlinedIcon />}
            onClick={() => { setInviteSubmitted(false); setInviteOpen(true) }}
            data-testid="team-invite-btn"
          >
            {t('settings.inviteAdmin')}
          </Button>
        )}
      />

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          data-testid="team-error"
          action={staffLimitHit ? (
            <Button color="inherit" size="small" sx={{ fontWeight: 700 }} onClick={() => navigate('/dashboard/settings/subscription')}>
              {t('subscription.upgrade')}
            </Button>
          ) : undefined}
        >
          {error}
        </Alert>
      )}

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
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{inv.phone_number ?? inv.email}</Typography>
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

      {/* Invite drawer */}
      <SideDrawer
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        disableClose={inviting}
        title={t('settings.inviteAdmin')}
        actions={
          <>
            <Button onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={handleInvite} disabled={inviting} data-testid="invite-send">
              {inviting ? <CircularProgress size={20} color="inherit" /> : t('common.send')}
            </Button>
          </>
        }
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('settings.inviteHelp')}
            </Typography>
            <TextField
              required
              label={t('settings.phone')}
              value={invitePhone}
              onChange={e => setInvitePhone(e.target.value)}
              fullWidth
              placeholder="555 123 456"
              error={invitePhoneInvalid}
              helperText={invitePhoneInvalid ? t('validation.invalidPhone') : ' '}
              slotProps={{ htmlInput: { inputMode: 'tel' as const, 'data-testid': 'invite-phone' } }}
              autoFocus
            />
        </Stack>
      </SideDrawer>

      {/* Edit member drawer */}
      <SideDrawer
        open={!!editMember}
        onClose={() => setEditMember(null)}
        disableClose={savingMember}
        title={t('settings.editMember')}
        actions={
          <>
            <Button onClick={() => setEditMember(null)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={saveMember} disabled={savingMember} data-testid="member-save">
              {savingMember ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </>
        }
      >
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
      </SideDrawer>

      {/* Add-professional drawer (account-less staff profile) */}
      <SideDrawer
        open={addOpen}
        onClose={() => setAddOpen(false)}
        disableClose={adding}
        title={t('settings.addProfessional')}
        actions={
          <>
            <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={handleAddProfessional} disabled={adding} data-testid="professional-save">
              {adding ? <CircularProgress size={20} color="inherit" /> : t('common.add')}
            </Button>
          </>
        }
      >
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
              error={addNameTooShort}
              helperText={addNameTooShort ? t('validation.minLength', { min: 2 }) : undefined}
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
      </SideDrawer>
    </Box>
  )
}
