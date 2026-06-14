import { useEffect, useState, useRef } from 'react'
import {
  Box, Typography, Card, CardContent, TextField, Button,
  Avatar, CircularProgress, Alert, Stack, Divider,
} from '@mui/material'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'

export default function ProfileSettings() {
  const { t } = useTranslation()
  const { org, refresh } = useOrg()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (org) {
      setName(org.name ?? '')
      setDescription((org as Record<string, string>).description ?? '')
      setContactPhone((org as Record<string, string>).contact_phone ?? '')
      setLogoUrl((org as Record<string, string>).logo_url ?? null)
    }
  }, [org])

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !org) return
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

  async function handleSave() {
    if (!org) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const { error: err } = await supabase
      .from('organisations')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        contact_phone: contactPhone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', org.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    setSuccess(true)
    await refresh()
    setTimeout(() => setSuccess(false), 3000)
  }

  return (
    <Box sx={{ maxWidth: 600 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        {t('settings.profile')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>ინფორმაცია შენახულია</Alert>}

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
            />
            <TextField
              label="აღწერა"
              value={description}
              onChange={e => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
            <TextField
              label="საკონტაქტო ტელეფონი"
              value={contactPhone}
              onChange={e => setContactPhone(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'tel' } }}
            />
            <Box sx={{ pt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                თქვენი ბუქინგ ბმული: grafiki.ge/book/{org?.slug}
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving || !name.trim()}
            >
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
