import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack,
  Switch, FormControlLabel, Divider, Alert,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import DesignServicesOutlinedIcon from '@mui/icons-material/DesignServicesOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'

type LocationType = 'in_person' | 'online'

interface Service {
  id: string
  name: string
  duration_minutes: number
  price: number
  is_active: boolean
  sort_order: number
  max_per_slot: number
  location_type: LocationType
  meeting_link: string | null
}

interface BookableMember {
  id: string
  display_name: string | null
  title: string | null
}

// Numeric fields are held as strings while editing so the inputs can be
// cleared/partially typed; they're coerced with Number() on save.
interface ServiceForm {
  name: string
  duration_minutes: string
  price: string
  is_active: boolean
  max_per_slot: string
  location_type: LocationType
  meeting_link: string
}

const EMPTY: ServiceForm = {
  name: '',
  duration_minutes: '60',
  price: '0',
  is_active: true,
  max_per_slot: '1',
  location_type: 'in_person',
  meeting_link: '',
}

// An appointment may last at most 24 hours. Mirrors the DB constraint
// services_duration_max (migration 009) and the book-appointment guard.
const MAX_DURATION_MINUTES = 1440

// Turn a raw Supabase/Postgres error into a human-readable, translated
// message instead of leaking DB internals (e.g. "out of range for type
// smallint"). `tr` is the i18n t() function.
function friendlyError(message: string | undefined, tr: (k: string) => string): string {
  const msg = (message ?? '').toLowerCase()
  if (msg.includes('out of range') || msg.includes('overflow')) return tr('validation.numberTooLarge')
  if (msg.includes('services_duration_max') || msg.includes('duration_range')) return tr('validation.durationTooLong')
  return tr('validation.saveFailed')
}

