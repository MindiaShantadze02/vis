import { useEffect, useState } from 'react'
import {
  Grid, Card, Typography, Box, Skeleton, Chip, Button,
  TextField, Select, MenuItem, FormControl, InputLabel, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions,
  useMediaQuery, useTheme,
} from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import SearchIcon from '@mui/icons-material/Search'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { PageHeader, StatCard, StatusChip, EmptyState, CopyableText, useToast } from '@/components/ui'
import type { AppointmentStatus } from '@/components/ui'

// ── Types ─────────────────────────────────────────────────────

interface StaffRef { id: string; display_name: string | null; title: string | null }

interface Appointment {
  id: string
  scheduled_at: string
  duration_minutes: number
  service_id: string
  staff_id: string | null
  status: AppointmentStatus
  payment_method: string
  payment_status: string
  notes: string | null
  admin_notes: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  services: { name: string; price: number; duration_minutes: number } | null
  staff: StaffRef | null
}

interface Stats {
  revenueThisWeek: number
  revenueThisMonth: number
  appointmentsToday: number
  pendingCount: number
}

const ALL_STATUSES: AppointmentStatus[] = ['pending', 'approved', 'rejected', 'cancelled', 'completed']
const GRID_COLS = '140px 1fr 1fr 100px 90px 140px'

// ── Main Page ─────────────────────────────────────────────────

