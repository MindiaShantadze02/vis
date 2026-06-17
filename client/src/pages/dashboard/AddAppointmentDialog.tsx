import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Stack, FormControl, InputLabel, Select, MenuItem,
  FormHelperText, Alert, CircularProgress, Box, Typography,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, formatGeorgianPhone } from '@/lib/validation'
import { computeAvailableSlots, getDayKey } from '@/lib/slots'
import type { SlotApptRow, SlotOverride, WeekTemplate } from '@/lib/slots'
import { useToast } from '@/components/ui'

interface ServiceOption {
  id: string
  name: string
  duration_minutes: number
  price: number
  max_per_slot: number
}

interface StaffOption { id: string; display_name: string | null; sort_order: number }

// Appointments + override fetched for one specific date. Keyed by dateKey so a
// stale fetch from the previous date doesn't drive slot computation.
interface DayData { dateKey: string; appts: SlotApptRow[]; override: SlotOverride | null }

// Default window used to generate predefined slots for a day that has no
// configured working hours (or is marked closed), so the admin always picks
// from a dropdown rather than typing a time by hand.
const FALLBACK_OPEN = '08:00'
const FALLBACK_CLOSE = '22:00'

interface Props {
  orgId: string
  onClose: () => void
  // Called after a successful insert so the caller can refresh its list/stats.
  onCreated: () => void
}

