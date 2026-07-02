import { useEffect, useState } from 'react'
import {
  Box, Typography, TextField, Button, IconButton, Chip, Stack, Alert, CircularProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'

/**
 * Owner per-date inventory control for a room type. Sets the ABSOLUTE number of
 * rooms bookable on a given date (0 = blocked), overriding attrs.total_rooms for
 * that date only — for maintenance or rooms sold off-platform. Backed by
 * room_inventory_overrides (migration 055); the availability RPC and the
 * enforce_hotel_inventory trigger both honor these rows.
 */
interface Override {
  id: string
  date: string          // yyyy-MM-dd
  rooms_available: number
  note: string | null
}

interface Props {
  orgId: string
  roomTypeId: string
  totalRooms: number
}

const todayKey = () => new Date().toISOString().slice(0, 10)

export default function RoomInventoryManager({ orgId, roomTypeId, totalRooms }: Props) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Override[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState('')
  const [rooms, setRooms] = useState('0')
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('room_inventory_overrides')
        .select('id, date, rooms_available, note')
        .eq('room_type_id', roomTypeId)
        .gte('date', todayKey())
        .order('date', { ascending: true })
      if (cancelled) return
      if (err) setError(t('validation.loadFailed'))
      else setRows((data ?? []) as Override[])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [roomTypeId, t])

  const roomsNum = Number(rooms)
  const canAdd = !!date && Number.isFinite(roomsNum) && roomsNum >= 0

  async function addOverride() {
    if (!canAdd) return
    setBusy(true); setError(null)
    // Unique (room_type_id, date) → upsert so re-adding a date edits it.
    const { data, error: err } = await supabase
      .from('room_inventory_overrides')
      .upsert(
        { org_id: orgId, room_type_id: roomTypeId, date, rooms_available: roomsNum, note: note.trim() || null },
        { onConflict: 'room_type_id,date' },
      )
      .select('id, date, rooms_available, note')
      .single()
    setBusy(false)
    if (err || !data) { setError(t('validation.saveFailed')); return }
    setRows(prev => {
      const without = prev.filter(r => r.date !== data.date)
      return [...without, data as Override].sort((a, b) => a.date.localeCompare(b.date))
    })
    setDate(''); setRooms('0'); setNote('')
  }

  async function removeOverride(id: string) {
    setBusy(true); setError(null)
    const { error: err } = await supabase.from('room_inventory_overrides').delete().eq('id', id)
    setBusy(false)
    if (err) { setError(t('validation.saveFailed')); return }
    setRows(prev => prev.filter(r => r.id !== id))
  }

  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t('hotel.availabilityOverrides')}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        {t('hotel.availabilityOverridesHint', { total: totalRooms })}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ py: 1, display: 'flex', justifyContent: 'center' }}><CircularProgress size={20} /></Box>
      ) : (
        <Stack spacing={1} sx={{ mb: 2 }}>
          {rows.length === 0 && (
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>{t('hotel.noOverrides')}</Typography>
          )}
          {rows.map(r => (
            <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ minWidth: 100 }}>{r.date}</Typography>
              {r.rooms_available === 0
                ? <Chip size="small" color="error" variant="outlined" label={t('hotel.blocked')} />
                : <Chip size="small" variant="outlined" label={t('hotel.roomsAvailable', { count: r.rooms_available })} />}
              {r.note && <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }} noWrap>{r.note}</Typography>}
              <IconButton size="small" aria-label={t('common.delete')} onClick={() => removeOverride(r.id)} disabled={busy}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          type="date"
          label={t('hotel.date')}
          value={date}
          onChange={e => setDate(e.target.value)}
          size="small"
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayKey(), 'data-testid': 'override-date' } }}
        />
        <TextField
          type="number"
          label={t('hotel.roomsCount')}
          value={rooms}
          onChange={e => setRooms(e.target.value.replace(/[^0-9]/g, ''))}
          size="small"
          sx={{ width: 110 }}
          slotProps={{ htmlInput: { min: 0, inputMode: 'numeric', 'data-testid': 'override-rooms' } }}
        />
        <TextField
          label={t('booking.notes')}
          value={note}
          onChange={e => setNote(e.target.value)}
          size="small"
          sx={{ flex: 1, minWidth: 120 }}
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />
        <Button variant="outlined" onClick={addOverride} disabled={!canAdd || busy} data-testid="override-add">
          {t('common.add')}
        </Button>
      </Box>
    </Box>
  )
}