// Allow only digits (integer fields) or digits with a single decimal point
// (price). Returns the cleaned string so the field can stay empty mid-edit.
const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function ServicesSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [services, setServices] = useState<Service[]>([])
  const [bookableMembers, setBookableMembers] = useState<BookableMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)
    const [svcRes, memRes] = await Promise.all([
      supabase.from('services').select('*').eq('org_id', org.id).order('sort_order'),
      supabase
        .from('org_members')
        .select('id, display_name, title')
        .eq('org_id', org.id)
        .eq('is_bookable', true)
        .order('sort_order'),
    ])
    setServices((svcRes.data ?? []) as Service[])
    setBookableMembers((memRes.data ?? []) as BookableMember[])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setSelectedMemberIds([])
    setOpen(true)
  }

  async function openEdit(s: Service) {
    setEditing(s)
    setForm({
      name: s.name,
      duration_minutes: String(s.duration_minutes),
      price: String(s.price),
      is_active: s.is_active,
      max_per_slot: String(s.max_per_slot),
      location_type: s.location_type,
      meeting_link: s.meeting_link ?? '',
    })
    const { data } = await supabase.from('service_staff').select('member_id').eq('service_id', s.id)
    setSelectedMemberIds((data ?? []).map(r => (r as { member_id: string }).member_id))
    setOpen(true)
  }

  function toggleMember(id: string) {
    setSelectedMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Reconcile the service_staff rows for a service with the selected member ids.
  async function syncStaff(serviceId: string) {
    if (!org) return
    const { data } = await supabase.from('service_staff').select('id, member_id').eq('service_id', serviceId)
    const existing = (data ?? []) as { id: string; member_id: string }[]
    const existingIds = new Set(existing.map(e => e.member_id))
    const selected = new Set(selectedMemberIds)

    const toAdd = selectedMemberIds.filter(id => !existingIds.has(id))
    const toRemoveIds = existing.filter(e => !selected.has(e.member_id)).map(e => e.id)

    if (toAdd.length) {
      await supabase.from('service_staff').insert(
        toAdd.map(member_id => ({ org_id: org.id, service_id: serviceId, member_id })),
      )
    }
    if (toRemoveIds.length) {
      await supabase.from('service_staff').delete().in('id', toRemoveIds)
    }
  }

  const durationTooLong = Number(form.duration_minutes) > MAX_DURATION_MINUTES

  async function handleSave() {
    if (!org || !form.name.trim()) return
    if (durationTooLong) { setError(t('validation.durationTooLong')); return }
    setSaving(true)
    setError(null)

    // A meeting link only applies to online services. The DB enforces this
    // too (services_meeting_link_online_only), so drop it for in_person.
    const meetingLink = form.location_type === 'online'
      ? (form.meeting_link.trim() || null)
      : null

    let serviceId: string
    if (editing) {
      const { error: err } = await supabase
        .from('services')
        .update({
          name: form.name.trim(),
          duration_minutes: Number(form.duration_minutes),
          price: Number(form.price),
          is_active: form.is_active,
          max_per_slot: Number(form.max_per_slot),
          location_type: form.location_type,
          meeting_link: meetingLink,
        })
        .eq('id', editing.id)
      if (err) { setError(friendlyError(err.message, t)); setSaving(false); return }
      serviceId = editing.id
    } else {
      const maxOrder = services.reduce((m, s) => Math.max(m, s.sort_order), -1)
      const { data, error: err } = await supabase
        .from('services')
        .insert({
          org_id: org.id,
          name: form.name.trim(),
          duration_minutes: Number(form.duration_minutes),
          price: Number(form.price),
          is_active: form.is_active,
          max_per_slot: Number(form.max_per_slot),
          location_type: form.location_type,
          meeting_link: meetingLink,
          sort_order: maxOrder + 1,
        })
        .select('id')
        .single()
      if (err || !data) { setError(friendlyError(err?.message, t)); setSaving(false); return }
      serviceId = data.id
    }

    await syncStaff(serviceId)

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
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader
        title={t('settings.services')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="service-add">
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
                data-testid="service-row"
                sx={{
                  px: 2.5, py: 2,
                  display: 'flex', alignItems: 'center', gap: 2,
                  opacity: s.is_active ? 1 : 0.55,
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                    {s.location_type === 'online' && (
                      <Chip label={t('settings.locationOnline')} size="small" color="primary" variant="outlined" />
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {s.duration_minutes} წთ · {s.price} ₾
                  </Typography>
                </Box>
                <Switch
                  checked={s.is_active}
                  onChange={() => toggleActive(s)}
                  data-testid="service-active-toggle"
                />
                <ActionIconButton aria-label={t('common.edit')} data-testid="service-edit" onClick={() => openEdit(s)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="service-delete" onClick={() => setConfirmDelete(s)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
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
              slotProps={{ htmlInput: { 'data-testid': 'service-name' } }}
            />
            <TextField
              label={t('onboarding.duration')}
              value={form.duration_minutes}
              onChange={e => setForm(f => ({ ...f, duration_minutes: onlyInt(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'service-duration' } }}
              error={durationTooLong}
              helperText={durationTooLong ? t('validation.durationTooLong') : undefined}
            />
            <TextField
              label={t('onboarding.price')}
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: onlyDecimal(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'service-price' } }}
            />
            <TextField
              label={t('settings.maxPerSlot')}
              value={form.max_per_slot}
              onChange={e => setForm(f => ({ ...f, max_per_slot: onlyInt(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'service-max-per-slot' } }}
            />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('settings.location')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={form.location_type}
                onChange={(_, v: LocationType | null) => {
                  if (v) setForm(f => ({ ...f, location_type: v }))
                }}
              >
                <ToggleButton value="in_person">{t('settings.locationInPerson')}</ToggleButton>
                <ToggleButton value="online">{t('settings.locationOnline')}</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            {form.location_type === 'online' && (
              <TextField
                label={t('settings.meetingLink')}
                value={form.meeting_link}
                onChange={e => setForm(f => ({ ...f, meeting_link: e.target.value }))}
                fullWidth
                placeholder="https://"
                helperText={t('settings.meetingLinkHelp')}
                slotProps={{ htmlInput: { inputMode: 'url' } }}
              />
            )}
            {bookableMembers.length > 0 && (
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t('settings.assignStaff')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {bookableMembers.map(m => {
                    const sel = selectedMemberIds.includes(m.id)
                    return (
                      <Chip
                        key={m.id}
                        label={m.display_name || '—'}
                        data-testid="service-staff-chip"
                        onClick={() => toggleMember(m.id)}
                        color={sel ? 'primary' : 'default'}
                        variant={sel ? 'filled' : 'outlined'}
                      />
                    )
                  })}
                </Box>
              </Box>
            )}
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
            data-testid="service-save"
            disabled={
              saving ||
              !form.name.trim() ||
              !(Number(form.duration_minutes) > 0) ||
              durationTooLong ||
              !(Number(form.max_per_slot) >= 1)
            }
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
