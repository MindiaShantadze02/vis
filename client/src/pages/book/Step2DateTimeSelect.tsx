import { useEffect, useState } from 'react'
import {
  Box, Typography, Button, Chip, IconButton,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import {
  format, addDays, startOfDay, isBefore, isSameDay,
} from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { anim } from '@/theme/animations'
import { elevation } from '@/theme/theme'
import { LoadingState } from '@/components/ui'
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

interface ApptRow {
  scheduled_at: string
  duration_minutes: number
  service_id: string
  staff_id: string | null
}

interface OverrideRow {
  is_closed: boolean
  ranges: { start: string; end: string }[] | null
}

const DAY_SHORT = ['კვ', 'ორ', 'სა', 'ოთ', 'ხუ', 'პა', 'შა']
const ANY = 'any'

export default function Step2DateTimeSelect({ orgId, service, initialDate, initialStaffId, onSelect, onBack }: Props) {
  const { t } = useTranslation()
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
  const [template, setTemplate] = useState<Record<string, { open: boolean; ranges: { start: string; end: string }[] }> | null>(null)

  const [assignedStaff, setAssignedStaff] = useState<BookingStaff[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<string>(initialStaffId ?? ANY)
  const [dayAppts, setDayAppts] = useState<ApptRow[]>([])
  const [override, setOverride] = useState<OverrideRow | null>(null)

  // Load working hours template once
  useEffect(() => {
    supabase
      .from('working_hours_template')
      .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday')
      .eq('org_id', orgId)
      .single()
      .then(({ data }) => { if (data) setTemplate(data) })
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

  // Fetch appointments + override when the date changes
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

  // Recompute slots whenever the date, fetched data, or staff choice changes
  useEffect(() => {
    setSlots(selectedDate ? computeSlots(selectedDate, dayAppts, override) : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, dayAppts, override, selectedStaffId, assignedStaff, template])

  function getDayKey(d: Date): string {
    const keys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    return keys[d.getDay()]
  }

  function isDayOpen(d: Date): boolean {
    if (!template) return false
    const cfg = template[getDayKey(d)]
    return cfg?.open ?? false
  }

  function computeSlots(date: Date, existing: ApptRow[], ov: OverrideRow | null): string[] {
    if (!template) return []
    if (ov?.is_closed) return []

    const cfg = ov?.ranges
      ? { open: true, ranges: ov.ranges }
      : template[getDayKey(date)]

    if (!cfg?.open) return []

    const now = new Date()
    const generated: string[] = []

    for (const range of cfg.ranges) {
      const [sh, sm] = range.start.split(':').map(Number)
      const [eh, em] = range.end.split(':').map(Number)
      let cur = new Date(date)
      cur.setHours(sh, sm, 0, 0)
      const end = new Date(date)
      end.setHours(eh, em, 0, 0)

      while (cur < end) {
        const slotEnd = new Date(cur.getTime() + service.duration_minutes * 60000)
        if (slotEnd > end) break

        if (!isBefore(cur, now) && isSlotAvailable(cur, slotEnd, existing)) {
          generated.push(format(cur, 'HH:mm'))
        }

        cur = new Date(cur.getTime() + service.duration_minutes * 60000)
      }
    }

    return generated
  }

  // Combines per-service capacity (max_per_slot) with per-person availability.
  function isSlotAvailable(cur: Date, slotEnd: Date, existing: ApptRow[]): boolean {
    const overlapping = existing.filter(a => {
      const aStart = new Date(a.scheduled_at).getTime()
      const aEnd = aStart + a.duration_minutes * 60000
      return cur.getTime() < aEnd && slotEnd.getTime() > aStart
    })

    // Per-service concurrency cap.
    const serviceCount = overlapping.filter(a => a.service_id === service.id).length
    if (serviceCount >= service.max_per_slot) return false

    // No assigned staff → capacity is the only constraint.
    if (assignedStaff.length === 0) return true

    // A member is busy if they have ANY overlapping appointment (across services).
    const busyIds = new Set(overlapping.map(a => a.staff_id).filter(Boolean))
    const freeMembers = assignedStaff.filter(m => !busyIds.has(m.id))

    if (selectedStaffId === ANY) return freeMembers.length >= 1
    return freeMembers.some(m => m.id === selectedStaffId)
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const canGoPrev = !isBefore(addDays(weekStart, -1), today)

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
        უკან
      </Button>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>თარიღის არჩევა</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {service.name} · {service.duration_minutes} წთ
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
        <IconButton size="small" onClick={() => setWeekStart(w => addDays(w, -7))} disabled={!canGoPrev}>
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" sx={{ flex: 1, textAlign: 'center', fontWeight: 500 }}>
          {format(weekStart, 'd MMM', { locale: ka })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: ka })}
        </Typography>
        <IconButton size="small" onClick={() => setWeekStart(w => addDays(w, 7))}>
          <ArrowForwardIosIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Day selector */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75, mb: 4 }}>
        {days.map((day, i) => {
          const isOpen = isDayOpen(day)
          const isPast = isBefore(day, today)
          const isSelected = selectedDate && isSameDay(day, selectedDate)
          const isToday = isSameDay(day, today)
          const disabled = !isOpen || isPast

          return (
            <Box
              key={i}
              onClick={() => !disabled && setSelectedDate(day)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                py: 1.25, borderRadius: 2, cursor: disabled ? 'default' : 'pointer',
                bgcolor: isSelected ? 'primary.main' : 'background.paper',
                border: '1px solid',
                borderColor: isSelected ? 'primary.main' : isToday ? 'primary.light' : 'divider',
                boxShadow: isSelected ? elevation.glow : 'none',
                opacity: disabled ? 0.35 : 1,
                '&:hover': disabled ? {} : { borderColor: 'primary.main' },
                transition: 'all 0.15s cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: isSelected ? 'white' : 'text.secondary', fontWeight: 500 }}
              >
                {DAY_SHORT[day.getDay()]}
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 700, color: isSelected ? 'white' : isToday ? 'primary.main' : 'text.primary' }}
              >
                {format(day, 'd')}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {/* Time slots */}
      {selectedDate && (
        <>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
            {format(selectedDate, 'd MMMM', { locale: ka })} — თავისუფალი დრო
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
                  ამ დღეს თავისუფალი დრო არ არის
                </Typography>
              </Box>
            )
            : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 1 }}>
                {slots.map((time, index) => (
                  <Chip
                    key={time}
                    label={time}
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
                        boxShadow: elevation.glowSoft,
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
