import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, IconButton, Card, Tooltip,
  Drawer, Stack, Button, CircularProgress, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel, TextField,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import TodayIcon from '@mui/icons-material/Today'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import CloseIcon from '@mui/icons-material/Close'
import { format, startOfWeek, addWeeks, addDays, isSameDay } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { StatusChip, ConfirmDialog, LoadingState } from '@/components/ui'

// ── Types ─────────────────────────────────────────────────────

interface StaffRef { id: string; display_name: string | null; title: string | null }

interface Appointment {
  id: string
  scheduled_at: string
  duration_minutes: number
  service_id: string
  staff_id: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed'
  payment_method: string
  payment_status: string
  notes: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  services: { name: string; price: number } | null
  staff: StaffRef | null
}

/** PostgREST may type a to-one relation as an array; normalize to one object. */
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

interface RestPeriod { start: string; end: string; label: string }

interface DayOverride {
  is_closed: boolean
  ranges: Array<{ start: string; end: string }> | null
  rest_periods: RestPeriod[]
}

type TemplateDay = { open: boolean; ranges: Array<{ start: string; end: string }> }
type Template = Record<string, TemplateDay>

// ── Constants ─────────────────────────────────────────────────

// Distinct, evenly-spread hues for appointment types (services). Each entry
// pairs an accent (`main`, used for the left bar + text) with a soft tint
// (`light`, the pill background) so different services read at a glance.
// Services are mapped to a slot by their stable order within the org, so a
// given service always keeps the same color across weeks.
const SERVICE_PALETTE: ReadonlyArray<{ main: string; light: string }> = [
  { main: '#6366f1', light: '#eef2ff' }, // indigo
  { main: '#ec4899', light: '#fce7f3' }, // pink
  { main: '#14b8a6', light: '#f0fdfa' }, // teal
  { main: '#f59e0b', light: '#fffbeb' }, // amber
  { main: '#8b5cf6', light: '#f5f3ff' }, // violet
  { main: '#06b6d4', light: '#ecfeff' }, // cyan
  { main: '#ef4444', light: '#fef2f2' }, // red
  { main: '#10b981', light: '#ecfdf5' }, // emerald
  { main: '#f97316', light: '#fff7ed' }, // orange
  { main: '#3b82f6', light: '#eff6ff' }, // blue
]

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)

// Height of one hour row in px. Appointment pills are positioned and sized
// against this so a 90-minute booking visually spans 1.5 rows. Must match the
// row `minHeight` in the time-grid below.
const HOUR_HEIGHT = 60

// Intentional micro-type for the dense calendar grid pills — below the theme's
// caption (12px) so multiple appointments fit inside a tight hour cell.
const PILL_FONT = { primary: 11, secondary: 10 }

