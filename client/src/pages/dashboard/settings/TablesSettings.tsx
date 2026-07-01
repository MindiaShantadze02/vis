import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack,
  Switch, FormControlLabel, Divider, Alert,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { TableRestaurantOutlined as TableRestaurantOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'

// A "table" is a resources row with kind='table' (migration 045). capacity =
// number of seats; the booking flow matches party_size against it.
interface RestaurantTable {
  id: string
  name: string
  capacity: number
  is_active: boolean
  sort_order: number
}

// Numeric fields are held as strings while editing (same convention as
// ServicesSettings) so inputs can be cleared/partially typed.
interface TableForm {
  name: string
  capacity: string
  is_active: boolean
}

const EMPTY: TableForm = { name: '', capacity: '2', is_active: true }

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')

export default function TablesSettings() {
  const { t } = useTranslation()
  const { org, refresh } = useOrg()
  const toast = useToast()

  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-org table turn time (migration 052).
  const [turn, setTurn] = useState('120')
  const [savingTurn, setSavingTurn] = useState(false)
  useEffect(() => {
    if (org) setTurn(String(org.reservation_turn_minutes ?? 120))
  }, [org])

  async function saveTurn() {
    if (!org || !(Number(turn) > 0)) return
    setSavingTurn(true)
    await supabase.from('organisations').update({ reservation_turn_minutes: Number(turn) }).eq('id', org.id)
    setSavingTurn(false)
    await refresh()
    toast.success(t('common.saved'))
  }

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RestaurantTable | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<RestaurantTable | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)
    const { data } = await supabase
      .from('resources')
      .select('id, name, capacity, is_active, sort_order')
      .eq('org_id', org.id)
      .eq('kind', 'table')
      .order('sort_order')
    setTables((data ?? []) as RestaurantTable[])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  function openEdit(tbl: RestaurantTable) {
    setEditing(tbl)
    setForm({ name: tbl.name, capacity: String(tbl.capacity), is_active: tbl.is_active })
    setOpen(true)
  }

  const nameTooShort = form.name.trim().length > 0 && form.name.trim().length < 1
  const capacityInvalid = !(Number(form.capacity) >= 1)
  const canSave = form.name.trim().length >= 1 && !capacityInvalid

  async function handleSave() {
    if (!org || !canSave) return
    setSaving(true)
    setError(null)

    if (editing) {
      const { error: err } = await supabase
        .from('resources')
        .update({
          name: form.name.trim(),
          capacity: Number(form.capacity),
          is_active: form.is_active,
        })
        .eq('id', editing.id)
      if (err) { setError(t('validation.saveFailed')); setSaving(false); return }
    } else {
      const maxOrder = tables.reduce((m, x) => Math.max(m, x.sort_order), -1)
      const { error: err } = await supabase
        .from('resources')
        .insert({
          org_id: org.id,
          kind: 'table',
          name: form.name.trim(),
          capacity: Number(form.capacity),
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

  async function handleDelete(tbl: RestaurantTable) {
    setDeleting(true)
    await supabase.from('resources').delete().eq('id', tbl.id)
    setDeleting(false)
    setConfirmDelete(null)
    toast.success(t('common.deleted'))
    load()
  }

  async function toggleActive(tbl: RestaurantTable) {
    await supabase.from('resources').update({ is_active: !tbl.is_active }).eq('id', tbl.id)
    setTables(prev => prev.map(x => x.id === tbl.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader
        title={t('restaurant.tables')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="table-add">
            {t('restaurant.newTable')}
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ mb: 2, p: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{t('restaurant.turnTime')}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextField
            value={turn}
            onChange={e => setTurn(e.target.value.replace(/[^0-9]/g, ''))}
            size="small"
            error={!(Number(turn) > 0)}
            helperText={t('restaurant.turnTimeHelp')}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'turn-minutes' } }}
            sx={{ width: 160 }}
          />
          <Button
            variant="outlined"
            onClick={saveTurn}
            disabled={savingTurn || !(Number(turn) > 0) || String(org?.reservation_turn_minutes ?? 120) === turn}
            data-testid="turn-save"
          >
            {savingTurn ? <CircularProgress size={18} color="inherit" /> : t('common.save')}
          </Button>
        </Box>
      </Card>

      <Card>
        {loading
          ? <LoadingState />
          : tables.length === 0
          ? (
            <EmptyState
              icon={<TableRestaurantOutlinedIcon />}
              title={t('restaurant.noTables')}
              caption={t('restaurant.noTablesCaption')}
            />
          )
          : tables.map((tbl, i) => (
            <Box key={tbl.id}>
              {i > 0 && <Divider />}
              <Box
                data-testid="table-row"
                sx={{
                  px: 2.5, py: 2,
                  display: 'flex', alignItems: 'center', gap: 2,
                  opacity: tbl.is_active ? 1 : 0.55,
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{tbl.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {tbl.capacity} {t('restaurant.seats')}
                  </Typography>
                </Box>
                <Switch
                  checked={tbl.is_active}
                  onChange={() => toggleActive(tbl)}
                  data-testid="table-active-toggle"
                />
                <ActionIconButton aria-label={t('common.edit')} data-testid="table-edit" onClick={() => openEdit(tbl)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="table-delete" onClick={() => setConfirmDelete(tbl)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editing ? t('restaurant.editTable') : t('restaurant.newTable')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('restaurant.tableName')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              fullWidth
              required
              autoFocus
              error={nameTooShort}
              slotProps={{ htmlInput: { maxLength: 60, 'data-testid': 'table-name' } }}
            />
            <TextField
              required
              label={t('restaurant.seats')}
              value={form.capacity}
              onChange={e => setForm(f => ({ ...f, capacity: onlyInt(e.target.value) }))}
              fullWidth
              error={capacityInvalid}
              helperText={capacityInvalid ? t('validation.required') : undefined}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'table-capacity' } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                />
              }
              label={t('restaurant.tableActive')}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            data-testid="table-save"
            disabled={saving || !canSave}
          >
            {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('restaurant.deleteTable')}
        message={confirmDelete ? t('restaurant.deleteTableConfirm', { name: confirmDelete.name }) : undefined}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </Box>
  )
}
