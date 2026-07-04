import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  Typography, Box, Skeleton, Button,
  TextField, Select, MenuItem, FormControl, InputLabel, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, TablePagination,
  useMediaQuery, useTheme,
} from '@mui/material'
import { AppDatePicker } from '@/components/AppDatePicker'
import { Add as AddIcon } from '@/components/icons'
import { TrendingUp as TrendingUpIcon } from '@/components/icons'
import { CalendarToday as CalendarTodayIcon } from '@/components/icons'
import { AccessTime as AccessTimeIcon } from '@/components/icons'
import { Search as SearchIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { CreditCardOutlined as CreditCardOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { PageHeader, StatStrip, StatusChip, EmptyState, CopyableText, LoadingState, useToast } from '@/components/ui'
import type { AppointmentStatus } from '@/components/ui'
import { surface } from '@/theme/theme'
import AddAppointmentDialog from './AddAppointmentDialog'
import PendingInvites from './PendingInvites'
import type { DashboardOutletContext } from './DashboardLayout'

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
  const navigate = useNavigate()
  const { refreshSignal } = useOutletContext<DashboardOutletContext>()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const [stats, setStats] = useState<Stats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [apptLoading, setApptLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState<Date | null>(null)
  const [dateTo, setDateTo] = useState<Date | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [total, setTotal] = useState(0)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [selected, setSelected] = useState<Appointment | null>(null)
  const [adminNote, setAdminNote] = useState('')
  // Inline two-step guard for cancelling an already-approved appointment.
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // Inline two-step guard for erasing a client's personal data (Art. 16).
  const [confirmingErase, setConfirmingErase] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

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
  // not one per keystroke. Resetting the page here (rather than in a
  // separate effect) avoids a stale-page fetch landing on an empty page.
  useEffect(() => {
    const id = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0) }, 300)
    return () => clearTimeout(id)
  }, [search])

  // Status, search, date range, and pagination are all applied
  // server-side via the search_appointments RPC.
  useEffect(() => {
    if (org) loadAppointments()
  }, [org, statusFilter, debouncedSearch, dateFrom, dateTo, page, rowsPerPage])

  // Refetch when the admin acts on a notification (signal bumped by the layout)
  // so the list and stats reflect the newest appointment requests. Skip the
  // initial value — the effects above already do the first load.
  useEffect(() => {
    if (!org || refreshSignal === 0) return
    loadAppointments()
    loadStats()
  }, [refreshSignal])

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
        .in('status', ['approved', 'completed']),

      supabase
        .from('appointments').select('id, services(price)')
        .eq('org_id', org.id).gte('scheduled_at', monthStart).lte('scheduled_at', monthEnd)
        .in('status', ['approved', 'completed']),

      supabase
        .from('appointments').select('id', { count: 'exact', head: true })
        .eq('org_id', org.id).eq('status', 'pending'),
    ])

    // price is a numeric(10,2) column, which PostgREST returns as a string
    // (e.g. "50.00"). Coerce to a number so we sum rather than concatenate.
    const weekRevenue = (weekRes.data ?? []).reduce(
      (sum, a) => sum + Number((a.services as unknown as { price: number } | null)?.price ?? 0), 0
    )
    const monthRevenue = (monthRes.data ?? []).reduce(
      (sum, a) => sum + Number((a.services as unknown as { price: number } | null)?.price ?? 0), 0
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
      p_date_from: dateFrom ? startOfDay(dateFrom).toISOString() : null,
      p_date_to: dateTo ? endOfDay(dateTo).toISOString() : null,
      p_limit: rowsPerPage,
      p_offset: page * rowsPerPage,
    })

    const rows = (data ?? []) as unknown as (Appointment & { total_count?: number })[]
    setAppointments(rows as unknown as Appointment[])
    // total_count is identical on every row; absent when zero rows match.
    setTotal(rows[0]?.total_count ?? 0)
    setApptLoading(false)
  }

  async function changeStatus(id: string, status: 'approved' | 'rejected' | 'cancelled') {
    setActionLoading(id)
    const { error } = await supabase
      .from('appointments')
      .update({ status, admin_notes: adminNote || null, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      toast.error(error.message)
    } else {
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
      // Any status change can shift the stat cards (pending count, today's
      // count, weekly revenue), so refresh them from the server.
      loadStats()
      toast.success(t(`dashboard.${status}`))
      setSelected(null)
      setAdminNote('')
      setConfirmingCancel(false)
    }
    setActionLoading(null)
  }

  // Honor a client's erasure request (Art. 16): anonymize their PII on this
  // appointment via the erase_customer_data RPC (org-membership checked server-side).
  async function eraseClientData(id: string) {
    setActionLoading(id)
    const { error } = await supabase.rpc('erase_customer_data', { p_appointment_id: id })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(t('dashboard.eraseDone'))
      setSelected(null)
      setConfirmingErase(false)
      loadAppointments()
    }
    setActionLoading(null)
  }

  // No organisation yet (user skipped onboarding and isn't a member of any
  // project). Show a friendly empty state inviting them to set up a business.
  if (!org) {
    return (
      <Box>
        <PageHeader title={t('dashboard.overview')} />
        <PendingInvites />
        <EmptyState
          icon={<StorefrontOutlinedIcon />}
          title={t('dashboard.noBusinessTitle')}
          caption={t('dashboard.noBusinessCaption')}
          action={
            <Button variant="contained" onClick={() => navigate('/onboarding/business')}>
              {t('dashboard.setUpBusiness')}
            </Button>
          }
        />
      </Box>
    )
  }

  // First page load: nothing has come back yet. Show a centred spinner (the
  // admin theme's accent) rather than a bare stat/appointment skeleton frame.
  // stays non-null once loaded, so this doesn't re-trigger on filter/refresh.
  if (statsLoading && apptLoading && !stats && appointments.length === 0) {
    return (
      <Box>
        <PageHeader title={t('dashboard.overview')} />
        <LoadingState />
      </Box>
    )
  }

  return (
    <Box>
      <PageHeader title={t('dashboard.overview')} />

      {/* Booking link + website embed code — copy & share / paste into a site.
          Available on every plan. */}
      {org?.slug && (
        <Box sx={{ mb: 4, maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <CopyableText
            label={t('dashboard.yourBookingLink')}
            text={`vis.ge/book/${org.slug}`}
            value={`https://vis.ge/book/${org.slug}`}
            href={`https://vis.ge/book/${org.slug}`}
          />
          <CopyableText
            label={t('dashboard.embedCode')}
            text={`<iframe data-vis src="…/book/${org.slug}?embed=1"> … + embed.js`}
            value={
              `<iframe data-vis src="https://vis.ge/book/${org.slug}?embed=1&lang=ka" style="width:100%;border:0"></iframe>\n` +
              `<script src="https://vis.ge/embed.js" async></script>`
            }
          />
        </Box>
      )}

      {/* Stat strip */}
      <StatStrip
        loading={statsLoading}
        items={[
          { label: t('dashboard.revenueThisWeek'), value: `${stats?.revenueThisWeek ?? 0} ₾`, icon: <TrendingUpIcon />, color: theme.palette.primary.main },
          { label: t('dashboard.revenueThisMonth'), value: `${stats?.revenueThisMonth ?? 0} ₾`, icon: <TrendingUpIcon />, color: theme.palette.success.main },
          { label: t('dashboard.todayAppointments'), value: stats?.appointmentsToday ?? 0, icon: <CalendarTodayIcon />, color: theme.palette.primary.main },
          { label: t('dashboard.pendingApprovals'), value: stats?.pendingCount ?? 0, icon: <AccessTimeIcon />, color: theme.palette.warning.main },
        ]}
      />

      {/* Appointments list */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>{t('dashboard.appointments')}</Typography>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-testid="appt-add-btn">
            ჯავშნის დამატება
          </Button>
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ flexWrap: 'wrap', gap: 1.5, width: { xs: '100%', md: 'auto' } }}
        >
          <TextField
            size="small"
            placeholder={`${t('common.search')}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            slotProps={{
              input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> },
              htmlInput: { 'data-testid': 'appt-search' },
            }}
            sx={{ minWidth: { sm: 200 }, width: { xs: '100%', sm: 'auto' } }}
          />
          <FormControl size="small" sx={{ minWidth: { sm: 140 }, width: { xs: '100%', sm: 'auto' } }}>
            <InputLabel>სტატუსი</InputLabel>
            <Select
              value={statusFilter}
              label="სტატუსი"
              onChange={e => { setStatusFilter(e.target.value as AppointmentStatus | 'all'); setPage(0) }}
              data-testid="appt-status-filter"
            >
              <MenuItem value="all">ყველა</MenuItem>
              {ALL_STATUSES.map(s => (
                <MenuItem key={s} value={s}>{t(`dashboard.${s}`)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <AppDatePicker
            label={t('dashboard.dateFrom')}
            value={dateFrom}
            onChange={v => { setDateFrom(v); setPage(0) }}
            format="dd MMM yyyy"
            slotProps={{
              textField: { size: 'small', sx: { minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } } },
              field: { clearable: true, onClear: () => { setDateFrom(null); setPage(0) } },
            }}
          />
          <AppDatePicker
            label={t('dashboard.dateTo')}
            value={dateTo}
            minDate={dateFrom ?? undefined}
            onChange={v => { setDateTo(v); setPage(0) }}
            format="dd MMM yyyy"
            slotProps={{
              textField: { size: 'small', sx: { minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } } },
              field: { clearable: true, onClear: () => { setDateTo(null); setPage(0) } },
            }}
          />
        </Stack>
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
        {/* Desktop header row */}
        {!isMobile && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: GRID_COLS,
              px: 2, py: 1.5,
              bgcolor: surface.header,
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
              'data-testid': 'appt-row',
              onClick: () => { setSelected(appt); setAdminNote(appt.admin_notes ?? ''); setConfirmingCancel(false) },
              sx: {
                px: 2, py: 2,
                borderBottom: i < appointments.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                cursor: 'pointer',
                '&:hover': { bgcolor: surface.hover },
              },
            }

            // Mobile: stacked card layout
            if (isMobile) {
              return (
                <Box key={appt.id} {...rowProps} sx={{ ...rowProps.sx, py: 1.75 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.25 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: { xs: '0.9rem', md: '0.875rem' } }}>
                        {appt.customers?.first_name} {appt.customers?.last_name}
                      </Typography>
                      <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block', fontSize: { xs: '0.8rem', md: '0.75rem' } }}>
                        {format(new Date(appt.scheduled_at), 'd MMM, HH:mm', { locale: ka })} · {appt.services?.name}
                        {appt.staff?.display_name ? ` · ${appt.staff.display_name}` : ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: { xs: '0.8rem', md: '0.75rem' } }}>
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
              <Box key={appt.id} {...rowProps} sx={{ ...rowProps.sx, display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center' }}>
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', minWidth: 0 }}>
                  {appt.payment_method === 'online'
                    ? <CreditCardOutlinedIcon sx={{ fontSize: 16 }} />
                    : <StorefrontOutlinedIcon sx={{ fontSize: 16 }} />}
                  <Typography variant="caption" noWrap>
                    {appt.payment_method === 'online' ? 'ონლაინ' : 'ადგილზე'}
                  </Typography>
                </Box>
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

        {/* Pagination — hidden while loading or with no results */}
        {!apptLoading && total > 0 && (
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
            rowsPerPageOptions={[10, 25, 50]}
            labelRowsPerPage={t('dashboard.rowsPerPage')}
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
            sx={{
              borderTop: '1px solid',
              borderColor: 'divider',
              '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', minHeight: 52, gap: 0.5 },
              '& .MuiTablePagination-actions button': { p: { xs: 1.25, md: 1 } },
            }}
          />
        )}
      </Box>

      {/* Detail dialog */}
      <Dialog open={!!selected} onClose={() => { setSelected(null); setConfirmingCancel(false); setConfirmingErase(false) }} maxWidth="sm" fullWidth>
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
                        data-testid="appt-staff-select"
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
                {/* A completed visit can be reviewed: share this capability link with
                    the client (via the owner's own Viber/WhatsApp). Gated by the
                    org-level reviews toggle. */}
                {selected.status === 'completed' && org.reviews_enabled && (
                  <CopyableText
                    label={t('reviews.reviewLinkLabel')}
                    text={`vis.ge/review/${selected.id.slice(0, 8)}…`}
                    value={`${window.location.origin}/review/${selected.id}`}
                  />
                )}
                {(selected.status === 'pending' || selected.status === 'approved') && (
                  <TextField
                    fullWidth size="small"
                    label="შიდა შენიშვნა (არასავალდებულო)"
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    multiline rows={2}
                    slotProps={{ htmlInput: { 'data-testid': 'appt-admin-note' } }}
                  />
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              {confirmingErase ? (
                <Button variant="contained" color="error" sx={{ mr: 'auto' }} data-testid="appt-confirm-erase"
                  onClick={() => eraseClientData(selected.id)} disabled={!!actionLoading}>
                  {t('dashboard.eraseConfirm')}
                </Button>
              ) : (
                <Button size="small" color="error" sx={{ mr: 'auto' }} data-testid="appt-erase"
                  onClick={() => setConfirmingErase(true)} disabled={!!actionLoading}>
                  {t('dashboard.eraseClientData')}
                </Button>
              )}
              <Button onClick={() => { setSelected(null); setConfirmingCancel(false); setConfirmingErase(false) }}>{t('common.cancel')}</Button>
              {selected.status === 'pending' && (
                <>
                  <Button variant="outlined" color="error" data-testid="appt-reject"
                    onClick={() => changeStatus(selected.id, 'rejected')} disabled={!!actionLoading}>
                    {t('dashboard.reject')}
                  </Button>
                  <Button variant="contained" color="success" data-testid="appt-approve"
                    onClick={() => changeStatus(selected.id, 'approved')} disabled={!!actionLoading}>
                    {t('dashboard.approve')}
                  </Button>
                </>
              )}
              {selected.status === 'approved' && (
                confirmingCancel ? (
                  <>
                    <Button onClick={() => setConfirmingCancel(false)} disabled={!!actionLoading} data-testid="appt-keep">
                      {t('dashboard.keepAppointment')}
                    </Button>
                    <Button variant="contained" color="error" data-testid="appt-confirm-cancel"
                      onClick={() => changeStatus(selected.id, 'cancelled')} disabled={!!actionLoading}>
                      {t('dashboard.confirmCancel')}
                    </Button>
                  </>
                ) : (
                  <Button variant="outlined" color="error" data-testid="appt-cancel"
                    onClick={() => setConfirmingCancel(true)} disabled={!!actionLoading}>
                    {t('dashboard.cancelAppointment')}
                  </Button>
                )
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Manual appointment entry (e.g. logging a booking taken over the phone) */}
      {addOpen && (
        <AddAppointmentDialog
          orgId={org.id}
          onClose={() => setAddOpen(false)}
          onCreated={() => { loadAppointments(); loadStats() }}
        />
      )}
    </Box>
  )
}
