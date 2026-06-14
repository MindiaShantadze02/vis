import { useEffect, useState } from 'react'
import {
  Box, Typography, Button, CircularProgress, Chip,
  IconButton,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import {
  format, addDays, startOfDay, isBefore, addWeeks,
  parseISO, isSameDay,
} from 'date-fns'
import { ka } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import type { BookingService } from './BookingLayout'

interface Props {
  orgId: string
  service: BookingService
  onSelect: (date: string, time: string) => void
  onBack: () => void
}

interface SlotWindow {
  start: string   // ISO datetime string
  available: boolean
}

const DAY_SHORT = ['კვ', 'ორ', 'სა', 'ოთ', 'ხუ', 'პა', 'შა']

export default function Step2DateTimeSelect({ orgId, service, onSelect, onBack }: Props) {
  const today = startOfDay(new Date())
  const [weekStart, setWeekStart] = useState(today)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [template, setTemplate] = useState<Record<string, { open: boolean; ranges: { start: string; end: string }[] }> | null>(null)
  const [existingTimes, setExistingTimes] = useState<Date[]>([])

  // Load working hours template once
  useEffect(() => {
    supabase
      .from('working_hours_template')
      .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday')
      .eq('org_id', orgId)
      .single()
      .then(({ data }) => { if (data) setTemplate(data) })
  }, [orgId])

  // Load existing appointments when date selected
  useEffect(() => {
    if (!selectedDate) return
    const dayStart = format(selectedDate, 'yyyy-MM-dd') + 'T00:00:00.000Z'
    const dayEnd = format(selectedDate, 'yyyy-MM-dd') + 'T23:59:59.999Z'
    supabase
      .from('appointments')
      .select('scheduled_at, duration_minutes')
      .eq('org_id', orgId)
      .gte('scheduled_at', dayStart)
      .lte('scheduled_at', dayEnd)
      .not('status', 'in', '(rejected,cancelled)')
      .then(({ data }) => {
        setExistingTimes((data ?? []).map(a => new Date(a.scheduled_at)))
        computeSlots(selectedDate, data ?? [])
      })
  }, [selectedDate])

  function getDayKey(d: Date): string {
    const keys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    return keys[d.getDay()]
  }

  function isDayOpen(d: Date): boolean {
    if (!template) return false
    const cfg = template[getDayKey(d)]
    return cfg?.open ?? false
  }

  function computeSlots(date: Date, existing: { scheduled_at: string; duration_minutes: number }[]) {
    if (!template) return
    const cfg = template[getDayKey(date)]
    if (!cfg?.open) { setSlots([]); return }

    setLoadingSlots(true)
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

        // Check overlap with existing appointments
        const overlaps = existing.some(a => {
          const aStart = new Date(a.scheduled_at)
          const aEnd = new Date(aStart.getTime() + a.duration_minutes * 60000)
          return cur < aEnd && slotEnd > aStart
        })

        // Skip past slots
        const isPast = isBefore(cur, new Date())

        if (!overlaps && !isPast) {
          generated.push(format(cur, 'HH:mm'))
        }

        cur = new Date(cur.getTime() + service.duration_minutes * 60000)
      }
    }

    setSlots(generated)
    setLoadingSlots(false)
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const canGoPrev = !isBefore(addDays(weekStart, -1), today)

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
                opacity: disabled ? 0.35 : 1,
                '&:hover': disabled ? {} : { borderColor: 'primary.main' },
                transition: 'all 0.1s',
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
            ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
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
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                {slots.map(time => (
                  <Chip
                    key={time}
                    label={time}
                    onClick={() => onSelect(format(selectedDate, 'yyyy-MM-dd'), time)}
                    sx={{
                      fontWeight: 600, fontSize: 14, height: 40,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'primary.main', color: 'white' },
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