// Manual appointment entry — for bookings an admin takes over the phone and
// wants to log. Mirrors the guest booking flow's direct-insert approach
// (client-generated UUIDs sidestep SELECT-after-INSERT under RLS) and reuses
// the same availability logic so the admin picks from real free slots.
// Mounted only while open, so each open starts with fresh form state.
export default function AddAppointmentDialog({ orgId, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const toast = useToast()

  const [services, setServices] = useState<ServiceOption[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [template, setTemplate] = useState<WeekTemplate | null>(null)
  const [templateLoaded, setTemplateLoaded] = useState(false)
  const [dayData, setDayData] = useState<DayData | null>(null)

  const [serviceId, setServiceId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState<Date | null>(null)
  const [timeStr, setTimeStr] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the org's active services and weekly working hours once on open.
  useEffect(() => {
    supabase
      .from('services')
      .select('id, name, duration_minutes, price, max_per_slot')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setServices((data ?? []) as ServiceOption[]))

    supabase
      .from('working_hours_template')
      .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday')
      .eq('org_id', orgId)
      .maybeSingle()
      // Mark loaded regardless of result — an org may have no working-hours row
      // (onboarding skipped). We fall back to free time entry in that case
      // rather than leaving the time field stuck disabled.
      .then(({ data }) => { setTemplate((data as WeekTemplate) ?? null); setTemplateLoaded(true) })
  }, [orgId])

  // Load the people assignable to the chosen service. The prior staff choice is
  // reset in the service Select's onChange (keeping setState out of the effect).
  useEffect(() => {
    if (!serviceId) return
    supabase
      .from('service_staff')
      .select('org_members(id, display_name, is_bookable, sort_order)')
      .eq('service_id', serviceId)
      .then(({ data }) => {
        // PostgREST types the nested relation as an array but returns an object.
        const members = (data ?? [])
          .map(r => {
            const m = (r as { org_members: unknown }).org_members
            return (Array.isArray(m) ? m[0] : m) as (StaffOption & { is_bookable: boolean }) | null
          })
          .filter((m): m is StaffOption & { is_bookable: boolean } => !!m && m.is_bookable)
          .sort((a, b) => a.sort_order - b.sort_order)
        setStaff(members)
      })
  }, [serviceId])

  // Fetch the chosen day's appointments + override so slots reflect real load.
  useEffect(() => {
    if (!date) return
    const dateKey = format(date, 'yyyy-MM-dd')
    const dayStart = dateKey + 'T00:00:00.000Z'
    const dayEnd = dateKey + 'T23:59:59.999Z'

    Promise.all([
      supabase
        .from('appointments')
        .select('scheduled_at, duration_minutes, service_id, staff_id')
        .eq('org_id', orgId)
        .gte('scheduled_at', dayStart)
        .lte('scheduled_at', dayEnd)
        .not('status', 'in', '(rejected,cancelled)')
        .then(({ data }) => (data ?? []) as SlotApptRow[]),

      supabase
        .from('working_hours_overrides')
        .select('is_closed, ranges')
        .eq('org_id', orgId)
        .eq('date', dateKey)
        .maybeSingle()
        .then(({ data }) => (data ?? null) as SlotOverride | null),
    ]).then(([appts, override]) => setDayData({ dateKey, appts, override }))
  }, [date, orgId])

  const selectedService = services.find(s => s.id === serviceId)
  const dateKey = date ? format(date, 'yyyy-MM-dd') : null

  // Predefined start times for the chosen date/service/staff — derived, so no
  // effect writes slot state. Computed from the org's working hours; if the day
  // has none configured (or is closed), we fall back to a default window so the
  // admin still picks from a dropdown. Either way `usingFallback` flags the
  // latter for a hint. Taken and past times are always excluded.
  const { slots, usingFallback } = useMemo(() => {
    if (!date || !dateKey || !selectedService || !templateLoaded || dayData?.dateKey !== dateKey) {
      return { slots: [] as string[], usingFallback: false }
    }
    const base = {
      date,
      existing: dayData.appts,
      serviceId: selectedService.id,
      durationMinutes: selectedService.duration_minutes,
      maxPerSlot: selectedService.max_per_slot,
      assignedStaff: staff,
      selectedStaffId: staffId || null,
    }
    const real = template
      ? computeAvailableSlots({ ...base, template, override: dayData.override })
      : []
    if (real.length > 0) return { slots: real, usingFallback: false }

    const fallback = computeAvailableSlots({
      ...base,
      template: { [getDayKey(date)]: { open: true, ranges: [{ start: FALLBACK_OPEN, end: FALLBACK_CLOSE }] } },
      override: null,
    })
    return { slots: fallback, usingFallback: true }
  }, [date, dateKey, template, templateLoaded, selectedService, dayData, staff, staffId])

  // "Ready" = working hours loaded and this date's appointments fetched. Until
  // then the time field shows a loading state; it never stays disabled.
  const dayReady = templateLoaded && !!dateKey && dayData?.dateKey === dateKey
  const timeLoading = !!serviceId && !!date && !dayReady
  const noSlots = dayReady && slots.length === 0
  const timeValid = slots.includes(timeStr)

  const scheduledAt = date && timeValid
    ? (() => {
      const [h, m] = timeStr.split(':').map(Number)
      const d = new Date(date)
      d.setHours(h, m, 0, 0)
      return d
    })()
    : null

  const phoneInvalid = phone.trim().length > 0 && !isValidGeorgianPhone(phone)
  const canSave =
    !!serviceId &&
    firstName.trim().length >= 2 &&
    isValidGeorgianPhone(phone) &&
    !!scheduledAt

  async function handleSave() {
    if (!selectedService || !scheduledAt) return
    setSaving(true)
    setError(null)

    try {
      // Generate IDs client-side to avoid needing SELECT after INSERT (the
      // customers RLS SELECT policy can't see a brand-new customer yet).
      const customerId = crypto.randomUUID()
      const appointmentId = crypto.randomUUID()

      const { error: custErr } = await supabase
        .from('customers')
        .insert({
          id: customerId,
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          phone_number: formatGeorgianPhone(phone),
        })
      if (custErr) throw new Error(custErr.message)

      const { error: apptErr } = await supabase
        .from('appointments')
        .insert({
          id: appointmentId,
          org_id: orgId,
          service_id: selectedService.id,
          customer_id: customerId,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes: selectedService.duration_minutes,
          staff_id: staffId || null,
          // Logged by an admin from a confirmed call — created already approved.
          status: 'approved',
          payment_method: 'in_person',
          payment_status: 'unpaid',
          notes: notes.trim() || null,
        })
      if (apptErr) throw new Error(apptErr.message)

      toast.success('ჯავშანი დაემატა')
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'დამატება ვერ მოხერხდა')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>ჯავშნის დამატება</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth size="small">
            <InputLabel>სერვისი</InputLabel>
            <Select
              value={serviceId}
              label="სერვისი"
              onChange={e => { setServiceId(e.target.value); setStaffId(''); setTimeStr('') }}
            >
              {services.map(s => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name} — {s.price} ₾ · {s.duration_minutes} წთ
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {staff.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel>{t('dashboard.staff')}</InputLabel>
              <Select
                value={staffId}
                label={t('dashboard.staff')}
                onChange={e => { setStaffId(e.target.value); setTimeStr('') }}
              >
                <MenuItem value=""><em>{t('dashboard.unassigned')}</em></MenuItem>
                {staff.map(m => (
                  <MenuItem key={m.id} value={m.id}>{m.display_name || '—'}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="სახელი"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              fullWidth required size="small"
            />
            <TextField
              label="გვარი"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              fullWidth size="small"
            />
          </Stack>

          <TextField
            label="ტელეფონი"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            fullWidth required size="small"
            placeholder="599 123 456"
            error={phoneInvalid}
            helperText={phoneInvalid ? t('validation.invalidPhone') : ' '}
            slotProps={{ htmlInput: { inputMode: 'tel' as const } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <DatePicker
              label="თარიღი"
              value={date}
              onChange={v => { setDate(v); setTimeStr('') }}
              format="dd MMM yyyy"
              disablePast
              slotProps={{ textField: { size: 'small', fullWidth: true, required: true } }}
            />
            <FormControl fullWidth size="small" disabled={!serviceId || !date || timeLoading} error={noSlots}>
              <InputLabel>დრო</InputLabel>
              <Select
                value={slots.includes(timeStr) ? timeStr : ''}
                label="დრო"
                onChange={e => setTimeStr(e.target.value)}
                MenuProps={{ slotProps: { paper: { sx: { maxHeight: 240 } } } }}
              >
                {slots.map(s => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
              {timeLoading
                ? <FormHelperText>იტვირთება…</FormHelperText>
                : noSlots
                ? <FormHelperText>ამ დღეს თავისუფალი დრო არ არის</FormHelperText>
                : usingFallback
                ? <FormHelperText>ნაგულისხმევი სლოტები — სამუშაო საათები არ არის მითითებული</FormHelperText>
                : null}
            </FormControl>
          </Stack>

          <TextField
            label="შენიშვნა (არასავალდებულო)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            fullWidth multiline rows={2} size="small"
          />

          {selectedService && (
            <Box sx={{ bgcolor: 'grey.50', borderRadius: 2, p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>ფასი</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                  {selectedService.price} ₾
                </Typography>
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? <CircularProgress size={22} color="inherit" /> : 'დამატება'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
