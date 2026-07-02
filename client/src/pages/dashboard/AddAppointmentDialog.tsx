import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Stack, FormControl, InputLabel, Select, MenuItem,
  FormHelperText, Alert, CircularProgress, Box, Typography, Avatar,
} from '@mui/material'
import { AppDatePicker } from '@/components/AppDatePicker'
import { format, isValid } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS } from '@/lib/validation'
import { computeAvailableSlots, getDayKey } from '@/lib/slots'
import type { SlotApptRow, SlotOverride, WeekTemplate } from '@/lib/slots'
import { useToast } from '@/components/ui'
import { surface } from '@/theme/theme'

interface ServiceOption {
  id: string
  name: string
  duration_minutes: number
  price: number
  max_per_slot: number
}

interface StaffOption { id: string; display_name: string | null; sort_order: number; avatar_url: string | null }

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
  const navigate = useNavigate()

  // Whether the org has hit its monthly tier limit. Manual entries count
  // toward usage and are blocked by the same DB trigger as guest bookings, so
  // we surface an upgrade prompt and disable Save rather than fail on insert.
  const [atLimit, setAtLimit] = useState(false)

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

    // Same derived usage the Subscription page reads. appt_limit null = unlimited.
    supabase
      .rpc('org_usage_info', { p_org_id: orgId })
      .maybeSingle()
      .then(({ data }) => {
        const info = data as { used: number; appt_limit: number | null } | null
        setAtLimit(!!info && info.appt_limit != null && info.used >= info.appt_limit)
      })
  }, [orgId])

  // Load the people assignable to the chosen service. The prior staff choice is
  // reset in the service Select's onChange (keeping setState out of the effect).
  useEffect(() => {
    if (!serviceId) return
    supabase
      .from('service_staff')
      .select('org_members(id, display_name, is_bookable, sort_order, avatar_url)')
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
    // The DatePicker hands back an Invalid Date while the user is mid-typing;
    // it's truthy but format() throws on it, so bail until it's a real date.
    if (!date || !isValid(date)) return
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
  const dateKey = date && isValid(date) ? format(date, 'yyyy-MM-dd') : null

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
  const firstNameTooShort = firstName.trim().length > 0 && firstName.trim().length < 2
  const firstNameInvalid = firstName.trim().length >= 2 && !isValidPersonName(firstName)
  const lastNameInvalid = lastName.trim().length > 0 && !isValidPersonName(lastName)
  const canSave =
    !!serviceId &&
    firstName.trim().length >= 2 &&
    isValidPersonName(firstName) &&
    !lastNameInvalid &&
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
      // The DB trigger rejects with 'limit_reached' if the org hit its quota
      // between opening the dialog and saving — reflect the at-limit state.
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('limit_reached')) {
        setAtLimit(true)
        setError(null)
      } else {
        setError(msg || 'დამატება ვერ მოხერხდა')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth data-testid="add-appt-dialog">
      <DialogTitle sx={{ fontWeight: 700 }}>ჯავშნის დამატება</DialogTitle>
      <DialogContent>
        {atLimit && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            data-testid="add-appt-limit"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => { onClose(); navigate('/dashboard/settings/subscription') }}
              >
                {t('subscription.upgrade')}
              </Button>
            }
          >
            {t('subscription.limitReached')} — {t('subscription.bookingsBlocked')}
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="add-appt-error">{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth required size="small">
            <InputLabel>სერვისი</InputLabel>
            <Select
              value={serviceId}
              label="სერვისი"
              data-testid="add-appt-service"
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
                  <MenuItem key={m.id} value={m.id} sx={{ gap: 1 }}>
                    <Avatar src={m.avatar_url ?? undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
                      {(m.display_name?.trim() || '?').charAt(0).toUpperCase()}
                    </Avatar>
                    {m.display_name || '—'}
                  </MenuItem>
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
              error={firstNameTooShort || firstNameInvalid}
              helperText={
                firstNameTooShort ? t('validation.minLength', { min: 2 })
                : firstNameInvalid ? t('validation.lettersOnly')
                : undefined
              }
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'add-appt-first-name' } }}
            />
            <TextField
              label="გვარი"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              fullWidth size="small"
              error={lastNameInvalid}
              helperText={lastNameInvalid ? t('validation.lettersOnly') : undefined}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName } }}
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
            slotProps={{ htmlInput: { inputMode: 'tel' as const, 'data-testid': 'add-appt-phone' } }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <AppDatePicker
              label="თარიღი"
              value={date}
              onChange={v => { setDate(v); setTimeStr('') }}
              format="dd MMM yyyy"
              disablePast
              slotProps={{ textField: { size: 'small', fullWidth: true, required: true } }}
            />
            <FormControl fullWidth required size="small" disabled={!serviceId || !date || timeLoading} error={noSlots}>
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
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes } }}
          />

          {selectedService && (
            <Box sx={{ bgcolor: surface.subtle, borderRadius: 2, p: 1.5 }}>
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
        <Button onClick={onClose} disabled={saving} data-testid="add-appt-cancel">{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave || saving || atLimit} data-testid="add-appt-save">
          {saving ? <CircularProgress size={22} color="inherit" /> : 'დამატება'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
