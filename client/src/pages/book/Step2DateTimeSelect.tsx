import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Button, Chip, IconButton,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import {
  format, addDays, startOfDay, isBefore, isAfter, isSameDay, isSameMonth,
} from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { dateLocale } from '@/lib/dateLocale'
import { useTheme, alpha } from '@mui/material/styles'
import { anim } from '@/theme/animations'
import { LoadingState } from '@/components/ui'
import { computeAvailableSlots, getDayKey } from '@/lib/slots'
import type { SlotApptRow, SlotOverride } from '@/lib/slots'
import type { BookingService, BookingStaff } from './BookingLayout'

interface Props {
  orgId: string
  service: BookingService
  // Previously chosen date/staff, so the selection survives navigating to the
  // details step and back (this component remounts on step change).
  initialDate: string
  initialStaffId: string | null
  onSelect: (date: string, time: string, staffId: string | null, assignedStaff: BookingStaff[]) => void
  onBack: () => void
}

type ApptRow = SlotApptRow
type OverrideRow = SlotOverride
type WeekTemplate = Record<string, { open: boolean; ranges: { start: string; end: string }[] }>

const ANY = 'any'
// How far ahead findNextAvailable scans per query, and the overall safety cap.
const SCAN_WINDOW_DAYS = 60
const SCAN_MAX_DAYS = 365

