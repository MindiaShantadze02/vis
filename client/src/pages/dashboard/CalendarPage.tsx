import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, IconButton, Card, Tooltip,
  Stack, Button, CircularProgress, useTheme,
  Select, MenuItem, FormControl, InputLabel, TextField,
} from '@mui/material'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { ArrowForwardIos as ArrowForwardIosIcon } from '@/components/icons'
import { Today as TodayIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { Close as CloseIcon } from '@/components/icons'
import { format, startOfWeek, startOfDay, addDays, isSameDay } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { anim } from '@/theme/animations'
import { StatusChip, ConfirmDialog, LoadingState, useToast, SideDrawer } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'

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

/** A bucket of appointments of the SAME service whose times overlap, collapsed
 *  into one counted calendar pill so simultaneous bookings of one type don't
 *  clutter the slot. `col`/`cols` place it in an overlap-packed column so pills
 *  that don't actually overlap each get full width. */
interface ApptGroup {
  key: string
  service_id: string
  appts: Appointment[]
  start: Date
  endMs: number
  durationMin: number
  col: number
  cols: number
}

/** Merge same-service appointments with overlapping time ranges into groups. */
function mergeSameServiceOverlap(appts: Appointment[]): ApptGroup[] {
  const byService = new Map<string, Appointment[]>()
  for (const a of appts) {
    const arr = byService.get(a.service_id)
    if (arr) arr.push(a)
    else byService.set(a.service_id, [a])
  }

  const groups: ApptGroup[] = []
  for (const [service_id, list] of byService) {
    const sorted = [...list].sort(
      (x, y) => new Date(x.scheduled_at).getTime() - new Date(y.scheduled_at).getTime(),
    )
    let cur: { startMs: number; endMs: number; appts: Appointment[] } | null = null
    const push = () => {
      if (!cur) return
      groups.push({
        key: `${service_id}__${cur.startMs}`,
        service_id,
        appts: cur.appts,
        start: new Date(cur.startMs),
        endMs: cur.endMs,
        durationMin: Math.round((cur.endMs - cur.startMs) / 60000),
        col: 0,
        cols: 1,
      })
    }
    for (const a of sorted) {
      const s = new Date(a.scheduled_at).getTime()
      const e = s + a.duration_minutes * 60000
      if (cur && s < cur.endMs) {
        cur.appts.push(a)
        cur.endMs = Math.max(cur.endMs, e)
      } else {
        push()
        cur = { startMs: s, endMs: e, appts: [a] }
      }
    }
    push()
  }
  return groups
}

/** Assign each group an overlap-packed column (col of cols). Groups that never
 *  overlap reuse a lane, so a non-overlapping group spans the full width. */
function assignColumns(groups: ApptGroup[]): void {
  const sorted = [...groups].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.endMs - b.endMs,
  )
  let cluster: ApptGroup[] = []
  let lanes: number[] = [] // lane index → last end (ms)
  let clusterMaxEnd = -1

  const flush = () => {
    for (const g of cluster) g.cols = lanes.length || 1
    cluster = []
    lanes = []
    clusterMaxEnd = -1
  }

  for (const g of sorted) {
    if (clusterMaxEnd !== -1 && g.start.getTime() >= clusterMaxEnd) flush()
    let placed = false
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] <= g.start.getTime()) {
        lanes[i] = g.endMs
        g.col = i
        placed = true
        break
      }
    }
    if (!placed) {
      g.col = lanes.length
      lanes.push(g.endMs)
    }
    clusterMaxEnd = Math.max(clusterMaxEnd, g.endMs)
    cluster.push(g)
  }
  flush()
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
  const toast = useToast()
  const { org } = useOrg()
  const theme = useTheme()
  const { isMobile } = useBreakpoints()

  // Desktop shows the full 7-day week grid. Mobile switches to a single-day
  // timeline (iOS-style) driven by `selectedDay`, with a tappable week strip
  // above it. Either way a whole week of data is loaded at once.
  const dayCount = 7

  // Desktop pages by week from here (Monday-first).
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  )
  // Mobile: the focused day. The visible week strip is the week containing it.
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
  const [restToRemove, setRestToRemove] = useState<{ dateKey: string; idx: number } | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Appointment | null>(null)
  // When a multi-appointment pill is opened, the drawer first shows this list;
  // picking one sets `selected` and the back arrow returns here.
  const [group, setGroup] = useState<Appointment[] | null>(null)
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

  // The week currently loaded/shown. Desktop pages by week from `weekStart`
  // (Mon-first); mobile follows `selectedDay` (Sun-first strip, matching iOS).
  const mobileWeekStart = useMemo(() => startOfWeek(selectedDay, { weekStartsOn: 0 }), [selectedDay])
  const loadStart = isMobile ? mobileWeekStart : weekStart
  const days = Array.from({ length: dayCount }, (_, i) => addDays(loadStart, i))

  useEffect(() => {
    if (org) loadTemplate()
  }, [org])

  useEffect(() => {
    if (org) loadWeek()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, loadStart.getTime(), dayCount])

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
    const weekEnd = addDays(loadStart, dayCount)

    const [apptRes, overrideRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('id, scheduled_at, duration_minutes, service_id, staff_id, status, payment_method, payment_status, notes, customers(first_name, last_name, phone_number), services(name, price), staff:org_members!appointments_staff_id_fkey(id, display_name, title)')
        .eq('org_id', org.id)
        .gte('scheduled_at', loadStart.toISOString())
        .lt('scheduled_at', weekEnd.toISOString())
        .not('status', 'in', '(rejected,cancelled)')
        .order('scheduled_at'),

      supabase
        .from('working_hours_overrides')
        .select('date, is_closed, ranges, note')
        .eq('org_id', org.id)
        .gte('date', format(loadStart, 'yyyy-MM-dd'))
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
    setGroup(null)
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
    if (!org || !template) return
    if (!restDate) { toast.error(t('validation.required')); return }
    if (restStart >= restEnd) { toast.error(t('validation.endBeforeStart')); return }
    setSavingRest(true)

    const dateObj = new Date(restDate + 'T12:00:00')
    const dayKey = DAY_KEYS[dateObj.getDay()]
    const existing = overrides[restDate]
    const baseRanges = existing?.ranges ?? template[dayKey]?.ranges ?? []
    const existingRests = existing?.rest_periods ?? []

    const newRest: RestPeriod = { start: restStart, end: restEnd, label: restLabel.trim() || t('calendar.rest') }
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

  // Overlap-merged, column-packed groups per day. Computed once per week load:
  // same-service overlapping bookings collapse into one counted pill, and groups
  // get overlap-aware columns so non-overlapping ones span the full slot width.
  const groupsByDay = useMemo(() => {
    const byDay = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const k = format(new Date(a.scheduled_at), 'yyyy-MM-dd')
      const arr = byDay.get(k)
      if (arr) arr.push(a)
      else byDay.set(k, [a])
    }
    const out = new Map<string, ApptGroup[]>()
    for (const [k, list] of byDay) {
      const groups = mergeSameServiceOverlap(list)
      assignColumns(groups)
      out.set(k, groups)
    }
    return out
  }, [appointments])

  // Groups whose pill renders in this hour cell (positioned at their start).
  function getGroupsForSlot(day: Date, hour: number): ApptGroup[] {
    const k = format(day, 'yyyy-MM-dd')
    return (groupsByDay.get(k) ?? []).filter(g => g.start.getHours() === hour)
  }

  function getRestsForSlot(day: Date, hour: number): Array<{ rest: RestPeriod; idx: number }> {
    const dateKey = format(day, 'yyyy-MM-dd')
    return (overrides[dateKey]?.rest_periods ?? [])
      .map((rest, idx) => ({ rest, idx }))
      .filter(({ rest }) => isHourRested(hour, rest))
  }

  const weekLabel = `${format(loadStart, 'd MMM', { locale: dateLocale() })} – ${format(addDays(loadStart, dayCount - 1), 'd MMM yyyy', { locale: dateLocale() })}`

  // True when [hour, hour+1) lies fully outside the day's working ranges, so
  // closed time can be shaded and the open schedule reads at a glance. An
  // hour that's even partially open stays unshaded (pills already show detail).
  function isHourClosed(day: Date, hour: number): boolean {
    if (!template) return false
    const ov = overrides[format(day, 'yyyy-MM-dd')]
    if (ov?.is_closed) return true
    const dayCfg = template[DAY_KEYS[day.getDay()]]
    const ranges = ov?.ranges ?? (dayCfg?.open ? dayCfg.ranges : [])
    const hStart = hour * 60
    const hEnd = hStart + 60
    return !ranges.some(r => {
      const [sh, sm] = r.start.split(':').map(Number)
      const [eh, em] = r.end.split(':').map(Number)
      return sh * 60 + sm < hEnd && eh * 60 + em > hStart
    })
  }

  return (
    <Box>
      {/* Header — desktop toolbar. */}
      {!isMobile && (
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
          data-testid="cal-rest-btn"
        >
          {t('calendar.rest')}
        </Button>
        {/* Date-navigation cluster — today, prev, week label, next kept together
            as one non-wrapping unit so the arrows never orphan onto their own
            row on narrow screens. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Tooltip title={t('calendar.today')}>
            <IconButton size="small" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} data-testid="cal-today">
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => setWeekStart(w => addDays(w, -dayCount))} data-testid="cal-prev">
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
          <Typography variant="body2" sx={{ fontWeight: 500, minWidth: { xs: 96, sm: 160 }, textAlign: 'center', fontSize: { xs: '0.8rem', sm: '0.875rem' } }} data-testid="cal-week-label">
            {weekLabel}
          </Typography>
          <IconButton size="small" onClick={() => setWeekStart(w => addDays(w, dayCount))} data-testid="cal-next">
            <ArrowForwardIosIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      )}

      {/* Header — mobile single-day: title + actions, month nav, tappable week
          strip, then the focused day's title. */}
      {isMobile && (
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
            {t('dashboard.calendar')}
          </Typography>
          <Tooltip title={t('calendar.rest')}>
            <IconButton onClick={openRestDialog} data-testid="cal-rest-btn">
              <EventBusyOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Month nav — arrows step one day; today resets to now. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
          <IconButton size="small" onClick={() => setSelectedDay(d => addDays(d, -1))} data-testid="cal-prev">
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
          <Typography variant="subtitle1" sx={{ flex: 1, textAlign: 'center', fontWeight: 700, textTransform: 'capitalize' }} data-testid="cal-week-label">
            {format(selectedDay, 'LLLL yyyy', { locale: dateLocale() })}
          </Typography>
          <IconButton size="small" onClick={() => setSelectedDay(d => addDays(d, 1))} data-testid="cal-next">
            <ArrowForwardIosIcon fontSize="small" />
          </IconButton>
          <Tooltip title={t('calendar.today')}>
            <IconButton size="small" onClick={() => setSelectedDay(startOfDay(new Date()))} data-testid="cal-today">
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Week strip (Sun-first) — tap a day to focus it. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 1.5 }}>
          {days.map((day, i) => {
            const isSel = isSameDay(day, selectedDay)
            const isToday = isSameDay(day, new Date())
            return (
              <Box
                key={i}
                onClick={() => setSelectedDay(startOfDay(day))}
                data-testid="cal-strip-day"
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, py: 0.5, cursor: 'pointer' }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase' }}>
                  {format(day, 'EEEEE', { locale: dateLocale() })}
                </Typography>
                <Box sx={{
                  width: 34, height: 34, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: isSel ? 'primary.main' : 'transparent',
                  color: isSel ? '#fff' : (isToday ? 'primary.main' : 'text.primary'),
                  transition: 'background-color .15s',
                }}>
                  <Typography variant="body2" sx={{ fontWeight: isSel || isToday ? 700 : 500 }}>
                    {format(day, 'd')}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>

        <Typography variant="subtitle2" sx={{ textAlign: 'center', fontWeight: 700, textTransform: 'capitalize' }} data-testid="cal-day-title">
          {format(selectedDay, 'EEEE, d MMM yyyy', { locale: dateLocale() })}
        </Typography>
      </Box>
      )}

      {/* Legend — one swatch per appointment type present this week, plus the
          pending accent (left bar) and rest period. Desktop only; on mobile the
          single-day pills already carry their labels. */}
      {!isMobile && (
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
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('dashboard.pending')} ({t('calendar.toApprove')})</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 16, height: 12, borderRadius: '3px', borderLeft: '3px solid', borderLeftColor: 'grey.400', bgcolor: 'grey.100' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.rest')}</Typography>
        </Box>
      </Stack>
      )}

      {/* Desktop calendar grid (7-day week). Mobile uses the single-day timeline
          rendered below instead. */}
      {!isMobile && (
      <Card sx={{ overflow: 'auto' }}>
        {/* Day headers */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `56px repeat(${dayCount}, 1fr)`,
            minWidth: isMobile ? 'auto' : 640,
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
                  {format(day, 'EEE', { locale: dateLocale() })}
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
                gridTemplateColumns: `56px repeat(${dayCount}, 1fr)`,
                minWidth: isMobile ? 'auto' : 640,
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
                const slotGroups = getGroupsForSlot(day, hour)
                const slotRests = getRestsForSlot(day, hour)
                const closed = isHourClosed(day, hour)

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
                      // Closed time is hatched grey so gaps in the working
                      // schedule are visible without opening settings.
                      ...(closed && {
                        bgcolor: 'grey.50',
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(30,36,51,0.03) 5px, rgba(30,36,51,0.03) 10px)',
                      }),
                    }}
                  >
                    {/* Appointment pills — absolutely positioned so their height
                        reflects duration and they span across hour rows. Same-
                        service overlapping bookings collapse into one counted
                        pill; overlap-packed columns keep distinct/parallel
                        bookings side by side without cramping the rest. */}
                    {slotGroups.map((g) => {
                      // Background reflects the appointment type (service); the
                      // left bar turns orange when any booking in the group is
                      // pending so the ones needing action still stand out.
                      const first = g.appts[0]
                      const count = g.appts.length
                      const isGroup = count > 1
                      const c = serviceColors(g.service_id)
                      const hasPending = g.appts.some(a => a.status === 'pending')
                      const accent = hasPending ? theme.palette.warning.main : c.main
                      const start = g.start
                      const top = (start.getMinutes() / 60) * HOUR_HEIGHT
                      const height = Math.max(16, (g.durationMin / 60) * HOUR_HEIGHT - 2)
                      const widthPct = 100 / g.cols
                      const staffName = first.staff?.display_name
                      const tooltip = isGroup
                        ? `${first.services?.name} · ${t('calendar.apptsCount', { count })}`
                        : `${first.customers?.first_name} ${first.customers?.last_name ?? ''} · ${first.services?.name}${staffName ? ` · ${staffName}` : ''}`
                      return (
                        <Tooltip key={g.key} title={tooltip} placement="top">
                          <Box
                            onClick={() => isGroup ? setGroup(g.appts) : setSelected(first)}
                            data-testid={isGroup ? 'cal-appt-group' : 'cal-appt'}
                            sx={{
                              position: 'absolute',
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${g.col * widthPct}% + 2px)`,
                              width: `calc(${widthPct}% - 4px)`,
                              zIndex: 2,
                              borderRadius: '5px',
                              borderLeft: `3px solid ${accent}`,
                              bgcolor: c.light,
                              px: 0.75, py: 0.4,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              animation: anim.scaleIn,
                              transition: 'filter 0.15s, box-shadow 0.15s',
                              '&:hover': {
                                filter: 'brightness(0.94)',
                                boxShadow: `0 2px 8px ${accent}50`,
                                zIndex: 3,
                              },
                            }}
                          >
                            {isGroup ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography sx={{ flex: 1, fontWeight: 700, color: c.main, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: PILL_FONT.primary, lineHeight: 1.4 }}>
                                  {format(start, 'HH:mm')} {first.services?.name}
                                </Typography>
                                <Box sx={{ flexShrink: 0, bgcolor: c.main, color: '#fff', borderRadius: '999px', px: 0.6, minWidth: 16, textAlign: 'center', fontSize: PILL_FONT.secondary, fontWeight: 700, lineHeight: 1.6 }}>
                                  ×{count}
                                </Box>
                              </Box>
                            ) : (
                              <>
                                <Typography sx={{ fontWeight: 700, color: c.main, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: PILL_FONT.primary, lineHeight: 1.4 }}>
                                  {format(start, 'HH:mm')} {first.customers?.first_name}
                                </Typography>
                                <Typography sx={{ color: c.main, opacity: 0.75, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: PILL_FONT.secondary, lineHeight: 1.3 }}>
                                  {first.services?.name}{staffName ? ` · ${staffName}` : ''}
                                </Typography>
                              </>
                            )}
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
      )}

      {/* Mobile single-day timeline — hour rows with the focused day's pills,
          rests, and a live "now" indicator overlaid at their time positions. */}
      {isMobile && (
      <Card>
        {loading ? <LoadingState /> : (() => {
          const DAY_START = HOURS[0]
          const dayKey = format(selectedDay, 'yyyy-MM-dd')
          const dayGroups = groupsByDay.get(dayKey) ?? []
          const dayRests = overrides[dayKey]?.rest_periods ?? []
          const now = new Date()
          const showNow = isSameDay(selectedDay, now)
          const nowMin = (now.getHours() - DAY_START) * 60 + now.getMinutes()
          const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' } as const
          const GUTTER = 56
          return (
            <Box sx={{ position: 'relative', py: 1 }}>
              {/* Hour rows — labels in the gutter, a hairline per hour. */}
              {HOURS.map(hour => {
                const closed = isHourClosed(selectedDay, hour)
                return (
                  <Box
                    key={hour}
                    sx={{
                      display: 'flex', height: HOUR_HEIGHT,
                      ...(closed && {
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(30,36,51,0.03) 5px, rgba(30,36,51,0.03) 10px)',
                      }),
                    }}
                  >
                    <Box sx={{ width: GUTTER, flexShrink: 0, pr: 1, textAlign: 'right', mt: '-7px' }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {String(hour).padStart(2, '0')}:00
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, borderTop: '1px solid', borderColor: 'divider' }} />
                  </Box>
                )
              })}

              {/* Overlay layer, aligned to the 08:00 line and the gutter edge. */}
              <Box sx={{ position: 'absolute', top: 8, left: GUTTER, right: 8, bottom: 8 }}>
                {/* Rest periods (behind appointments). */}
                {dayRests.map((rest, idx) => {
                  const [sh, sm] = rest.start.split(':').map(Number)
                  const [eh, em] = rest.end.split(':').map(Number)
                  const startMin = sh * 60 + sm - DAY_START * 60
                  const endMin = eh * 60 + em - DAY_START * 60
                  const top = Math.max(0, (startMin / 60) * HOUR_HEIGHT)
                  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2)
                  return (
                    <Box
                      key={idx}
                      sx={{
                        position: 'absolute', top, height, left: 0, right: 0, zIndex: 1,
                        borderRadius: '6px', borderLeft: '3px solid', borderLeftColor: 'grey.300',
                        bgcolor: 'grey.50', px: 1, py: 0.5,
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        '&:hover .rest-del': { opacity: 1 },
                      }}
                    >
                      <Box sx={{ flex: 1, overflow: 'hidden' }}>
                        <Typography sx={{ fontWeight: 600, color: 'text.secondary', ...ellipsis, fontSize: 12 }}>{rest.label}</Typography>
                        <Typography sx={{ color: 'text.secondary', fontSize: 11 }}>{rest.start}–{rest.end}</Typography>
                      </Box>
                      <Box
                        className="rest-del"
                        role="button"
                        aria-label={t('common.delete')}
                        onClick={() => setRestToRemove({ dateKey: dayKey, idx })}
                        sx={{ opacity: 0, transition: 'opacity .15s', cursor: 'pointer', display: 'flex', flexShrink: 0 }}
                      >
                        <CloseIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      </Box>
                    </Box>
                  )
                })}

                {/* Appointment pills. */}
                {dayGroups.map(g => {
                  const first = g.appts[0]
                  const count = g.appts.length
                  const isGroup = count > 1
                  const c = serviceColors(g.service_id)
                  const hasPending = g.appts.some(a => a.status === 'pending')
                  const accent = hasPending ? theme.palette.warning.main : c.main
                  const startMin = (g.start.getHours() - DAY_START) * 60 + g.start.getMinutes()
                  const top = Math.max(0, (startMin / 60) * HOUR_HEIGHT)
                  const height = Math.max(26, (g.durationMin / 60) * HOUR_HEIGHT - 2)
                  const widthPct = 100 / g.cols
                  const staffName = first.staff?.display_name
                  return (
                    <Box
                      key={g.key}
                      onClick={() => isGroup ? setGroup(g.appts) : setSelected(first)}
                      data-testid={isGroup ? 'cal-appt-group' : 'cal-appt'}
                      sx={{
                        position: 'absolute', top, height,
                        left: `calc(${g.col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        zIndex: 2,
                        borderRadius: '6px', borderLeft: `3px solid ${accent}`,
                        bgcolor: c.light, px: 1, py: 0.5,
                        overflow: 'hidden', cursor: 'pointer', animation: anim.scaleIn,
                        transition: 'filter .15s',
                        '&:hover': { filter: 'brightness(0.96)' },
                      }}
                    >
                      {isGroup ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography sx={{ flex: 1, fontWeight: 700, color: c.main, ...ellipsis, fontSize: 12.5, lineHeight: 1.4 }}>
                            {format(g.start, 'HH:mm')} {first.services?.name}
                          </Typography>
                          <Box sx={{ flexShrink: 0, bgcolor: c.main, color: '#fff', borderRadius: '999px', px: 0.7, fontSize: 10.5, fontWeight: 700 }}>
                            ×{count}
                          </Box>
                        </Box>
                      ) : (
                        <>
                          <Typography sx={{ fontWeight: 700, color: c.main, ...ellipsis, fontSize: 12.5, lineHeight: 1.4 }}>
                            {format(g.start, 'HH:mm')} {first.customers?.first_name} {first.customers?.last_name ?? ''}
                          </Typography>
                          <Typography sx={{ color: c.main, opacity: 0.8, ...ellipsis, fontSize: 11.5 }}>
                            {first.services?.name}{staffName ? ` · ${staffName}` : ''}
                          </Typography>
                        </>
                      )}
                    </Box>
                  )
                })}

                {/* Live "now" indicator — only when viewing today and in-window. */}
                {showNow && nowMin >= 0 && nowMin <= HOURS.length * 60 && (
                  <Box sx={{ position: 'absolute', top: (nowMin / 60) * HOUR_HEIGHT, left: -GUTTER, right: 0, display: 'flex', alignItems: 'center', zIndex: 3, pointerEvents: 'none' }}>
                    <Box sx={{ width: GUTTER - 6, textAlign: 'right', pr: 0.5 }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'error.main' }}>{format(now, 'HH:mm')}</Typography>
                    </Box>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 }} />
                    <Box sx={{ flex: 1, height: '2px', bgcolor: 'error.main' }} />
                  </Box>
                )}
              </Box>
            </Box>
          )
        })()}
      </Card>
      )}

      {/* Appointment detail drawer */}
      <SideDrawer
        open={!!selected || !!group}
        onClose={() => { setSelected(null); setGroup(null) }}
        title={
          selected
            ? `${selected.customers?.first_name ?? ''} ${selected.customers?.last_name ?? ''}`
            : group ? (group[0].services?.name ?? '') : ''
        }
        headerStart={selected && group ? (
          <IconButton size="small" onClick={() => setSelected(null)} aria-label={t('common.back')} sx={{ ml: -1 }}>
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
        ) : undefined}
        actions={selected && selected.status === 'pending' ? (
          <>
            <Button variant="outlined" color="error" onClick={() => changeStatus(selected.id, 'rejected')} disabled={actionLoading} data-testid="cal-reject">
              {t('dashboard.reject')}
            </Button>
            <Button variant="contained" color="success" onClick={() => changeStatus(selected.id, 'approved')} disabled={actionLoading} data-testid="cal-approve">
              {actionLoading ? <CircularProgress size={20} color="inherit" /> : t('dashboard.approve')}
            </Button>
          </>
        ) : undefined}
      >
        {/* Group list — shown for a multi-appointment slot until one is picked. */}
        {group && !selected && (
          <Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {format(new Date(group[0].scheduled_at), 'dd MMM yyyy, HH:mm', { locale: dateLocale() })}
              {' · '}{t('calendar.apptsCount', { count: group.length })}
            </Typography>
            <Stack spacing={1}>
              {group.map(a => (
                <Box
                  key={a.id}
                  onClick={() => setSelected(a)}
                  data-testid="cal-group-item"
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1, p: 1.5,
                    borderRadius: 2, border: '1px solid', borderColor: 'divider',
                    cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.customers?.first_name} {a.customers?.last_name ?? ''}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {format(new Date(a.scheduled_at), 'HH:mm')}{a.staff?.display_name ? ` · ${a.staff.display_name}` : ''}
                    </Typography>
                  </Box>
                  <StatusChip status={a.status} />
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        {selected && (
          <Box>
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.service')}</Typography>
                <Typography variant="body2">{selected.services?.name} — {selected.services?.price} ₾</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.time')}</Typography>
                <Typography variant="body2">
                  {format(new Date(selected.scheduled_at), 'dd MMM yyyy, HH:mm', { locale: dateLocale() })}
                  {' · '}{selected.duration_minutes} {t('common.minutesShort')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.phone')}</Typography>
                <Typography variant="body2">{selected.customers?.phone_number}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.payment')}</Typography>
                <Typography variant="body2">
                  {selected.payment_method === 'online' ? t('settings.locationOnline') : t('settings.locationInPerson')} ·{' '}
                  {selected.payment_status === 'refunded'
                    ? t('calendar.refunded')
                    : selected.payment_status === 'paid' ? t('calendar.paid') : t('calendar.unpaid')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.status')}</Typography>
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
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.note')}</Typography>
                  <Typography variant="body2">{selected.notes}</Typography>
                </Box>
              )}
            </Stack>
          </Box>
        )}
      </SideDrawer>

      {/* Add Rest Period drawer */}
      <SideDrawer
        open={restDialog}
        onClose={() => setRestDialog(false)}
        disableClose={savingRest}
        title={t('calendar.restPeriod')}
        actions={
          <>
            <Button onClick={() => setRestDialog(false)} disabled={savingRest}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={addRestPeriod} disabled={savingRest}>
              {savingRest ? <CircularProgress size={18} color="inherit" /> : t('common.add')}
            </Button>
          </>
        }
      >
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('calendar.day')}</InputLabel>
              <Select value={restDate} label={t('calendar.day')} onChange={e => setRestDate(e.target.value)}>
                {days.map(day => (
                  <MenuItem key={format(day, 'yyyy-MM-dd')} value={format(day, 'yyyy-MM-dd')}>
                    {format(day, 'EEEE, d MMM', { locale: dateLocale() })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('calendar.start')}</InputLabel>
                <Select value={restStart} label={t('calendar.start')} onChange={e => setRestStart(e.target.value)}>
                  {TIME_OPTIONS.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('calendar.end')}</InputLabel>
                <Select value={restEnd} label={t('calendar.end')} onChange={e => setRestEnd(e.target.value)}>
                  {TIME_OPTIONS.filter(opt => opt > restStart).map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>

            <TextField
              fullWidth size="small"
              label={t('calendar.nameOptional')}
              placeholder={t('calendar.restPlaceholder')}
              value={restLabel}
              onChange={e => setRestLabel(e.target.value)}
            />
        </Stack>
      </SideDrawer>

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