const TIME_OPTIONS = Array.from({ length: 31 }, (_, i) => {
  const mins = 7 * 60 + i * 30
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

// ── Helpers ───────────────────────────────────────────────────

function applyRestPeriods(
  base: Array<{ start: string; end: string }>,
  rests: RestPeriod[],
): Array<{ start: string; end: string }> {
  let ranges = [...base]
  for (const rest of rests) {
    const next: typeof ranges = []
    for (const r of ranges) {
      if (r.end <= rest.start || r.start >= rest.end) {
        next.push(r)
      } else {
        if (r.start < rest.start) next.push({ start: r.start, end: rest.start })
        if (r.end > rest.end) next.push({ start: rest.end, end: r.end })
      }
    }
    ranges = next
  }
  return ranges
}

function isHourRested(hour: number, rest: RestPeriod): boolean {
  const [sh, sm] = rest.start.split(':').map(Number)
  const [eh, em] = rest.end.split(':').map(Number)
  return hour * 60 < eh * 60 + em && (hour + 1) * 60 > sh * 60 + sm
}

// ── Component ─────────────────────────────────────────────────

export default function CalendarPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const theme = useTheme()

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [restToRemove, setRestToRemove] = useState<{ dateKey: string; idx: number } | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const [template, setTemplate] = useState<Template | null>(null)
  const [overrides, setOverrides] = useState<Record<string, DayOverride>>({})

  // Bookable members + the ones assignable to the selected appointment's service
  const [bookableMembers, setBookableMembers] = useState<StaffRef[]>([])
  const [assignableIds, setAssignableIds] = useState<string[]>([])

  // Org services, in their stable display order, used to assign a consistent
  // color per appointment type.
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([])

  // service_id → palette color. Keyed off the org's own service order so each
  // service keeps the same color regardless of which ones appear this week.
  const serviceColorMap = useMemo(() => {
    const map = new Map<string, { main: string; light: string }>()
    services.forEach((s, i) => map.set(s.id, SERVICE_PALETTE[i % SERVICE_PALETTE.length]))
    return map
  }, [services])

  const NEUTRAL = { main: theme.palette.grey[500], light: theme.palette.grey[100] }
  const serviceColors = (id: string) => serviceColorMap.get(id) ?? NEUTRAL

  // Legend entries: the distinct types actually present in the loaded week.
  const weekServices = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of appointments) {
      if (a.service_id && !seen.has(a.service_id)) {
        seen.set(a.service_id, a.services?.name ?? '—')
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [appointments])

  // Rest period dialog
  const [restDialog, setRestDialog] = useState(false)
  const [restDate, setRestDate] = useState('')
  const [restStart, setRestStart] = useState('13:00')
  const [restEnd, setRestEnd] = useState('14:00')
  const [restLabel, setRestLabel] = useState('')
  const [savingRest, setSavingRest] = useState(false)

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (org) loadTemplate()
  }, [org])

  useEffect(() => {
    if (org) loadWeek()
  }, [org, weekStart])

  async function loadTemplate() {
    if (!org) return
    const [tplRes, memRes, svcRes] = await Promise.all([
      supabase
        .from('working_hours_template')
        .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday')
        .eq('org_id', org.id)
        .single(),
      supabase
        .from('org_members')
        .select('id, display_name, title')
        .eq('org_id', org.id)
        .eq('is_bookable', true)
        .order('sort_order'),
      supabase
        .from('services')
        .select('id, name')
        .eq('org_id', org.id)
        .order('sort_order'),
    ])
    if (tplRes.data) setTemplate(tplRes.data as unknown as Template)
    setBookableMembers((memRes.data ?? []) as StaffRef[])
    setServices((svcRes.data ?? []) as Array<{ id: string; name: string }>)
  }

  // When an appointment is opened, load which members are assignable to its service.
  useEffect(() => {
    if (!selected) { setAssignableIds([]); return }
    supabase
      .from('service_staff')
      .select('member_id')
      .eq('service_id', selected.service_id)
      .then(({ data }) => setAssignableIds((data ?? []).map(r => (r as { member_id: string }).member_id)))
  }, [selected])

  async function reassignStaff(staffId: string | null) {
    if (!selected) return
    await supabase.from('appointments').update({ staff_id: staffId, updated_at: new Date().toISOString() }).eq('id', selected.id)
    const staff = staffId ? bookableMembers.find(m => m.id === staffId) ?? null : null
    setAppointments(prev => prev.map(a => a.id === selected.id ? { ...a, staff_id: staffId, staff } : a))
    setSelected(prev => prev ? { ...prev, staff_id: staffId, staff } : prev)
  }

  async function loadWeek() {
    if (!org) return
    setLoading(true)
    const weekEnd = addDays(weekStart, 7)

    const [apptRes, overrideRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('id, scheduled_at, duration_minutes, service_id, staff_id, status, payment_method, payment_status, notes, customers(first_name, last_name, phone_number), services(name, price), staff:org_members!appointments_staff_id_fkey(id, display_name, title)')
        .eq('org_id', org.id)
        .gte('scheduled_at', weekStart.toISOString())
        .lt('scheduled_at', weekEnd.toISOString())
        .not('status', 'in', '(rejected,cancelled)')
        .order('scheduled_at'),

      supabase
        .from('working_hours_overrides')
        .select('date, is_closed, ranges, note')
        .eq('org_id', org.id)
        .gte('date', format(weekStart, 'yyyy-MM-dd'))
        .lt('date', format(weekEnd, 'yyyy-MM-dd')),
    ])

    setAppointments((apptRes.data ?? []).map(row => {
      const r = row as Record<string, unknown>
      return {
        ...r,
        customers: pickOne(r.customers as never),
        services: pickOne(r.services as never),
        staff: pickOne(r.staff as never),
      }
    }) as unknown as Appointment[])

    const map: Record<string, DayOverride> = {}
    for (const row of (overrideRes.data ?? [])) {
      let rest_periods: RestPeriod[] = []
      try { rest_periods = JSON.parse(row.note ?? '{}').rest_periods ?? [] } catch {}
      map[row.date] = { is_closed: row.is_closed ?? false, ranges: row.ranges, rest_periods }
    }
    setOverrides(map)
    setLoading(false)
  }

  async function changeStatus(id: string, status: 'approved' | 'rejected') {
    setActionLoading(true)
    await supabase
      .from('appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    setActionLoading(false)
    setSelected(null)
    loadWeek()
  }

  function openRestDialog() {
    const todayKey = format(new Date(), 'yyyy-MM-dd')
    const isInWeek = days.some(d => format(d, 'yyyy-MM-dd') === todayKey)
    setRestDate(isInWeek ? todayKey : format(days[0], 'yyyy-MM-dd'))
    setRestStart('13:00')
    setRestEnd('14:00')
    setRestLabel('')
    setRestDialog(true)
  }

  async function addRestPeriod() {
    if (!org || !template || !restDate || restStart >= restEnd) return
    setSavingRest(true)

    const dateObj = new Date(restDate + 'T12:00:00')
    const dayKey = DAY_KEYS[dateObj.getDay()]
    const existing = overrides[restDate]
    const baseRanges = existing?.ranges ?? template[dayKey]?.ranges ?? []
    const existingRests = existing?.rest_periods ?? []

    const newRest: RestPeriod = { start: restStart, end: restEnd, label: restLabel.trim() || 'დასვენება' }
    const newRests = [...existingRests, newRest]
    const newRanges = applyRestPeriods(baseRanges, [newRest])

    await supabase.from('working_hours_overrides').upsert({
      org_id: org.id,
      date: restDate,
      is_closed: false,
      ranges: newRanges,
      note: JSON.stringify({ rest_periods: newRests }),
    }, { onConflict: 'org_id,date' })

    setSavingRest(false)
    setRestDialog(false)
    loadWeek()
  }

  async function removeRestPeriod(dateKey: string, idx: number) {
    if (!org || !template) return
    const existing = overrides[dateKey]
    if (!existing) return

    const dateObj = new Date(dateKey + 'T12:00:00')
    const dayKey = DAY_KEYS[dateObj.getDay()]
    const templateRanges = template[dayKey]?.ranges ?? []
    const remainingRests = existing.rest_periods.filter((_, i) => i !== idx)

    if (remainingRests.length === 0) {
      await supabase.from('working_hours_overrides')
        .delete().eq('org_id', org.id).eq('date', dateKey)
    } else {
      const newRanges = applyRestPeriods(templateRanges, remainingRests)
      await supabase.from('working_hours_overrides').upsert({
        org_id: org.id,
        date: dateKey,
        is_closed: false,
        ranges: newRanges,
        note: JSON.stringify({ rest_periods: remainingRests }),
      }, { onConflict: 'org_id,date' })
    }

    loadWeek()
  }

  function getApptForSlot(day: Date, hour: number): Appointment[] {
    return appointments.filter(a => {
      const d = new Date(a.scheduled_at)
      return isSameDay(d, day) && d.getHours() === hour
    })
  }

  function getRestsForSlot(day: Date, hour: number): Array<{ rest: RestPeriod; idx: number }> {
    const dateKey = format(day, 'yyyy-MM-dd')
    return (overrides[dateKey]?.rest_periods ?? [])
      .map((rest, idx) => ({ rest, idx }))
      .filter(({ rest }) => isHourRested(hour, rest))
  }

  const weekLabel = `${format(weekStart, 'd MMM', { locale: ka })} – ${format(addDays(weekStart, 6), 'd MMM yyyy', { locale: ka })}`

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {t('dashboard.calendar')}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<EventBusyOutlinedIcon />}
          onClick={openRestDialog}
          sx={{ borderRadius: 2 }}
        >
          დასვენება
        </Button>
        <Tooltip title="დღეს">
          <IconButton onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            <TodayIcon />
          </IconButton>
        </Tooltip>
        <IconButton onClick={() => setWeekStart(w => addWeeks(w, -1))}>
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 160, textAlign: 'center' }}>
          {weekLabel}
        </Typography>
        <IconButton onClick={() => setWeekStart(w => addWeeks(w, 1))}>
          <ArrowForwardIosIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Legend — one swatch per appointment type present this week, plus the
          pending accent (left bar) and rest period. */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        {weekServices.map(s => {
          const c = serviceColors(s.id)
          return (
            <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 16, height: 12, borderRadius: '3px', borderLeft: `3px solid ${c.main}`, bgcolor: c.light }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.name}</Typography>
            </Box>
          )
        })}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 16, height: 12, borderRadius: '3px', borderLeft: `3px solid ${theme.palette.warning.main}`, bgcolor: 'grey.50' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('dashboard.pending')} (დასადასტურებელი)</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 16, height: 12, borderRadius: '3px', borderLeft: '3px solid', borderLeftColor: 'grey.400', bgcolor: 'grey.100' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>დასვენება</Typography>
        </Box>
      </Stack>

      {/* Calendar grid */}
      <Card sx={{ overflow: 'auto' }}>
        {/* Day headers */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '56px repeat(7, 1fr)',
            minWidth: 640,
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 1,
          }}
        >
          <Box />
          {days.map((day, i) => {
            const isToday = isSameDay(day, new Date())
            return (
              <Box key={i} sx={{ py: 1.5, textAlign: 'center', borderLeft: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textTransform: 'capitalize' }}>
                  {format(day, 'EEE', { locale: ka })}
                </Typography>
                <Box sx={{
                  width: 28, height: 28, borderRadius: '50%',
                  bgcolor: isToday ? 'primary.main' : 'transparent',
                  color: isToday ? 'white' : 'text.primary',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  mx: 'auto', mt: 0.25,
                }}>
                  <Typography variant="body2" sx={{ fontWeight: isToday ? 700 : 400, lineHeight: 1 }}>
                    {format(day, 'd')}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>

        {/* Time rows */}
        {loading
          ? <LoadingState />
          : HOURS.map(hour => (
            <Box
              key={hour}
              sx={{
                display: 'grid',
                gridTemplateColumns: '56px repeat(7, 1fr)',
                minWidth: 640,
                minHeight: 60,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ pt: 0.5, pr: 1, textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1 }}>
                  {String(hour).padStart(2, '0')}:00
                </Typography>
              </Box>

              {days.map((day, di) => {
                const slotAppts = getApptForSlot(day, hour)
                const slotRests = getRestsForSlot(day, hour)

                return (
                  <Box
                    key={di}
                    sx={{
                      position: 'relative',
                      borderLeft: '1px solid',
                      borderColor: 'divider',
                      p: 0.5,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.5,
                    }}
                  >
                    {/* Appointment pills — absolutely positioned so their height
                        reflects duration and they span across hour rows. Pills
                        sharing a start hour are laid out side by side. */}
                    {slotAppts.map((appt, idx) => {
                      // Background reflects the appointment type (service); the
                      // left bar turns orange for pending bookings so the ones
                      // needing action still stand out against any type color.
                      const c = serviceColors(appt.service_id)
                      const isPending = appt.status === 'pending'
                      const accent = isPending ? theme.palette.warning.main : c.main
                      const start = new Date(appt.scheduled_at)
                      const top = (start.getMinutes() / 60) * HOUR_HEIGHT
                      const height = Math.max(16, (appt.duration_minutes / 60) * HOUR_HEIGHT - 2)
                      const widthPct = 100 / slotAppts.length
                      return (
                        <Tooltip
                          key={appt.id}
                          title={`${appt.customers?.first_name} ${appt.customers?.last_name ?? ''} · ${appt.services?.name}${appt.staff?.display_name ? ` · ${appt.staff.display_name}` : ''}`}
                          placement="top"
                        >
                          <Box
                            onClick={() => setSelected(appt)}
                            sx={{
                              position: 'absolute',
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${idx * widthPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              zIndex: 2,
                              borderRadius: '5px',
                              borderLeft: `3px solid ${accent}`,
                              bgcolor: c.light,
                              px: 0.75, py: 0.4,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              transition: 'filter 0.15s, box-shadow 0.15s',
                              '&:hover': {
                                filter: 'brightness(0.94)',
                                boxShadow: `0 2px 8px ${accent}50`,
                                zIndex: 3,
                              },
                            }}
                          >
                            <Typography sx={{ fontWeight: 700, color: c.main, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: PILL_FONT.primary, lineHeight: 1.4 }}>
                              {format(new Date(appt.scheduled_at), 'HH:mm')} {appt.customers?.first_name}
                            </Typography>
                            <Typography sx={{ color: c.main, opacity: 0.75, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: PILL_FONT.secondary, lineHeight: 1.3 }}>
                              {appt.services?.name}{appt.staff?.display_name ? ` · ${appt.staff.display_name}` : ''}
                            </Typography>
                          </Box>
                        </Tooltip>
                      )
                    })}

                    {/* Rest period pills */}
                    {slotRests.map(({ rest, idx }) => (
                      <Box
                        key={idx}
                        sx={{
                          width: '100%',
                          borderRadius: '5px',
                          borderLeft: '3px solid',
                          borderLeftColor: 'grey.300',
                          bgcolor: 'grey.50',
                          px: 0.75, py: 0.4,
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          '&:hover .rest-del': { opacity: 1 },
                        }}
                      >
                        <Box sx={{ flex: 1, overflow: 'hidden' }}>
                          <Typography sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: PILL_FONT.primary, lineHeight: 1.4 }}>
                            {rest.label}
                          </Typography>
                          <Typography sx={{ color: 'text.secondary', display: 'block', fontSize: PILL_FONT.secondary, lineHeight: 1.3 }}>
                            {rest.start}–{rest.end}
                          </Typography>
                        </Box>
                        <Box
                          className="rest-del"
                          role="button"
                          aria-label={t('common.delete')}
                          onClick={() => setRestToRemove({ dateKey: format(day, 'yyyy-MM-dd'), idx })}
                          sx={{
                            opacity: 0,
                            transition: 'opacity 0.15s',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            flexShrink: 0,
                            borderRadius: '50%',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.06)' },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )
              })}
            </Box>
          ))
        }
      </Card>

      {/* Appointment detail drawer */}
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { width: 340, p: 3 } } }}
      >
        {selected && (
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              {selected.customers?.first_name} {selected.customers?.last_name}
            </Typography>
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>სერვისი</Typography>
                <Typography variant="body2">{selected.services?.name} — {selected.services?.price} ₾</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>დრო</Typography>
                <Typography variant="body2">
                  {format(new Date(selected.scheduled_at), 'dd MMM yyyy, HH:mm')}
                  {' · '}{selected.duration_minutes} წთ
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>ტელეფონი</Typography>
                <Typography variant="body2">{selected.customers?.phone_number}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>გადახდა</Typography>
                <Typography variant="body2">
                  {selected.payment_method === 'online' ? 'ონლაინ' : 'ადგილზე'} ·{' '}
                  {selected.payment_status === 'paid' ? '✓ გადახდილია' : 'გადაუხდელი'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>სტატუსი</Typography>
                <Box sx={{ mt: 0.5 }}>
                  <StatusChip status={selected.status} />
                </Box>
              </Box>
              {(() => {
                const options = bookableMembers.filter(m => assignableIds.includes(m.id))
                if (options.length === 0) return null
                return (
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('dashboard.staff')}</InputLabel>
                    <Select
                      value={selected.staff_id ?? ''}
                      label={t('dashboard.staff')}
                      onChange={e => reassignStaff(e.target.value === '' ? null : e.target.value)}
                    >
                      <MenuItem value=""><em>{t('dashboard.unassigned')}</em></MenuItem>
                      {options.map(m => (
                        <MenuItem key={m.id} value={m.id}>{m.display_name || '—'}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )
              })()}
              {selected.notes && (
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>შენიშვნა</Typography>
                  <Typography variant="body2">{selected.notes}</Typography>
                </Box>
              )}
            </Stack>

            {selected.status === 'pending' && (
              <Stack spacing={1} sx={{ mt: 4 }}>
                <Button fullWidth variant="contained" color="success" onClick={() => changeStatus(selected.id, 'approved')} disabled={actionLoading}>
                  {actionLoading ? <CircularProgress size={20} color="inherit" /> : t('dashboard.approve')}
                </Button>
                <Button fullWidth variant="outlined" color="error" onClick={() => changeStatus(selected.id, 'rejected')} disabled={actionLoading}>
                  {t('dashboard.reject')}
                </Button>
              </Stack>
            )}

            <Button fullWidth variant="text" sx={{ mt: 2 }} onClick={() => setSelected(null)}>
              {t('common.cancel')}
            </Button>
          </Box>
        )}
      </Drawer>

      {/* Add Rest Period dialog */}
      <Dialog open={restDialog} onClose={() => setRestDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>დასვენების პერიოდი</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 0.5 }}>
            <FormControl fullWidth size="small">
              <InputLabel>დღე</InputLabel>
              <Select value={restDate} label="დღე" onChange={e => setRestDate(e.target.value)}>
                {days.map(day => (
                  <MenuItem key={format(day, 'yyyy-MM-dd')} value={format(day, 'yyyy-MM-dd')}>
                    {format(day, 'EEEE, d MMM', { locale: ka })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>დაწყება</InputLabel>
                <Select value={restStart} label="დაწყება" onChange={e => setRestStart(e.target.value)}>
                  {TIME_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>დასრულება</InputLabel>
                <Select value={restEnd} label="დასრულება" onChange={e => setRestEnd(e.target.value)}>
                  {TIME_OPTIONS.filter(t => t > restStart).map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>

            <TextField
              fullWidth size="small"
              label="სახელი (არასავალდებულო)"
              placeholder="მაგ: სადილი, შესვენება"
              value={restLabel}
              onChange={e => setRestLabel(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRestDialog(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={addRestPeriod}
            disabled={savingRest || !restDate || restStart >= restEnd}
          >
            {savingRest ? <CircularProgress size={18} color="inherit" /> : 'დამატება'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm rest-period removal */}
      <ConfirmDialog
        open={!!restToRemove}
        title={t('common.confirmDeleteTitle')}
        message={t('common.confirmDeleteMessage')}
        confirmLabel={t('common.delete')}
        onClose={() => setRestToRemove(null)}
        onConfirm={() => {
          if (restToRemove) removeRestPeriod(restToRemove.dateKey, restToRemove.idx)
          setRestToRemove(null)
        }}
      />
    </Box>
  )
}
