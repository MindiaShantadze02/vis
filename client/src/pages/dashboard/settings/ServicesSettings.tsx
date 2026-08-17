import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack,
  Switch, FormControlLabel, Divider, Alert,
  CircularProgress,
  Chip, ToggleButtonGroup, ToggleButton, Avatar,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { DesignServicesOutlined as DesignServicesOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, SkeletonImage, FormErrorAlert, useToast, SideDrawer } from '@/components/ui'
import { isNonNegativeNumber, isValidServicePrice, MAX_PRICE, MIN_PRICE, FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import ServiceThumbnailPicker from '@/components/ServiceThumbnailPicker'
import {
  uploadServiceImage, removeServiceImageFile, serviceImageFileError,
  isLowResolution, MAX_SERVICE_IMAGE_MB, RECOMMENDED_SERVICE_IMAGE_WIDTH,
} from '@/lib/serviceImages'

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
  // Per-service deposit override; NULL deposit_type inherits the org default.
  deposit_type: 'none' | 'fixed' | 'percent' | null
  deposit_value: number | null
  // Single thumbnail (services.image_url); null when none was uploaded.
  image_url: string | null
}

// UI mode for the deposit control: 'inherit' persists a NULL deposit_type (use
// the org default); the others map straight to deposit_type.
type DepositMode = 'inherit' | 'none' | 'fixed' | 'percent'

interface BookableMember {
  id: string
  display_name: string | null
  title: string | null
  avatar_url: string | null
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
  deposit_mode: DepositMode
  deposit_value: string
}

const EMPTY: ServiceForm = {
  name: '',
  duration_minutes: '60',
  price: String(MIN_PRICE),
  is_active: true,
  max_per_slot: '1',
  location_type: 'in_person',
  deposit_mode: 'inherit',
  deposit_value: '',
}

// The dialog's thumbnail. `saved` = already persisted on the service row (edit
// mode). `file` = staged upload waiting for the new service's id (create mode).
// `url` is what the tile shows: a stored URL or a local blob: preview.
interface ThumbState {
  url: string
  saved?: boolean
  file?: File
}