export default function Step2DateTimeSelect({ orgId, service, initialDate, initialStaffId, onSelect, onBack }: Props) {
  const { t } = useTranslation()
  const locale = dateLocale()
  const theme = useTheme()
  const glow = `0 4px 16px ${alpha(theme.palette.primary.main, 0.3)}`
  const glowSoft = `0 4px 12px ${alpha(theme.palette.primary.main, 0.18)}`
  const today = startOfDay(new Date())
  // Restore a previously chosen date (yyyy-MM-dd) so it stays selected when
  // returning from the details step.
  const initialSelected = initialDate ? startOfDay(new Date(`${initialDate}T00:00:00`)) : null
  const [weekStart, setWeekStart] = useState(
    initialSelected && isBefore(addDays(today, 6), initialSelected) ? initialSelected : today,
  )
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialSelected)
  const [slots, setSlots] = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [template, setTemplate] = useState<WeekTemplate | null>(null)
  // How far ahead this org allows booking; null = no limit.
  const [maxAdvanceDays, setMaxAdvanceDays] = useState<number | null>(null)

  const [assignedStaff, setAssignedStaff] = useState<BookingStaff[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<string>(initialStaffId ?? ANY)
  const [dayAppts, setDayAppts] = useState<ApptRow[]>([])
  const [override, setOverride] = useState<OverrideRow | null>(null)

  // Appointments + overrides for the whole visible week, used to flag which days
  // actually have free slots (an open-but-fully-booked day looks different from
  // a day with availability, so users don't tap into dead ends).
  const [weekAppts, setWeekAppts] = useState<ApptRow[]>([])
  const [weekOverrides, setWeekOverrides] = useState<Record<string, OverrideRow>>({})
  const [weekLoading, setWeekLoading] = useState(true)

  // Forward search for the next day with availability when the visible week is empty.
  const [nextAvailable, setNextAvailable] = useState<Date | null>(null)
  const [searchingNext, setSearchingNext] = useState(false)

  // Load working hours template once
  useEffect(() => {
    supabase
      .from('working_hours_template')
      .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday,max_advance_days')
      .eq('org_id', orgId)
      .single()
      .then(({ data }) => {
        if (!data) return
        const { max_advance_days, ...days } = data as typeof data & { max_advance_days: number | null }
        setTemplate(days)
        setMaxAdvanceDays(max_advance_days ?? null)
      })
  }, [orgId])

  // Load bookable members assigned to this service once
  useEffect(() => {
    supabase
      .from('service_staff')
      .select('member_id, org_members(id, display_name, title, is_bookable, sort_order)')
      .eq('service_id', service.id)
      .then(({ data }) => {
        // PostgREST returns the nested relation as an object at runtime but
        // types it as an array; normalize either shape.
        const staff: BookingStaff[] = (data ?? [])
          .map(r => {
            const m = (r as { org_members: unknown }).org_members
            return (Array.isArray(m) ? m[0] : m) as
              (BookingStaff & { is_bookable: boolean }) | null
          })
          .filter((m): m is BookingStaff & { is_bookable: boolean } => !!m && m.is_bookable)
          .map(m => ({ id: m.id, display_name: m.display_name, title: m.title, sort_order: m.sort_order }))
          .sort((a, b) => a.sort_order - b.sort_order)
        setAssignedStaff(staff)
      })
  }, [service.id])

  // Fetch appointments + override when the selected date changes (drives the slot list)
  useEffect(() => {
    if (!selectedDate) return
    setLoadingSlots(true)
    const dateKey = format(selectedDate, 'yyyy-MM-dd')
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
        .then(({ data }) => (data ?? []) as ApptRow[]),

      supabase
        .from('working_hours_overrides')
        .select('is_closed, ranges')
        .eq('org_id', orgId)
        .eq('date', dateKey)
        .maybeSingle()
        .then(({ data }) => (data ?? null) as OverrideRow | null),
    ]).then(([appts, ov]) => {
      setDayAppts(appts)
      setOverride(ov)
      setLoadingSlots(false)
    })
  }, [selectedDate, orgId])

  // Fetch appointments + overrides for the visible week (drives the day indicators)
  useEffect(() => {
    setWeekLoading(true)
    const startKey = format(weekStart, 'yyyy-MM-dd')
    const endKey = format(addDays(weekStart, 6), 'yyyy-MM-dd')

    Promise.all([
      supabase
        .from('appointments')
        .select('scheduled_at, duration_minutes, service_id, staff_id')
        .eq('org_id', orgId)
        .gte('scheduled_at', startKey + 'T00:00:00.000Z')
        .lte('scheduled_at', endKey + 'T23:59:59.999Z')
        .not('status', 'in', '(rejected,cancelled)')
        .then(({ data }) => (data ?? []) as ApptRow[]),

      supabase
        .from('working_hours_overrides')
        .select('date, is_closed, ranges')
        .eq('org_id', orgId)
        .gte('date', startKey)
        .lte('date', endKey)
        .then(({ data }) => (data ?? []) as (OverrideRow & { date: string })[]),
    ]).then(([appts, ovs]) => {
      setWeekAppts(appts)
      setWeekOverrides(Object.fromEntries(ovs.map(o => [o.date, o])))
      setWeekLoading(false)
    })
  }, [weekStart, orgId])

  // Recompute the selected day's slots whenever its data or the staff choice changes
  useEffect(() => {
    setSlots(selectedDate
      ? computeAvailableSlots({
        date: selectedDate,
        template,
        override,
        existing: dayAppts,
        serviceId: service.id,
        durationMinutes: service.duration_minutes,
        maxPerSlot: service.max_per_slot,
        assignedStaff,
        selectedStaffId: selectedStaffId === ANY ? null : selectedStaffId,
      })
      : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dayAppts, override, selectedStaffId, assignedStaff, template])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  // Last bookable day (inclusive); null when the org sets no advance limit.
  const maxDate = maxAdvanceDays != null ? addDays(today, maxAdvanceDays) : null

  // Free-slot count per visible day, keyed by yyyy-MM-dd.
  const weekAvailability = useMemo(() => {
    const map: Record<string, number> = {}
    if (!template) return map
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd')
      const dayList = weekAppts.filter(a => a.scheduled_at.startsWith(key))
      map[key] = computeAvailableSlots({
        date: day,
        template,
        override: weekOverrides[key] ?? null,
        existing: dayList,
        serviceId: service.id,
        durationMinutes: service.duration_minutes,
        maxPerSlot: service.max_per_slot,
        assignedStaff,
        selectedStaffId: selectedStaffId === ANY ? null : selectedStaffId,
      }).length
    }
    return map
  }, [days, weekAppts, weekOverrides, template, assignedStaff, selectedStaffId, service])

  const visibleHasAvailability = days.some(d => {
    const key = format(d, 'yyyy-MM-dd')
    const bookable = !isBefore(d, today) && (!maxDate || !isAfter(d, maxDate))
    return bookable && (weekAvailability[key] ?? 0) > 0
  })

  // Scan forward for the first day with a free slot, in bounded windows so a
  // long advance limit can't trigger an unbounded query.
  async function findNextAvailable(from: Date): Promise<Date | null> {
    if (!template) return null
    const limit = maxDate ?? addDays(today, SCAN_MAX_DAYS)
    let cursor = isBefore(from, today) ? today : from
    while (!isAfter(cursor, limit)) {
      let windowEnd = addDays(cursor, SCAN_WINDOW_DAYS - 1)
      if (isAfter(windowEnd, limit)) windowEnd = limit
      const startKey = format(cursor, 'yyyy-MM-dd')
      const endKey = format(windowEnd, 'yyyy-MM-dd')

      const [appts, ovs] = await Promise.all([
        supabase
          .from('appointments')
          .select('scheduled_at, duration_minutes, service_id, staff_id')
          .eq('org_id', orgId)
          .gte('scheduled_at', startKey + 'T00:00:00.000Z')
          .lte('scheduled_at', endKey + 'T23:59:59.999Z')
          .not('status', 'in', '(rejected,cancelled)')
          .then(({ data }) => (data ?? []) as ApptRow[]),
        supabase
          .from('working_hours_overrides')
          .select('date, is_closed, ranges')
          .eq('org_id', orgId)
          .gte('date', startKey)
          .lte('date', endKey)
          .then(({ data }) => (data ?? []) as (OverrideRow & { date: string })[]),
      ])
      const ovMap = Object.fromEntries(ovs.map(o => [o.date, o]))

      for (let d = cursor; !isAfter(d, windowEnd); d = addDays(d, 1)) {
        const key = format(d, 'yyyy-MM-dd')
        const count = computeAvailableSlots({
          date: d,
          template,
          override: ovMap[key] ?? null,
          existing: appts.filter(a => a.scheduled_at.startsWith(key)),
          serviceId: service.id,
          durationMinutes: service.duration_minutes,
          maxPerSlot: service.max_per_slot,
          assignedStaff,
          selectedStaffId: selectedStaffId === ANY ? null : selectedStaffId,
        }).length
        if (count > 0) return d
      }
      cursor = addDays(windowEnd, 1)
    }
    return null
  }

  // When the visible week has nothing free, look ahead for the next open day.
  useEffect(() => {
    if (weekLoading || !template || visibleHasAvailability) {
      setNextAvailable(null)
      setSearchingNext(false)
      return
    }
    let cancelled = false
    setSearchingNext(true)
    findNextAvailable(addDays(weekStart, 7)).then(found => {
      if (!cancelled) {
        setNextAvailable(found)
        setSearchingNext(false)
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, weekLoading, visibleHasAvailability, template, selectedStaffId, assignedStaff])

  function isDayOpen(d: Date): boolean {
    if (!template) return false
    const key = format(d, 'yyyy-MM-dd')
    const ov = weekOverrides[key]
    if (ov) return !ov.is_closed
    const cfg = template[getDayKey(d)]
    return cfg?.open ?? false
  }

  function jumpTo(date: Date) {
    setWeekStart(startOfDay(date))
    setSelectedDate(startOfDay(date))
  }

  const canGoPrev = !isBefore(addDays(weekStart, -1), today)
  // No point advancing once the visible week already reaches the limit.
  const canGoNext = !maxDate || isBefore(addDays(weekStart, 6), maxDate)

  const weekEnd = addDays(weekStart, 6)
  const weekLabel = isSameMonth(weekStart, weekEnd)
    ? format(weekStart, 'LLLL yyyy', { locale })
    : `${format(weekStart, 'LLL', { locale })} – ${format(weekEnd, 'LLL yyyy', { locale })}`

  const staffOptions = [
    { id: ANY, label: t('booking.anyAvailable') },
    ...assignedStaff.map(m => ({ id: m.id, label: m.display_name || '—' })),
  ]

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
        onClick={onBack}
        size="small"
        sx={{ mb: 2, color: 'text.secondary' }}
      >
        {t('common.back')}
      </Button>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{t('booking.chooseDate')}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {service.name} · {service.duration_minutes} {t('common.minutesShort')}
      </Typography>

      {/* Staff picker — only when the service has assigned people */}
      {assignedStaff.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('booking.selectStaff')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {staffOptions.map(opt => {
              const selected = selectedStaffId === opt.id
              return (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  data-testid="book-staff"
                  data-staff-id={opt.id}
                  onClick={() => setSelectedStaffId(opt.id)}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{ fontWeight: 500 }}
                />
              )
            })}
          </Box>
        </Box>
      )}

      {/* Week navigation */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => setWeekStart(w => addDays(w, -7))} disabled={!canGoPrev} aria-label={t('common.back')}>
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" sx={{ flex: 1, textAlign: 'center', fontWeight: 600, textTransform: 'capitalize' }}>
          {weekLabel}
        </Typography>
        <IconButton size="small" onClick={() => setWeekStart(w => addDays(w, 7))} disabled={!canGoNext} aria-label={t('common.next')}>
          <ArrowForwardIosIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Day selector */}
      <Box
        role="group"
        aria-label={t('booking.chooseDate')}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75, mb: 3 }}
      >
        {days.map((day, i) => {
          const key = format(day, 'yyyy-MM-dd')
          const isOpen = isDayOpen(day)
          const isPast = isBefore(day, today)
          const beyondMax = maxDate ? isAfter(day, maxDate) : false
          const bookable = isOpen && !isPast && !beyondMax
          // Availability is only known once the week's data has loaded; until
          // then, leave open days tappable rather than blocking interaction.
          const known = !weekLoading
          const hasSlots = bookable && known && (weekAvailability[key] ?? 0) > 0
          const isFull = bookable && known && (weekAvailability[key] ?? 0) === 0
          const isSelected = selectedDate && isSameDay(day, selectedDate)
          const isToday = isSameDay(day, today)
          const disabled = !isOpen || isPast || beyondMax || isFull

          const select = () => { if (!disabled) setSelectedDate(day) }
          const ariaLabel = `${format(day, 'EEEE, d MMMM', { locale })}${
            disabled ? ` — ${t(isFull ? 'booking.noSlots' : 'onboarding.closed')}` : ''}`

          return (
            <Box
              key={i}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-pressed={!!isSelected}
              aria-disabled={disabled}
              aria-label={ariaLabel}
              data-testid={`book-day-${key}`}
              data-disabled={disabled ? 'true' : 'false'}
              onClick={select}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select() }
              }}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                py: 1.25, borderRadius: 2, cursor: disabled ? 'default' : 'pointer',
                bgcolor: isSelected ? 'primary.main' : 'background.paper',
                border: '1px solid',
                borderColor: isSelected ? 'primary.main' : isToday ? 'primary.light' : 'divider',
                boxShadow: isSelected ? glow : 'none',
                opacity: disabled ? 0.4 : 1,
                outline: 'none',
                '&:focus-visible': { boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.5)}` },
                '&:hover': disabled ? {} : { borderColor: 'primary.main' },
                transition: 'all 0.15s cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: isSelected ? 'white' : 'text.secondary', fontWeight: 500, textTransform: 'capitalize' }}
              >
                {format(day, 'EEEEEE', { locale })}
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, color: isSelected ? 'white' : isToday ? 'primary.main' : 'text.primary' }}
              >
                {format(day, 'd')}
              </Typography>
              {/* Availability dot — present only on days that have free slots */}
              <Box
                sx={{
                  width: 5, height: 5, borderRadius: '50%', mt: 0.5,
                  bgcolor: hasSlots ? (isSelected ? 'white' : 'primary.main') : 'transparent',
                  transition: 'background-color 0.15s',
                }}
              />
            </Box>
          )
        })}
      </Box>

      {/* Next-available shortcut when the visible week is fully booked / closed */}
      {!weekLoading && !visibleHasAvailability && (
        <Box sx={{
          mb: 4, p: 2, borderRadius: 2, textAlign: 'center',
          border: '1px dashed', borderColor: 'divider',
        }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: nextAvailable ? 1.5 : 0 }}>
            {t('booking.noOpeningsThisWeek')}
          </Typography>
          {searchingNext
            ? <LoadingState py={1} size={20} />
            : nextAvailable
            ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<EventAvailableOutlinedIcon sx={{ fontSize: 16 }} />}
                data-testid="book-next-available"
                onClick={() => jumpTo(nextAvailable)}
              >
                {t('booking.nextAvailable', { date: format(nextAvailable, 'd MMM', { locale }) })}
              </Button>
            )
            : (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('booking.noUpcomingAvailability')}
              </Typography>
            )}
        </Box>
      )}

      {/* Time slots */}
      {selectedDate && (
        <>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
            {format(selectedDate, 'd MMMM', { locale })} — {t('booking.availableTimes')}
          </Typography>

          {loadingSlots
            ? <LoadingState py={3} size={24} />
            : slots.length === 0
            ? (
              <Box sx={{
                p: 3, textAlign: 'center', borderRadius: 2,
                border: '1px dashed', borderColor: 'divider',
              }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('booking.noSlots')}
                </Typography>
              </Box>
            )
            : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 1 }}>
                {slots.map((time, index) => (
                  <Chip
                    key={time}
                    label={time}
                    data-testid="book-slot"
                    onClick={() => onSelect(
                      format(selectedDate, 'yyyy-MM-dd'),
                      time,
                      selectedStaffId === ANY ? null : selectedStaffId,
                      assignedStaff,
                    )}
                    sx={{
                      fontWeight: 600, fontSize: '0.875rem', height: 40,
                      cursor: 'pointer',
                      animation: anim.scaleIn,
                      animationDelay: `${index * 30}ms`,
                      transition: 'all 0.18s cubic-bezier(0.16,1,0.3,1)',
                      '&:hover': {
                        bgcolor: 'primary.main',
                        color: 'white',
                        boxShadow: glowSoft,
                        borderColor: 'primary.main',
                      },
                    }}
                    variant="outlined"
                  />
                ))}
              </Box>
            )
          }
        </>
      )}
    </Box>
  )
}