export default function OverviewPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const theme = useTheme()
  const toast = useToast()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const [stats, setStats] = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [apptLoading, setApptLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [selected, setSelected] = useState<Appointment | null>(null)
  const [adminNote, setAdminNote] = useState('')

  const [bookableMembers, setBookableMembers] = useState<StaffRef[]>([])
  const [assignableIds, setAssignableIds] = useState<string[]>([])

  useEffect(() => {
    if (!org) return
    loadStats()
    supabase
      .from('org_members')
      .select('id, display_name, title')
      .eq('org_id', org.id)
      .eq('is_bookable', true)
      .order('sort_order')
      .then(({ data }) => setBookableMembers((data ?? []) as StaffRef[]))
  }, [org])

  // Debounce the search box so we issue one query after typing settles,
  // not one per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  // Status + search are both applied server-side via the
  // search_appointments RPC.
  useEffect(() => {
    if (org) loadAppointments()
  }, [org, statusFilter, debouncedSearch])

  // Which members are assignable to the opened appointment's service.
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

  async function loadStats() {
    if (!org) return
    setStatsLoading(true)

    const now = new Date()
    const todayStart = startOfDay(now).toISOString()
    const todayEnd = endOfDay(now).toISOString()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString()
    const monthStart = startOfMonth(now).toISOString()
    const monthEnd = endOfMonth(now).toISOString()

    const [todayRes, weekRes, monthRes, pendingRes] = await Promise.all([
      supabase
        .from('appointments').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).gte('scheduled_at', todayStart).lte('scheduled_at', todayEnd)
        .not('status', 'in', '(rejected,cancelled)'),

      supabase
        .from('appointments').select('id, services(price)', { count: 'exact' })
        .eq('org_id', org.id).gte('scheduled_at', weekStart).lte('scheduled_at', weekEnd)
        .not('status', 'in', '(rejected,cancelled)'),

      supabase
        .from('appointments').select('id, services(price)')
        .eq('org_id', org.id).gte('scheduled_at', monthStart).lte('scheduled_at', monthEnd)
        .eq('payment_status', 'paid'),

      supabase
        .from('appointments').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).eq('status', 'pending'),
    ])

    const weekRevenue = (weekRes.data ?? []).reduce(
      (sum, a) => sum + ((a.services as unknown as { price: number } | null)?.price ?? 0), 0
    )
    const monthRevenue = (monthRes.data ?? []).reduce(
      (sum, a) => sum + ((a.services as unknown as { price: number } | null)?.price ?? 0), 0
    )

    setStats({
      revenueThisWeek: weekRevenue,
      revenueThisMonth: monthRevenue,
      appointmentsToday: todayRes.count ?? 0,
      pendingCount: pendingRes.count ?? 0,
    })
    setStatsLoading(false)
  }

  async function loadAppointments() {
    if (!org) return
    setApptLoading(true)

    const { data } = await supabase.rpc('search_appointments', {
      p_org_id: org.id,
      p_status: statusFilter === 'all' ? null : statusFilter,
      p_search: debouncedSearch || null,
      p_limit: 100,
    })

    setAppointments((data ?? []) as unknown as Appointment[])
    setApptLoading(false)
  }

  async function changeStatus(id: string, status: 'approved' | 'rejected') {
    setActionLoading(id)
    const { error } = await supabase
      .from('appointments')
      .update({ status, admin_notes: adminNote || null, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      toast.error(error.message)
    } else {
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
      if (status === 'approved') {
        setStats(prev => prev ? { ...prev, pendingCount: Math.max(0, prev.pendingCount - 1) } : prev)
      }
      toast.success(status === 'approved' ? t('dashboard.approved') : t('dashboard.rejected'))
      setSelected(null)
      setAdminNote('')
    }
    setActionLoading(null)
  }

  return (
    <Box>
      <PageHeader title={t('dashboard.overview')} />

      {/* Booking link — shown prominently so the business can copy & share it */}
      {org?.slug && (
        <Box sx={{ mb: 4, maxWidth: 480 }}>
          <CopyableText
            label="თქვენი ბუქინგ ბმული"
            text={`grafiki.ge/book/${org.slug}`}
            value={`https://grafiki.ge/book/${org.slug}`}
          />
        </Box>
      )}

      {/* Stat cards */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.revenueThisWeek')}
            value={`${stats?.revenueThisWeek ?? 0} ₾`}
            icon={<TrendingUpIcon />}
            color={theme.palette.primary.main}
            loading={statsLoading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.revenueThisMonth')}
            value={`${stats?.revenueThisMonth ?? 0} ₾`}
            icon={<TrendingUpIcon />}
            color={theme.palette.success.main}
            loading={statsLoading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.todayAppointments')}
            value={stats?.appointmentsToday ?? 0}
            icon={<CalendarTodayIcon />}
            color={theme.palette.primary.main}
            loading={statsLoading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.pendingApprovals')}
            value={stats?.pendingCount ?? 0}
            icon={<AccessTimeIcon />}
            color={theme.palette.warning.main}
            loading={statsLoading}
          />
        </Grid>
      </Grid>

      {/* Appointments list */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>{t('dashboard.appointments')}</Typography>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder={`${t('common.search')}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> } }}
            sx={{ minWidth: 200 }}
          />
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>სტატუსი</InputLabel>
            <Select
              value={statusFilter}
              label="სტატუსი"
              onChange={e => setStatusFilter(e.target.value as AppointmentStatus | 'all')}
            >
              <MenuItem value="all">ყველა</MenuItem>
              {ALL_STATUSES.map(s => (
                <MenuItem key={s} value={s}>{t(`dashboard.${s}`)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>

      <Card>
        {/* Desktop header row */}
        {!isMobile && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: GRID_COLS,
              px: 2, py: 1.5,
              bgcolor: 'grey.50',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {['დრო', 'კლიენტი', 'სერვისი', 'გადახდა', 'ფასი', 'სტატუსი'].map(h => (
              <Typography key={h} variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                {h}
              </Typography>
            ))}
          </Box>
        )}

        {apptLoading
          ? Array.from({ length: 5 }).map((_, i) => (
            <Box key={i} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton height={24} />
            </Box>
          ))
          : appointments.length === 0
          ? <EmptyState icon={<EventBusyOutlinedIcon />} title="ჯავშნები ვერ მოიძებნა" />
          : appointments.map((appt, i) => {
            const rowProps = {
              key: appt.id,
              onClick: () => { setSelected(appt); setAdminNote(appt.admin_notes ?? '') },
              sx: {
                px: 2, py: 1.5,
                borderBottom: i < appointments.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              },
            }

            // Mobile: stacked card layout
            if (isMobile) {
              return (
                <Box {...rowProps}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {appt.customers?.first_name} {appt.customers?.last_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                        {format(new Date(appt.scheduled_at), 'd MMM, HH:mm', { locale: ka })} · {appt.services?.name}
                        {appt.staff?.display_name ? ` · ${appt.staff.display_name}` : ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {appt.services?.price} ₾
                      </Typography>
                    </Box>
                    <StatusChip status={appt.status} />
                  </Box>
                </Box>
              )
            }

            // Desktop: grid row
            return (
              <Box {...rowProps} sx={{ ...rowProps.sx, display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {format(new Date(appt.scheduled_at), 'dd MMM', { locale: ka })}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {format(new Date(appt.scheduled_at), 'HH:mm')}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: 0, pr: 1 }}>
                  <Typography variant="body2" noWrap>
                    {appt.customers?.first_name} {appt.customers?.last_name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {appt.customers?.phone_number}
                  </Typography>
                </Box>
                <Box sx={{ minWidth: 0, pr: 1 }}>
                  <Typography variant="body2" noWrap>{appt.services?.name}</Typography>
                  {appt.staff?.display_name && (
                    <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
                      {appt.staff.display_name}
                    </Typography>
                  )}
                </Box>
                <Chip
                  label={appt.payment_method === 'online' ? 'ონლაინ' : 'ადგილზე'}
                  size="small"
                  variant="outlined"
                  sx={{ justifySelf: 'start' }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {appt.services?.price} ₾
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <StatusChip status={appt.status} />
                </Box>
              </Box>
            )
          })
        }
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        {selected && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              {selected.customers?.first_name} {selected.customers?.last_name}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>სერვისი</Typography>
                  <Typography variant="body2">{selected.services?.name} — {selected.services?.price} ₾</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>თარიღი / დრო</Typography>
                  <Typography variant="body2">
                    {format(new Date(selected.scheduled_at), 'd MMMM yyyy, HH:mm', { locale: ka })}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>ტელეფონი</Typography>
                  <Typography variant="body2">{selected.customers?.phone_number}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>სტატუსი</Typography>
                  <Box sx={{ mt: 0.25 }}><StatusChip status={selected.status} /></Box>
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
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>გადახდა</Typography>
                  <Typography variant="body2">
                    {selected.payment_method === 'online' ? 'ონლაინ' : 'ადგილზე'} ·{' '}
                    {selected.payment_status === 'paid' ? '✓ გადახდილია' : 'გადაუხდელი'}
                  </Typography>
                </Box>
                {selected.status === 'pending' && (
                  <TextField
                    fullWidth size="small"
                    label="შიდა შენიშვნა (არასავალდებულო)"
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    multiline rows={2}
                  />
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setSelected(null)}>{t('common.cancel')}</Button>
              {selected.status === 'pending' && (
                <>
                  <Button variant="outlined" color="error"
                    onClick={() => changeStatus(selected.id, 'rejected')} disabled={!!actionLoading}>
                    {t('dashboard.reject')}
                  </Button>
                  <Button variant="contained" color="success"
                    onClick={() => changeStatus(selected.id, 'approved')} disabled={!!actionLoading}>
                    {t('dashboard.approve')}
                  </Button>
                </>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  )
}
