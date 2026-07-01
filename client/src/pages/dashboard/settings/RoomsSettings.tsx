import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack,
  Switch, FormControlLabel, Divider, Alert,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { HotelOutlined as HotelOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'

// A room TYPE is a resources row with kind='room_type'. capacity = max guests
// per room; nightly_price + total_rooms (how many identical rooms exist) live
// in attrs jsonb (the booking flow reads these for pricing & availability).
interface RoomTypeAttrs {
  nightly_price?: number
  total_rooms?: number
}
interface RoomType {
  id: string
  name: string
  capacity: number
  attrs: RoomTypeAttrs | null
  is_active: boolean
  sort_order: number
}

interface RoomForm {
  name: string
  capacity: string
  nightlyPrice: string
  totalRooms: string
  is_active: boolean
}

const EMPTY: RoomForm = { name: '', capacity: '2', nightlyPrice: '0', totalRooms: '1', is_active: true }

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function RoomsSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [rooms, setRooms] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RoomType | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<RoomType | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)
    const { data } = await supabase
      .from('resources')
      .select('id, name, capacity, attrs, is_active, sort_order')
      .eq('org_id', org.id)
      .eq('kind', 'room_type')
      .order('sort_order')
    setRooms((data ?? []) as RoomType[])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  function openEdit(r: RoomType) {
    setEditing(r)
    setForm({
      name: r.name,
      capacity: String(r.capacity),
      nightlyPrice: String(r.attrs?.nightly_price ?? 0),
      totalRooms: String(r.attrs?.total_rooms ?? 1),
      is_active: r.is_active,
    })
    setOpen(true)
  }

  const capacityInvalid = !(Number(form.capacity) >= 1)
  const totalRoomsInvalid = !(Number(form.totalRooms) >= 1)
  const canSave = form.name.trim().length >= 1 && !capacityInvalid && !totalRoomsInvalid

  async function handleSave() {
    if (!org || !canSave) return
    setSaving(true)
    setError(null)

    const attrs: RoomTypeAttrs = {
      nightly_price: Number(form.nightlyPrice) || 0,
      total_rooms: Number(form.totalRooms),
    }

    if (editing) {
      const { error: err } = await supabase
        .from('resources')
        .update({ name: form.name.trim(), capacity: Number(form.capacity), attrs, is_active: form.is_active })
        .eq('id', editing.id)
      if (err) { setError(t('validation.saveFailed')); setSaving(false); return }
    } else {
      const maxOrder = rooms.reduce((m, x) => Math.max(m, x.sort_order), -1)
      const { error: err } = await supabase
        .from('resources')
        .insert({
          org_id: org.id,
          kind: 'room_type',
          name: form.name.trim(),
          capacity: Number(form.capacity),
          attrs,
          is_active: form.is_active,
          sort_order: maxOrder + 1,
        })
      if (err) { setError(t('validation.saveFailed')); setSaving(false); return }
    }

    setSaving(false)
    setOpen(false)
    toast.success(t('common.saved'))
    load()
  }

  async function handleDelete(r: RoomType) {
    setDeleting(true)
    await supabase.from('resources').delete().eq('id', r.id)
    setDeleting(false)
    setConfirmDelete(null)
    toast.success(t('common.deleted'))
    load()
  }

  async function toggleActive(r: RoomType) {
    await supabase.from('resources').update({ is_active: !r.is_active }).eq('id', r.id)
    setRooms(prev => prev.map(x => x.id === r.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader
        title={t('hotel.rooms')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="room-add">
            {t('hotel.newRoom')}
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        {loading
          ? <LoadingState />
          : rooms.length === 0
          ? <EmptyState icon={<HotelOutlinedIcon />} title={t('hotel.noRooms')} caption={t('hotel.noRoomsCaption')} />
          : rooms.map((r, i) => (
            <Box key={r.id}>
              {i > 0 && <Divider />}
              <Box
                data-testid="room-row"
                sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 2, opacity: r.is_active ? 1 : 0.55 }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {r.attrs?.nightly_price ?? 0} ₾ / {t('hotel.night')} · {r.capacity} {t('hotel.guests')} · {r.attrs?.total_rooms ?? 0} {t('hotel.roomsCount')}
                  </Typography>
                </Box>
                <Switch checked={r.is_active} onChange={() => toggleActive(r)} data-testid="room-active-toggle" />
                <ActionIconButton aria-label={t('common.edit')} data-testid="room-edit" onClick={() => openEdit(r)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="room-delete" onClick={() => setConfirmDelete(r)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))
        }
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editing ? t('hotel.editRoom') : t('hotel.newRoom')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('hotel.roomName')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              fullWidth required autoFocus
              slotProps={{ htmlInput: { maxLength: 60, 'data-testid': 'room-name' } }}
            />
            <TextField
              label={t('hotel.maxGuests')}
              value={form.capacity}
              onChange={e => setForm(f => ({ ...f, capacity: onlyInt(e.target.value) }))}
              fullWidth error={capacityInvalid}
              helperText={capacityInvalid ? t('validation.required') : undefined}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'room-capacity' } }}
            />
            <TextField
              label={t('hotel.nightlyPrice')}
              value={form.nightlyPrice}
              onChange={e => setForm(f => ({ ...f, nightlyPrice: onlyDecimal(e.target.value) }))}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'room-price' } }}
            />
            <TextField
              label={t('hotel.totalRooms')}
              value={form.totalRooms}
              onChange={e => setForm(f => ({ ...f, totalRooms: onlyInt(e.target.value) }))}
              fullWidth error={totalRoomsInvalid}
              helperText={totalRoomsInvalid ? t('validation.required') : undefined}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'room-total' } }}
            />
            <FormControlLabel
              control={<Switch checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />}
              label={t('hotel.roomActive')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSave} data-testid="room-save" disabled={saving || !canSave}>
            {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('hotel.deleteRoom')}
        message={confirmDelete ? t('hotel.deleteRoomConfirm', { name: confirmDelete.name }) : undefined}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </Box>
  )
}
