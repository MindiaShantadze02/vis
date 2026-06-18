import { useEffect, useState, useRef } from 'react'
import {
  Box, Typography, Card, CardContent, TextField, Button,
  Avatar, CircularProgress, Alert, Stack, Divider,
} from '@mui/material'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
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

    const { data } = supabase.storage.from('logos').getPublicUrl(path)
    const url = data.publicUrl

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

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader title={t('settings.profile')} />

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
              <Typography variant="body2" sx={{ fontWeight: 600 }}>ლოგო</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                PNG, JPG, GIF · მაქს. 2MB
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          <Stack spacing={2.5}>
            <TextField
              label="ბიზნესის სახელი"
              value={name}
              onChange={e => setName(e.target.value)}
              fullWidth
              required
              error={nameTooShort}
              helperText={nameTooShort ? t('validation.minLength', { min: 2 }) : undefined}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.orgName, 'data-testid': 'profile-name' } }}
            />
            <TextField
              label="აღწერა"
              value={description}
              onChange={e => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.description, 'data-testid': 'profile-description' } }}
            />
            <TextField
              label="საკონტაქტო ტელეფონი"
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
                ჯავშნის გვერდის ფერი
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                ფერი, რომელსაც კლიენტები ხედავენ ჯავშნისას
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
                          background: th.primary,
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

            {org?.slug && (
              <CopyableText
                label="თქვენი ბუქინგ ბმული"
                text={`grafiki.ge/book/${org.slug}`}
                value={`https://grafiki.ge/book/${org.slug}`}
              />
            )}
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
        </CardContent>
      </Card>
    </Box>
  )
}
