import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack,
  IconButton, Switch, FormControlLabel, Divider, Alert,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DesignServicesOutlinedIcon from '@mui/icons-material/DesignServicesOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, useToast } from '@/components/ui'

interface Service {
  id: string
  name: string
  duration_minutes: number
  price: number
  is_active: boolean
  sort_order: number
}

const EMPTY: Omit<Service, 'id' | 'sort_order'> = {
  name: '',
  duration_minutes: 60,
  price: 0,
  is_active: true,
}

export default function ServicesSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)
    const { data } = await supabase
      .from('services')
      .select('*')
      .eq('org_id', org.id)
      .order('sort_order')
    setServices((data ?? []) as Service[])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  function openEdit(s: Service) {
    setEditing(s)
    setForm({ name: s.name, duration_minutes: s.duration_minutes, price: s.price, is_active: s.is_active })
    setOpen(true)
  }

  async function handleSave() {
    if (!org || !form.name.trim()) return
    setSaving(true)
    setError(null)

    if (editing) {
      const { error: err } = await supabase
        .from('services')
        .update({
          name: form.name.trim(),
          duration_minutes: Number(form.duration_minutes),
          price: Number(form.price),
          is_active: form.is_active,
        })
        .eq('id', editing.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const maxOrder = services.reduce((m, s) => Math.max(m, s.sort_order), -1)
      const { error: err } = await supabase
        .from('services')
        .insert({
          org_id: org.id,
          name: form.name.trim(),
          duration_minutes: Number(form.duration_minutes),
          price: Number(form.price),
          is_active: form.is_active,
          sort_order: maxOrder + 1,
        })
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    setOpen(false)
    toast.success(t('common.saved'))
    load()
  }

  async function handleDelete(s: Service) {
    setDeleting(true)
    await supabase.from('services').delete().eq('id', s.id)
    setDeleting(false)
    setConfirmDelete(null)
    toast.success(t('common.deleted'))
    load()
  }

  async function toggleActive(s: Service) {
    await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id)
    setServices(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <Box sx={{ maxWidth: 680 }}>
      <PageHeader
        title={t('settings.services')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            {t('onboarding.addService')}
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        {loading
          ? <LoadingState />
          : services.length === 0
          ? (
            <EmptyState
              icon={<DesignServicesOutlinedIcon />}
              title="სერვისები არ არის"
              caption="დაამატეთ პირველი სერვისი"
            />
          )
          : services.map((s, i) => (
            <Box key={s.id}>
              {i > 0 && <Divider />}
              <Box
                sx={{
                  px: 2.5, py: 2,
                  display: 'flex', alignItems: 'center', gap: 2,
                  opacity: s.is_active ? 1 : 0.55,
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {s.duration_minutes} წთ · {s.price} ₾
                  </Typography>
                </Box>
                <Switch
                  checked={s.is_active}
                  onChange={() => toggleActive(s)}
                  size="small"
                />
                <IconButton size="small" onClick={() => openEdit(s)}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => setConfirmDelete(s)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editing ? 'სერვისის რედაქტირება' : 'ახალი სერვისი'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('onboarding.serviceName')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              fullWidth
              required
              autoFocus
            />
            <TextField
              label={t('onboarding.duration')}
              type="number"
              value={form.duration_minutes}
              onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { min: 5, step: 5 } }}
            />
            <TextField
              label={t('onboarding.price')}
              type="number"
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: Number(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                />
              }
              label="სერვისი აქტიურია"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
          >
            {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="სერვისის წაშლა"
        message={confirmDelete ? `დარწმუნებული ხართ, რომ გსურთ წაშალოთ "${confirmDelete.name}"? ეს მოქმედება შეუქცევადია.` : undefined}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </Box>
  )
}
