import { useEffect, useState, useRef } from 'react'
import {
  Box, Typography, Card, CardContent, TextField, Button,
  Avatar, CircularProgress, Alert, Stack, Divider, Link,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Checkbox, FormControlLabel,
} from '@mui/material'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { isValidGeorgianPhone, formatGeorgianPhone, imageFileError, FIELD_LIMITS } from '@/lib/validation'
import { PageHeader, CopyableText, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import {
  BOOKING_THEME_LIST, DEFAULT_BOOKING_THEME, getBookingTheme, type BookingThemeKey,
} from '@/theme/bookingThemes'

export default function ProfileSettings() {
  const { t } = useTranslation()
  const { org, refresh } = useOrg()
  const toast = useToast()
  const navigate = useNavigate()

  // Account deletion (danger zone)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [soleMember, setSoleMember] = useState(false)
  const [deleteOrgToo, setDeleteOrgToo] = useState(true)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [bookingTheme, setBookingTheme] = useState<BookingThemeKey>(DEFAULT_BOOKING_THEME)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (org) {
      setName(org.name ?? '')
      setDescription((org as unknown as Record<string, string>).description ?? '')
      setContactPhone((org as unknown as Record<string, string>).contact_phone ?? '')
      setLogoUrl((org as unknown as Record<string, string>).logo_url ?? null)
      // Resolve any stored key (incl. the retired 'classic') to a current theme.
      setBookingTheme(getBookingTheme(org.booking_theme).key)
    }
  }, [org])

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !org) return
    // Reject non-images / oversized files before hitting storage.
    const fileErr = imageFileError(file)
    if (fileErr) {
      setError(fileErr === 'fileTooLarge' ? t('validation.fileTooLarge', { max: 2 }) : t('validation.invalidImage'))
      e.target.value = ''
      return
    }
    setUploading(true)
    setError(null)

    const ext = file.name.split('.').pop()
    const path = `${org.id}/logo.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('logos')
      .upload(path, file, { upsert: true })

    if (uploadErr) {
      setError(uploadErr.message)
      setUploading(false)
      return
    }

    // The storage path is stable (<org>/logo.<ext>), so getPublicUrl always
    // returns the same URL. Without a version param, the browser and Supabase's
    // CDN keep serving the previously cached image after a replace (and a
    // negatively-cached miss can hide the logo for fresh/incognito visitors).
    // Append a cache-busting version so every upload yields a unique URL.
    const { data } = supabase.storage.from('logos').getPublicUrl(path)
    const url = `${data.publicUrl}?v=${Date.now()}`

    await supabase.from('organisations').update({ logo_url: url }).eq('id', org.id)
    setLogoUrl(url)
    await refresh()
    setUploading(false)
  }

  // Business name is required; contact phone is mandatory.
  const nameTooShort = name.trim().length > 0 && name.trim().length < 2
  const phoneMissing = contactPhone.trim().length === 0
  const phoneInvalid = !phoneMissing && !isValidGeorgianPhone(contactPhone)

  async function handleSave() {
    if (!org) return
    if (name.trim().length < 2) { setError(t('validation.minLength', { min: 2 })); return }
    if (phoneMissing) { setError(t('validation.required')); return }
    if (phoneInvalid) { setError(t('validation.invalidPhone')); return }
    setSaving(true)
    setError(null)

    const { error: err } = await supabase
      .from('organisations')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        contact_phone: formatGeorgianPhone(contactPhone),
        booking_theme: bookingTheme,
      })
      .eq('id', org.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    await refresh()
    toast.success(t('common.saved'))
  }

  // Open the delete dialog, first checking whether the user is the only member
  // of the org (which surfaces the "delete the organisation too" choice).
  async function openDeleteDialog() {
    if (!org) return
    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)
    const sole = (count ?? 0) <= 1
    setSoleMember(sole)
    setDeleteOrgToo(sole) // default to removing the org when no one else is left
    setDeleteConfirmText('')
    setDeleteOpen(true)
  }

  async function handleDeleteAccount() {
    if (!org) return
    setDeleting(true)
    const { error: err } = await supabase.functions.invoke('delete-account', {
      body: { orgId: org.id, deleteOrg: soleMember && deleteOrgToo },
    })
    if (err) {
      setDeleting(false)
      setDeleteOpen(false)
      toast.error(t('settings.deleteAccountFailed'))
      return
    }
    await supabase.auth.signOut()
    toast.success(t('settings.accountDeleted'))
    navigate('/login')
  }

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader title={t('settings.profile')} />

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="profile-error">{error}</Alert>}

      <Card>
        <CardContent sx={{ p: 3 }}>
          {/* Public booking link — surfaced at the top as the most shareable item */}
          {org?.slug && (
            <>
              <CopyableText
                label={t('settings.yourBookingLink')}
                text={`grafiki.ge/book/${org.slug}`}
                value={`https://grafiki.ge/book/${org.slug}`}
              />
              <Divider sx={{ my: 3 }} />
            </>
          )}

          {/* Logo upload */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 3 }}>
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={logoUrl ?? undefined}
                sx={{ width: 80, height: 80, bgcolor: 'primary.main', fontSize: 28 }}
              >
                {name.charAt(0).toUpperCase()}
              </Avatar>
              <Box
                onClick={() => fileRef.current?.click()}
                sx={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: 26, height: 26, borderRadius: '50%',
                  bgcolor: 'background.paper',
                  border: '2px solid',
                  borderColor: 'divider',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {uploading
                  ? <CircularProgress size={12} />
                  : <PhotoCameraOutlinedIcon sx={{ fontSize: 14 }} />
                }
              </Box>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleLogoUpload}
              />
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('settings.logo')}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('settings.logoHint')}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          <Stack spacing={2.5}>
            <TextField
              label={t('settings.businessName')}
              value={name}
              onChange={e => setName(e.target.value)}
              fullWidth
              required
              error={nameTooShort}
              helperText={nameTooShort ? t('validation.minLength', { min: 2 }) : undefined}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.orgName, 'data-testid': 'profile-name' } }}
            />
            <TextField
              label={t('settings.description')}
              value={description}
              onChange={e => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.description, 'data-testid': 'profile-description' } }}
            />
            <TextField
              label={t('settings.contactPhone')}
              value={contactPhone}
              onChange={e => setContactPhone(e.target.value)}
              fullWidth
              required
              placeholder="599 123 456"
              error={phoneInvalid}
              helperText={phoneInvalid ? t('validation.invalidPhone') : undefined}
              slotProps={{ htmlInput: { inputMode: 'tel', maxLength: 20, 'data-testid': 'profile-phone' } }}
            />
            {/* Booking page colour theme — what customers see when booking. */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t('settings.bookingPageColor')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('settings.bookingPageColorHelp')}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
                {BOOKING_THEME_LIST.map(th => {
                  const selected = th.key === bookingTheme
                  return (
                    <Box
                      key={th.key}
                      onClick={() => setBookingTheme(th.key)}
                      role="button"
                      aria-pressed={selected}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1,
                        px: 1.5, py: 1, borderRadius: 2, cursor: 'pointer',
                        border: '2px solid',
                        borderColor: selected ? 'primary.main' : 'divider',
                        bgcolor: selected ? 'action.hover' : 'transparent',
                        transition: 'border-color 0.15s ease, background-color 0.15s ease',
                        '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled' },
                      }}
                    >
                      <Box
                        sx={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: th.swatch ?? th.primary,
                          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2" sx={{ fontWeight: selected ? 600 : 500 }}>
                        {th.label}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </Box>

          </Stack>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || uploading || name.trim().length < 2 || phoneMissing || phoneInvalid}
              data-testid="profile-save"
            >
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </Box>

          {/* Danger zone — kept deliberately quiet: a plain text link below a divider. */}
          <Divider sx={{ mt: 4 }} />
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
            <Link
              component="button"
              type="button"
              onClick={openDeleteDialog}
              data-testid="delete-account-btn"
              underline="hover"
              sx={{ color: 'error.main', fontSize: 14, fontWeight: 500 }}
            >
              {t('settings.deleteAccount')}
            </Link>
          </Box>
        </CardContent>
      </Card>

      {/* Delete account confirmation */}
      <Dialog open={deleteOpen} onClose={deleting ? undefined : () => setDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.deleteAccountTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: 'text.secondary' }}>
            {t('settings.deleteAccountMessage')}
          </DialogContentText>
          {soleMember ? (
            <FormControlLabel
              sx={{ mt: 2 }}
              control={
                <Checkbox
                  checked={deleteOrgToo}
                  onChange={e => setDeleteOrgToo(e.target.checked)}
                  data-testid="delete-org-too"
                />
              }
              label={t('settings.deleteOrgToo', { name: org?.name ?? '' })}
            />
          ) : (
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
              {t('settings.deleteAccountKeepOrg')}
            </Typography>
          )}

          {/* Require the user to type the confirmation word — a deliberate
              friction step for an irreversible action. */}
          <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
            {t('settings.deleteConfirmPrompt', { word: t('settings.deleteConfirmWord') })}
          </Typography>
          <TextField
            fullWidth
            size="small"
            autoComplete="off"
            sx={{ mt: 1 }}
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            placeholder={t('settings.deleteConfirmWord')}
            disabled={deleting}
            slotProps={{ htmlInput: { 'data-testid': 'delete-confirm-input' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDeleteAccount}
            disabled={
              deleting ||
              deleteConfirmText.trim().toLowerCase() !== t('settings.deleteConfirmWord').toLowerCase()
            }
            variant="contained"
            color="error"
            data-testid="delete-account-confirm"
          >
            {deleting ? <CircularProgress size={20} color="inherit" /> : t('settings.deleteAccount')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
