import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, MenuItem, CircularProgress, Box, Typography,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { format, addDays } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS } from '@/lib/validation'
import { nightsBetween } from '@/lib/hotelInventory'
import { useToast } from '@/components/ui'

interface Props {
  orgId: string
  onClose: () => void
  onCreated: () => void
}

interface RoomOption { id: string; name: string; capacity: number; nightlyPrice: number }

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')

export default function AddStayDialog({ orgId, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const toast = useToast()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [roomTypeId, setRoomTypeId] = useState('')
  const [checkIn, setCheckIn] = useState<Date | null>(new Date())
  const [checkOut, setCheckOut] = useState<Date | null>(addDays(new Date(), 1))
  const [guests, setGuests] = useState('2')
  const [notes, setNotes] = useState('')
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('resources')
      .select('id, name, capacity, attrs')
      .eq('org_id', orgId)
      .eq('kind', 'room_type')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setRooms((data ?? []).map(r => {
          const attrs = (r.attrs ?? {}) as { nightly_price?: number }
          return { id: r.id as string, name: r.name as string, capacity: r.capacity as number, nightlyPrice: Number(attrs.nightly_price ?? 0) }
        }))
      })
  }, [orgId])

  const room = rooms.find(r => r.id === roomTypeId) ?? null
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0
  const total = room ? nights * room.nightlyPrice : 0

  const canSave =
    firstName.trim().length >= 2 && isValidPersonName(firstName) &&
    (lastName.trim() === '' || isValidPersonName(lastName)) &&
    isValidGeorgianPhone(phone) &&
    !!room && nights > 0 && Number(guests) >= 1

  async function handleSave() {
    if (!canSave || !room || !checkIn || !checkOut) return
    setSaving(true); setError(null)
    try {
      const customerId = crypto.randomUUID()
      const { error: custErr } = await supabase.from('customers').insert({
        id: customerId,
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone_number: formatGeorgianPhone(phone),
      })
      if (custErr) throw new Error(custErr.message)

      const { error: stayErr } = await supabase.from('hotel_stays').insert({
        org_id: orgId,
        customer_id: customerId,
        room_type_id: room.id,
        check_in: format(checkIn, 'yyyy-MM-dd'),
        check_out: format(checkOut, 'yyyy-MM-dd'),
        guests: Number(guests),
        nightly_rate: room.nightlyPrice,
        total_amount: total,
        status: 'approved',
        notes: notes.trim() || null,
      })
      if (stayErr) throw new Error(stayErr.message)

      toast.success(t('common.saved'))
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('booking.bookFailed'))
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t('hotel.newStay')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Typography variant="body2" color="error">{error}</Typography>}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label={t('booking.firstName')} value={firstName} onChange={e => setFirstName(e.target.value)} required
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'add-stay-first' } }} />
            <TextField label={t('booking.lastName')} value={lastName} onChange={e => setLastName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName } }} />
          </Box>
          <TextField label={t('booking.phone')} value={phone} onChange={e => setPhone(e.target.value)} required placeholder="599 123 456"
            slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'add-stay-phone' } }} />
          <TextField select label={t('hotel.room')} value={roomTypeId} onChange={e => setRoomTypeId(e.target.value)} required
            slotProps={{ htmlInput: { 'data-testid': 'add-stay-room' } }}>
            {rooms.length === 0
              ? <MenuItem value="" disabled>{t('hotel.noRooms')}</MenuItem>
              : rooms.map(r => <MenuItem key={r.id} value={r.id}>{r.name} — {r.nightlyPrice} ₾</MenuItem>)}
          </TextField>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <DatePicker label={t('hotel.checkIn')} value={checkIn} minDate={new Date()} format="dd MMM"
              onChange={v => { setCheckIn(v); if (checkOut && v && checkOut <= v) setCheckOut(addDays(v, 1)) }}
              slotProps={{ textField: { fullWidth: true, required: true } }} />
            <DatePicker label={t('hotel.checkOut')} value={checkOut} minDate={checkIn ? addDays(checkIn, 1) : new Date()} format="dd MMM"
              onChange={v => setCheckOut(v)} slotProps={{ textField: { fullWidth: true, required: true } }} />
          </Box>
          <TextField required label={t('hotel.guests')} value={guests} onChange={e => setGuests(onlyInt(e.target.value))}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'add-stay-guests' } }} />
          {room && nights > 0 && (
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {nights} {t('hotel.nights')} · {total} ₾
            </Typography>
          )}
          <TextField label={t('booking.notes')} value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes } }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !canSave} data-testid="add-stay-save">
          {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
