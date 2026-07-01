import { useEffect, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, MenuItem, CircularProgress, Box, Typography,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS } from '@/lib/validation'
import { useToast } from '@/components/ui'

interface Props {
  orgId: string
  onClose: () => void
  onCreated: () => void
}

interface TableOption { id: string; name: string; capacity: number }

// Half-hour slots a manual reservation can be set to.
const TIMES = Array.from({ length: (23 - 8) * 2 + 1 }, (_, i) => {
  const m = 8 * 60 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')

export default function AddReservationDialog({ orgId, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const { org } = useOrg()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [partySize, setPartySize] = useState('2')
  const [date, setDate] = useState<Date | null>(new Date())
  const [time, setTime] = useState('19:00')
  const [tableId, setTableId] = useState('')
  const [notes, setNotes] = useState('')
  const [tables, setTables] = useState<TableOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('resources')
      .select('id, name, capacity')
      .eq('org_id', orgId)
      .eq('kind', 'table')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setTables((data ?? []) as TableOption[]))
  }, [orgId])

  const canSave =
    firstName.trim().length >= 2 && isValidPersonName(firstName) &&
    (lastName.trim() === '' || isValidPersonName(lastName)) &&
    isValidGeorgianPhone(phone) &&
    Number(partySize) >= 1 && !!date && !!time

  async function handleSave() {
    if (!canSave || !date) return
    setSaving(true); setError(null)
    try {
      const reservedAt = new Date(`${format(date, 'yyyy-MM-dd')}T${time}:00`)
      const customerId = crypto.randomUUID()
      const { error: custErr } = await supabase.from('customers').insert({
        id: customerId,
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        phone_number: formatGeorgianPhone(phone),
      })
      if (custErr) throw new Error(custErr.message)

      // Admin-entered → already confirmed. The OTP-enforcement trigger exempts
      // org members, so no verification is needed for this insert.
      const { error: resvErr } = await supabase.from('restaurant_reservations').insert({
        org_id: orgId,
        customer_id: customerId,
        table_id: tableId || null,
        party_size: Number(partySize),
        reserved_at: reservedAt.toISOString(),
        turn_minutes: org?.reservation_turn_minutes ?? 120,
        status: 'approved',
        notes: notes.trim() || null,
      })
      if (resvErr) throw new Error(resvErr.message)

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
      <DialogTitle sx={{ fontWeight: 700 }}>{t('restaurant.newReservation')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Typography variant="body2" color="error">{error}</Typography>}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField label={t('booking.firstName')} value={firstName} onChange={e => setFirstName(e.target.value)} required
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'add-resv-first' } }} />
            <TextField label={t('booking.lastName')} value={lastName} onChange={e => setLastName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName } }} />
          </Box>
          <TextField label={t('booking.phone')} value={phone} onChange={e => setPhone(e.target.value)} required placeholder="599 123 456"
            slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'add-resv-phone' } }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField required label={t('restaurant.partySize')} value={partySize} onChange={e => setPartySize(onlyInt(e.target.value))}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'add-resv-party' } }} />
            <TextField required select label={t('restaurant.time')} value={time} onChange={e => setTime(e.target.value)}>
              {TIMES.map(tm => <MenuItem key={tm} value={tm}>{tm}</MenuItem>)}
            </TextField>
          </Box>
          <DatePicker label={t('booking.summaryDate')} value={date} minDate={new Date()} format="dd MMM yyyy"
            onChange={v => setDate(v)} slotProps={{ textField: { fullWidth: true, required: true } }} />
          {tables.length > 0 && (
            <TextField select label={t('restaurant.selectTable')} value={tableId} onChange={e => setTableId(e.target.value)}>
              <MenuItem value=""><em>—</em></MenuItem>
              {tables.map(tb => <MenuItem key={tb.id} value={tb.id}>{tb.name} ({tb.capacity})</MenuItem>)}
            </TextField>
          )}
          <TextField label={t('booking.notes')} value={notes} onChange={e => setNotes(e.target.value)} multiline rows={2}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes } }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !canSave} data-testid="add-resv-save">
          {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
