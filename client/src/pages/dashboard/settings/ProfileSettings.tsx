import { useEffect, useState, useRef } from 'react'
import {
  Box, Typography, Card, CardContent, TextField, Button,
  Avatar, CircularProgress, Alert, Stack, Divider,
} from '@mui/material'
import { PhotoCameraOutlined as PhotoCameraOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { isValidGeorgianPhone, formatGeorgianPhone, imageFileError, FIELD_LIMITS } from '@/lib/validation'
import { PageHeader, useToast } from '@/components/ui'
import { surface } from '@/theme/theme'

/**
 * Business identity settings: logo, name, description, contact phone. Anything
 * about the public booking page (theme, reviews, link) lives on the Booking-page
 * settings; account deletion lives on Account settings.
 */
export default function ProfileSettings() {
  const { t } = useTranslation()
  const { org, refresh } = useOrg()
  const toast = useToast()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [address, setAddress] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (org) {
      setName(org.name ?? '')
      setDescription((org as unknown as Record<string, string>).description ?? '')
      setContactPhone((org as unknown as Record<string, string>).contact_phone ?? '')
      setAddress((org as unknown as Record<string, string>).address ?? '')
      setLogoUrl((org as unknown as Record<string, string>).logo_url ?? null)
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
    // returns the same URL. Append a cache-busting version so every upload
    // yields a unique URL (otherwise the CDN keeps serving the old image).
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
        address: address.trim() || null,
      })
      .eq('id', org.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    await refresh()
    toast.success(t('common.saved'))
  }

  return (
    <Box>
      <PageHeader title={t('settings.business')} />

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="profile-error">{error}</Alert>}

      <Card>
        <CardContent sx={{ p: 3 }}>
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
                  '&:hover': { bgcolor: surface.hover },
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
            <TextField
              label={t('settings.address')}
              value={address}
              onChange={e => setAddress(e.target.value)}
              fullWidth
              helperText={t('settings.addressHint')}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.address, 'data-testid': 'profile-address' } }}
            />
          </Stack>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || uploading}
              data-testid="profile-save"
            >
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