// An appointment may last at most 24 hours. Mirrors the DB constraint
// services_duration_max (migration 009).
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
  // Set on the first Save attempt of the open dialog: from then on empty
  // required fields are flagged inline too. Reset when the dialog (re)opens.
  const [submitted, setSubmitted] = useState(false)

  // Dialog state
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [thumb, setThumb] = useState<ThumbState | null>(null)
  const [thumbUploading, setThumbUploading] = useState(false)
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
        .select('id, display_name, title, avatar_url')
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
    setThumb(null)
    setError(null)
    setSubmitted(false)
    setOpen(true)
  }

  async function openEdit(s: Service) {
    setEditing(s)
    setError(null)
    setSubmitted(false)
    setForm({
      name: s.name,
      duration_minutes: String(s.duration_minutes),
      price: String(s.price),
      is_active: s.is_active,
      max_per_slot: String(s.max_per_slot),
      location_type: s.location_type,
      // NULL deposit_type = inherit the org default.
      deposit_mode: s.deposit_type == null ? 'inherit' : s.deposit_type,
      deposit_value: s.deposit_value != null ? String(s.deposit_value) : '',
    })
    setThumb(s.image_url ? { url: s.image_url, saved: true } : null)
    const { data } = await supabase.from('service_staff').select('member_id').eq('service_id', s.id)
    setSelectedMemberIds((data ?? []).map(r => (r as { member_id: string }).member_id))
    setOpen(true)
  }

  // Pick the thumbnail. In edit mode the service row exists, so upload +
  // persist immediately; in create mode stage the file (with a local preview)
  // until the new service's id exists on save.
  async function handlePickImage(file: File) {
    if (!org) return
    const err = serviceImageFileError(file)
    if (err) {
      toast.error(err === 'fileTooLarge' ? t('validation.fileTooLarge', { max: MAX_SERVICE_IMAGE_MB }) : t('validation.invalidImage'))
      return
    }
    // Accepted either way — but say so now, because a small photo gets stretched
    // across the booking card and nothing downstream can put the detail back.
    if (await isLowResolution(file)) {
      toast.error(t('validation.imageLowResolution', { width: RECOMMENDED_SERVICE_IMAGE_WIDTH }))
    }

    if (editing) {
      setThumbUploading(true)
      const url = await uploadServiceImage(org.id, editing.id, file)
      if (!url) { setThumbUploading(false); toast.error(t('validation.saveFailed')); return }
      const { error: upErr } = await supabase
        .from('services').update({ image_url: url }).eq('id', editing.id)
      if (upErr) { await removeServiceImageFile(url); setThumbUploading(false); toast.error(t('validation.saveFailed')); return }
      // Replacing a photo: drop the outgoing file so the bucket doesn't collect
      // orphans (the row already points at the new one).
      const previous = thumb?.saved ? thumb.url : null
      if (previous) await removeServiceImageFile(previous)
      setThumb({ url, saved: true })
      setServices(prev => prev.map(x => x.id === editing.id ? { ...x, image_url: url } : x))
      setThumbUploading(false)
    } else {
      if (thumb?.file) URL.revokeObjectURL(thumb.url)
      setThumb({ url: URL.createObjectURL(file), file })
    }
  }

  // Remove the thumbnail. A persisted one (edit mode) clears the row and
  // deletes the storage file; a staged one just drops its preview.
  async function handleRemoveImage() {
    const current = thumb
    if (!current) return
    setThumb(null)
    if (current.saved && editing) {
      await supabase.from('services').update({ image_url: null }).eq('id', editing.id)
      await removeServiceImageFile(current.url)
      setServices(prev => prev.map(x => x.id === editing.id ? { ...x, image_url: null } : x))
    } else if (current.file) {
      URL.revokeObjectURL(current.url)
    }
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
  const durationMissing = submitted && !(Number(form.duration_minutes) > 0)
  const nameTooShort = (submitted || form.name.trim().length > 0) && form.name.trim().length < 2
  // Free services were removed — a price below MIN_PRICE is invalid, and so is
  // an empty field (Number('') is 0, which used to save silently as free).
  const priceValid = isValidServicePrice(Number(form.price))
  const priceInvalid = (submitted || form.price.trim().length > 0) && !priceValid
  const maxPerSlotInvalid = !(Number(form.max_per_slot) >= 1)

  // Deposit: 'inherit' → NULL type (use org default); 'none' → no deposit;
  // 'fixed'/'percent' carry a value. Fixed must be ≥ 0 (and ≤ price at config
  // time); percent must be 0–100.
  const depositValue = Number(form.deposit_value)
  const depositNeedsValue = form.deposit_mode === 'fixed' || form.deposit_mode === 'percent'
  const depositValueInvalid =
    depositNeedsValue &&
    (form.deposit_value.trim().length === 0 ||
      !isNonNegativeNumber(depositValue) ||
      (form.deposit_mode === 'percent' && depositValue > 100) ||
      (form.deposit_mode === 'fixed' && depositValue > Number(form.price)))
  const depositPayload = () => ({
    deposit_type: form.deposit_mode === 'inherit' ? null : form.deposit_mode,
    deposit_value: depositNeedsValue ? depositValue : null,
  })

  async function handleSave() {
    if (!org) return
    // Every rule flagged inline on its field rather than a disabled button;
    // the first invalid field is pulled into view (scoped to the dialog).
    setSubmitted(true)
    const invalid =
      form.name.trim().length < 2 ||
      !(Number(form.duration_minutes) > 0) ||
      durationTooLong ||
      !priceValid ||
      maxPerSlotInvalid ||
      depositValueInvalid
    if (invalid) {
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDialog-root') ?? document)
      return
    }
    setSaving(true)
    setError(null)

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
          ...depositPayload(),
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
          ...depositPayload(),
          sort_order: maxOrder + 1,
        })
        .select('id')
        .single()
      if (err || !data) { setError(friendlyError(err?.message, t)); setSaving(false); return }
      serviceId = data.id
    }

    await syncStaff(serviceId)

    // Persist a thumbnail staged during create (in edit mode it was saved as
    // soon as it was picked). Best-effort: a failed upload shouldn't undo the
    // saved service — the photo can be re-added by editing.
    if (!editing && thumb?.file) {
      const url = await uploadServiceImage(org.id, serviceId, thumb.file)
      if (url) await supabase.from('services').update({ image_url: url }).eq('id', serviceId)
      URL.revokeObjectURL(thumb.url)
    }

    setSaving(false)
    setOpen(false)
    toast.success(t('common.saved'))
    load()
  }

  async function handleDelete(s: Service) {
    setDeleting(true)
    // Best-effort: remove the underlying storage file before the row goes
    // (otherwise the object would be orphaned).
    await removeServiceImageFile(s.image_url)
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
    <Box>
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
              title={t('settings.noServices')}
              caption={t('settings.noServicesCaption')}
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
                {s.image_url && (
                  <SkeletonImage
                    src={s.image_url}
                    alt=""
                    data-testid="service-row-thumb"
                    sx={{ width: 44, height: 44, borderRadius: 1.5, border: '1px solid', borderColor: 'divider', flexShrink: 0 }}
                  />
                )}
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                    {s.location_type === 'online' && (
                      <Chip label={t('settings.locationOnline')} size="small" color="primary" variant="outlined" />
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {s.duration_minutes} {t('common.minutesShort')} · {s.price} ₾
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

      {/* Create / Edit drawer */}
      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        disableClose={saving}
        title={editing ? t('settings.editService') : t('settings.newService')}
        width={560}
        actions={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={handleSave} data-testid="service-save" disabled={saving}>
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </>
        }
      >
        <Box>
          <FormErrorAlert message={error} data-testid="service-dialog-error" />
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('onboarding.serviceName')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              fullWidth
              required
              autoFocus
              error={nameTooShort}
              helperText={nameTooShort ? t('validation.minLength', { min: 2 }) : undefined}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.serviceName, 'data-testid': 'service-name' } }}
            />
            <TextField
              required
              label={t('onboarding.duration')}
              value={form.duration_minutes}
              onChange={e => setForm(f => ({ ...f, duration_minutes: onlyInt(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'service-duration' } }}
              error={durationTooLong || durationMissing}
              helperText={
                durationTooLong ? t('validation.durationTooLong')
                : durationMissing ? t('validation.required')
                : undefined
              }
            />
            <TextField
              label={t('onboarding.price')}
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: onlyDecimal(e.target.value) }))}
              fullWidth
              error={priceInvalid}
              helperText={
                !priceInvalid ? undefined
                : Number(form.price) > MAX_PRICE ? t('validation.priceTooLarge', { max: MAX_PRICE })
                : t('validation.priceTooLow', { min: MIN_PRICE })
              }
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'service-price' } }}
            />
            {/* Deposit — an upfront prepayment that confirms the booking (the
                strongest no-show killer). "Inherit" uses the org default; "None"
                overrides it to no deposit for this service. */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                {t('settings.deposit')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={form.deposit_mode}
                onChange={(_, v: DepositMode | null) => { if (v) setForm(f => ({ ...f, deposit_mode: v })) }}
              >
                <ToggleButton value="inherit" data-testid="deposit-mode-inherit">{t('settings.depositInherit')}</ToggleButton>
                <ToggleButton value="none" data-testid="deposit-mode-none">{t('settings.depositNone')}</ToggleButton>
                <ToggleButton value="fixed" data-testid="deposit-mode-fixed">{t('settings.depositFixed')}</ToggleButton>
                <ToggleButton value="percent" data-testid="deposit-mode-percent">{t('settings.depositPercent')}</ToggleButton>
              </ToggleButtonGroup>
              {depositNeedsValue && (
                <TextField
                  value={form.deposit_value}
                  onChange={e => setForm(f => ({ ...f, deposit_value: onlyDecimal(e.target.value) }))}
                  fullWidth
                  size="small"
                  sx={{ mt: 1.5 }}
                  label={form.deposit_mode === 'percent' ? t('settings.depositPercentLabel') : t('settings.depositFixedLabel')}
                  error={depositValueInvalid}
                  helperText={depositValueInvalid ? t('settings.depositValueHelp') : t('settings.depositHelp')}
                  slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'deposit-value' } }}
                />
              )}
              {form.deposit_mode === 'inherit' && (
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                  {t('settings.depositInheritHelp')}
                </Typography>
              )}
            </Box>
            <TextField
              required
              label={t('settings.maxPerSlot')}
              value={form.max_per_slot}
              onChange={e => setForm(f => ({ ...f, max_per_slot: onlyInt(e.target.value) }))}
              fullWidth
              error={maxPerSlotInvalid}
              helperText={maxPerSlotInvalid ? t('validation.required') : undefined}
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
              {form.location_type === 'online' && (
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                  {t('settings.locationOnlineHelp')}
                </Typography>
              )}
            </Box>
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
                        avatar={<Avatar src={m.avatar_url ?? undefined}>{(m.display_name?.trim() || '?').charAt(0).toUpperCase()}</Avatar>}
                        data-testid="service-staff-chip"
                        data-selected={sel}
                        onClick={() => toggleMember(m.id)}
                        color={sel ? 'primary' : 'default'}
                        variant={sel ? 'filled' : 'outlined'}
                      />
                    )
                  })}
                </Box>
              </Box>
            )}
            <ServiceThumbnailPicker
              url={thumb?.url ?? null}
              uploading={thumbUploading}
              onPick={handlePickImage}
              onRemove={handleRemoveImage}
              data-testid="service-image-picker"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                />
              }
              label={t('settings.serviceActive')}
            />
          </Stack>
        </Box>
      </SideDrawer>

      {/* Confirm delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('settings.deleteService')}
        message={confirmDelete ? t('settings.deleteServiceConfirm', { name: confirmDelete.name }) : undefined}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </Box>
  )
}
