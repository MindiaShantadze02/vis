import { useEffect, useState } from 'react'
import {
  Box, Typography, IconButton, Card, Tooltip,
  Drawer, Stack, Button, Chip, CircularProgress,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import TodayIcon from '@mui/icons-material/Today'
import { format, startOfWeek, addWeeks, addDays, isSameDay } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'

interface Appointment {
  id: string
  scheduled_at: string
  duration_minutes: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed'
  payment_method: string
  payment_status: string
  notes: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  services: { name: string; price: number } | null
}

const STATUS_COLOR: Record<string, string> = {
  pending:   '#F59E0B',
  approved:  '#10B981',
  rejected:  '#EF4444',
  cancelled: '#9CA3AF',
  completed: '#6B7280',
}

const STATUS_BG: Record<string, string> = {
  pending:   '#FEF3C7',
  approved:  '#D1FAE5',
  rejected:  '#FEE2E2',
  cancelled: '#F3F4F6',
  completed: '#F3F4F6',
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'მოლოდინში',
  approved:  'დამტკიცებული',
  rejected:  'უარყოფილი',
  cancelled: 'გაუქმებული',
  completed: 'დასრულებული',
}

const DAY_NAMES = ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვი']

// Working hours to display (8:00 – 20:00)
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8)

export default function CalendarPage() {
  const { t } = useTranslation()
  const { org } = useOrg()

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (org) loadWeek()
  }, [org, weekStart])

  async function loadWeek() {
    if (!org) return
    setLoading(true)
    const weekEnd = addDays(weekStart, 7)
    const { data } = await supabase
      .from('appointments')
      .select('id, scheduled_at, duration_minutes, status, payment_method, payment_status, notes, customers(first_name, last_name, phone_number), services(name, price)')
      .eq('org_id', org.id)
      .gte('scheduled_at', weekStart.toISOString())
      .lt('scheduled_at', weekEnd.toISOString())
      .not('status', 'in', '(rejected,cancelled)')
      .order('scheduled_at')

    setAppointments((data ?? []) as unknown as Appointment[])
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

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function getApptForSlot(day: Date, hour: number): Appointment[] {
    return appointments.filter(a => {
      const d = new Date(a.scheduled_at)
      return isSameDay(d, day) && d.getHours() === hour
    })
  }

  const weekLabel = `${format(weekStart, 'd MMM')} – ${format(addDays(weekStart, 6), 'd MMM yyyy')}`

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {t('dashboard.calendar')}
        </Typography>
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

      {/* Legend */}
      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        {(['pending', 'approved'] as const).map(s => (
          <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: STATUS_COLOR[s] }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{STATUS_LABEL[s]}</Typography>
          </Box>
        ))}
      </Stack>

      {/* Calendar grid */}
      <Card sx={{ overflow: 'auto' }}>
        {/* Day headers */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '56px repeat(7, 1fr)',
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 1,
          }}
        >
          <Box /> {/* Time gutter */}
          {days.map((day, i) => {
            const isToday = isSameDay(day, new Date())
            return (
              <Box
                key={i}
                sx={{
                  py: 1.5,
                  textAlign: 'center',
                  borderLeft: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {DAY_NAMES[i]}
                </Typography>
                <Box
                  sx={{
                    width: 28, height: 28, borderRadius: '50%',
                    bgcolor: isToday ? 'primary.main' : 'transparent',
                    color: isToday ? 'white' : 'text.primary',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    mx: 'auto', mt: 0.25,
                  }}
                >
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
          ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress size={32} />
            </Box>
          )
          : HOURS.map(hour => (
            <Box
              key={hour}
              sx={{
                display: 'grid',
                gridTemplateColumns: '56px repeat(7, 1fr)',
                minHeight: 60,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              {/* Hour label */}
              <Box sx={{ pt: 0.5, pr: 1, textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1 }}>
                  {String(hour).padStart(2, '0')}:00
                </Typography>
              </Box>

              {/* Day cells */}
              {days.map((day, di) => {
                const slotAppts = getApptForSlot(day, hour)
                return (
                  <Box
                    key={di}
                    sx={{
                      borderLeft: '1px solid',
                      borderColor: 'divider',
                      p: 0.5,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 0.5,
                      alignContent: 'flex-start',
                    }}
                  >
                    {slotAppts.map(appt => (
                      <Tooltip
                        key={appt.id}
                        title={`${appt.customers?.first_name} ${appt.customers?.last_name ?? ''} · ${appt.services?.name}`}
                      >
                        <Box
                          onClick={() => setSelected(appt)}
                          sx={{
                            width: 28, height: 28,
                            borderRadius: '50%',
                            bgcolor: STATUS_BG[appt.status],
                            border: '2px solid',
                            borderColor: STATUS_COLOR[appt.status],
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                            fontSize: 10,
                            fontWeight: 700,
                            color: STATUS_COLOR[appt.status],
                            '&:hover': { transform: 'scale(1.15)' },
                            transition: 'transform 0.1s',
                          }}
                        >
                          {format(new Date(appt.scheduled_at), 'H')}
                        </Box>
                      </Tooltip>
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
                  <Chip
                    label={STATUS_LABEL[selected.status]}
                    size="small"
                    sx={{
                      bgcolor: STATUS_BG[selected.status],
                      color: STATUS_COLOR[selected.status],
                      fontWeight: 600,
                      border: '1px solid',
                      borderColor: STATUS_COLOR[selected.status],
                    }}
                  />
                </Box>
              </Box>
              {selected.notes && (
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>შენიშვნა</Typography>
                  <Typography variant="body2">{selected.notes}</Typography>
                </Box>
              )}
            </Stack>

            {selected.status === 'pending' && (
              <Stack spacing={1} sx={{ mt: 4 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="success"
                  onClick={() => changeStatus(selected.id, 'approved')}
                  disabled={actionLoading}
                >
                  {actionLoading ? <CircularProgress size={20} color="inherit" /> : t('dashboard.approve')}
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  color="error"
                  onClick={() => changeStatus(selected.id, 'rejected')}
                  disabled={actionLoading}
                >
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
    </Box>
  )
}
