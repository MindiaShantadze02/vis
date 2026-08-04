import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import {
  Typography, Box, Skeleton, Button, Chip, Divider,
  TextField, Select, MenuItem, FormControl, InputLabel, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, TablePagination,
  useMediaQuery, useTheme, FormControlLabel, Checkbox, Badge,
} from '@mui/material'
import { AppDatePicker } from '@/components/AppDatePicker'
import { Add as AddIcon } from '@/components/icons'
import { TuneOutlined as TuneOutlinedIcon } from '@/components/icons'
import { TrendingUp as TrendingUpIcon } from '@/components/icons'
import { CalendarToday as CalendarTodayIcon } from '@/components/icons'
import { AccessTime as AccessTimeIcon } from '@/components/icons'
import { Search as SearchIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { CreditCardOutlined as CreditCardOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { dateLocale } from '@/lib/dateLocale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { PageHeader, StatStrip, StatusChip, EmptyState, CopyableText, LoadingState, useToast, SideDrawer } from '@/components/ui'
import type { AppointmentStatus } from '@/components/ui'
import { surface } from '@/theme/theme'
import { isValidUrl, FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import AddAppointmentDialog from './AddAppointmentDialog'
import PendingInvites from './PendingInvites'
import OnboardingChecklist from '@/components/OnboardingChecklist'
import UsageMeter from '@/components/UsageMeter'
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
  meeting_link: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  services: { name: string; price: number; duration_minutes: number; location_type: string } | null
  staff: StaffRef | null
}

interface Stats {
  revenueThisWeek: number
  revenueThisMonth: number
  appointmentsToday: number
  pendingCount: number
}

const ALL_STATUSES: AppointmentStatus[] = ['pending', 'approved', 'rejected', 'cancelled', 'completed', 'no_show']
const GRID_COLS = '140px 1fr 1fr 100px 90px 140px'

// An online-service appointment that's still live (pending/approved) but has no
// join link yet — the owner needs to attach and send one. Drives the list cue
// and the dialog's meeting-link section.
const needsMeetingLink = (a: Appointment) =>
  a.services?.location_type === 'online' && !a.meeting_link &&
  (a.status === 'pending' || a.status === 'approved')

const isOnlineAppt = (a: Appointment) => a.services?.location_type === 'online'

// ── Main Page ─────────────────────────────────────────────────

export default function OverviewPage() {
  const { t } = useTranslation()
  const { org, refreshBilling } = useOrg()
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
  // Which quick-preset chip (if any) produced the current date range, so we can
  // highlight it. Cleared when the admin edits a date picker by hand.
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'upcoming' | null>(null)
  const [serviceFilter, setServiceFilter] = useState<string>('all')
  const [staffFilter, setStaffFilter] = useState<string>('all')
  const [paymentFilter, setPaymentFilter] = useState<string>('all')
  // Mobile: the attribute + date filters collapse behind a single button that
  // opens this dialog (search stays inline as the primary control).
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [services, setServices] = useState<{ id: string; name: string }[]>([])
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [total, setTotal] = useState(0)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [selected, setSelected] = useState<Appointment | null>(null)
  // Look up whether the opened appointment belongs to a recurring series.
  useEffect(() => {
    if (!selected) { setSeriesId(null); return }
    let cancelled = false
    supabase.from('appointments').select('series_id').eq('id', selected.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setSeriesId((data as { series_id: string | null } | null)?.series_id ?? null) })
    return () => { cancelled = true }
  }, [selected])
  const [adminNote, setAdminNote] = useState('')
  // Per-appointment online meeting link, edited in the detail dialog.
  const [meetingLink, setMeetingLink] = useState('')
  const [meetingLinkSubmitted, setMeetingLinkSubmitted] = useState(false)
  const [sendingLink, setSendingLink] = useState(false)
  // Inline two-step guard for cancelling an already-approved appointment.
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // Recurring-series id of the selected appointment (fetched on open), so we can
  // offer "cancel the whole series" alongside the single-occurrence cancel.
  const [seriesId, setSeriesId] = useState<string | null>(null)
  // Cancel-with-refund choice for PAID online appointments (Fresha model: the
  // business decides at cancel time — default is to give the money back, but
  // e.g. a late cancellation may deliberately keep it).
  const [refundOnCancel, setRefundOnCancel] = useState(true)
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
    // Active services power the "Service" filter dropdown.
    supabase
      .from('services')
      .select('id, name')
      .eq('org_id', org.id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setServices((data ?? []) as { id: string; name: string }[]))
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
  }, [org, statusFilter, debouncedSearch, dateFrom, dateTo, serviceFilter, staffFilter, paymentFilter, page, rowsPerPage])

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
      p_service_id: serviceFilter === 'all' ? null : serviceFilter,
      p_staff_id: staffFilter === 'all' ? null : staffFilter,
      p_payment_status: paymentFilter === 'all' ? null : paymentFilter,
      p_limit: rowsPerPage,
      p_offset: page * rowsPerPage,
    })

    const rows = (data ?? []) as unknown as (Appointment & { total_count?: number })[]
    setAppointments(rows as unknown as Appointment[])
    // total_count is identical on every row; absent when zero rows match.
    setTotal(rows[0]?.total_count ?? 0)
    setApptLoading(false)
  }

  // One-tap date ranges. "Upcoming" is open-ended (from today onward).
  function applyPreset(preset: 'today' | 'week' | 'month' | 'upcoming') {
    const now = new Date()
    if (preset === 'today') { setDateFrom(startOfDay(now)); setDateTo(endOfDay(now)) }
    else if (preset === 'week') { setDateFrom(startOfWeek(now, { weekStartsOn: 1 })); setDateTo(endOfWeek(now, { weekStartsOn: 1 })) }
    else if (preset === 'month') { setDateFrom(startOfMonth(now)); setDateTo(endOfMonth(now)) }
    else { setDateFrom(startOfDay(now)); setDateTo(null) }
    setDatePreset(preset)
    setPage(0)
  }

  // Any filter (other than pagination) is narrowing the list right now.
  const filtersActive =
    statusFilter !== 'all' || search !== '' || debouncedSearch !== '' ||
    serviceFilter !== 'all' || staffFilter !== 'all' || paymentFilter !== 'all' ||
    dateFrom !== null || dateTo !== null

  // How many of the collapsible filters (everything except the always-visible
  // search) are active — drives the badge on the mobile "Filters" button.
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (serviceFilter !== 'all' ? 1 : 0) +
    (staffFilter !== 'all' ? 1 : 0) +
    (paymentFilter !== 'all' ? 1 : 0) +
    (dateFrom !== null || dateTo !== null ? 1 : 0)

  function resetFilters() {
    setStatusFilter('all'); setSearch(''); setDebouncedSearch('')
    setServiceFilter('all'); setStaffFilter('all'); setPaymentFilter('all')
    setDateFrom(null); setDateTo(null); setDatePreset(null); setPage(0)
  }

  async function changeStatus(id: string, status: 'approved' | 'rejected' | 'cancelled' | 'no_show') {
    setActionLoading(id)

    // Cancelling a PAID online appointment with the refund box ticked routes
    // through the refund-payment edge function, which changes the status AND
    // refunds the charge in one server-side call — a failed refund leaves the
    // appointment untouched, so pressing cancel again is a clean retry.
    const withRefund =
      status === 'cancelled' && refundOnCancel &&
      selected?.id === id &&
      selected.payment_method === 'online' && selected.payment_status === 'paid'

    if (withRefund) {
      const { data, error: fnErr } = await supabase.functions.invoke('refund-payment', {
        body: { appointment_id: id, new_status: 'cancelled', admin_note: adminNote || null },
      })
      if (fnErr || !data?.ok) {
        // Appointment is unchanged server-side; keep the dialog open for retry.
        toast.error(t('dashboard.refundFailed'))
        setActionLoading(null)
        return
      }
      setAppointments(prev => prev.map(a =>
        a.id === id ? { ...a, status: 'cancelled', payment_status: 'refunded' } : a))
      loadStats()
      refreshBilling()  // running bill drops when a billable appt is cancelled
      toast.success(t('dashboard.refundDone'))
      setSelected(null)
      setAdminNote('')
      setConfirmingCancel(false)
      setActionLoading(null)
      return
    }

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
      refreshBilling()  // a status change can shift the current-period billable count
      toast.success(t(`dashboard.${status}`))
      setSelected(null)
      setAdminNote('')
      setConfirmingCancel(false)
    }
    setActionLoading(null)
  }

  // Cancel the whole recurring series this appointment belongs to (all future
  // occurrences).
  async function cancelSeries(id: string) {
    if (!seriesId) return
    setActionLoading(id)
    const { data, error } = await supabase.rpc('cancel_recurrence_series', { p_series_id: seriesId })
    setActionLoading(null)
    if (error) { toast.error(error.message); return }
    toast.success(t('recurring.seriesCancelled', { count: (data as number) ?? 0 }))
    setSelected(null)
    loadAppointments()
    loadStats()
    refreshBilling()
  }

  // Save the per-appointment join link and text it to the customer in one
  // action (the request_meeting_link_sms RPC POSTs to the send-sms edge fn).
  // Kept separate from status changes so it works on already-approved
  // appointments — including paid ones auto-approved before the owner sees them.
  async function sendMeetingLink() {
    if (!selected) return
    const link = meetingLink.trim()
    setMeetingLinkSubmitted(true)
    if (!isValidUrl(link)) {
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDialog-root') ?? document)
      return
    }
    setSendingLink(true)
    const { error: upErr } = await supabase
      .from('appointments')
      .update({ meeting_link: link, updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    if (upErr) { toast.error(upErr.message); setSendingLink(false); return }

    const { error: rpcErr } = await supabase.rpc('request_meeting_link_sms', { p_appointment_id: selected.id })
    setSendingLink(false)
    if (rpcErr) { toast.error(rpcErr.message); return }

    // Reflect the saved link locally so the "needs link" cue clears immediately.
    setAppointments(prev => prev.map(a => a.id === selected.id ? { ...a, meeting_link: link } : a))
    setSelected(s => (s ? { ...s, meeting_link: link } : s))
    toast.success(t('dashboard.meetingLinkSent'))
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

  // The always-visible search box (kept inline on every breakpoint).
  const searchField = (
    <TextField
      size="small"
      placeholder={`${t('common.search')}...`}
      value={search}
      onChange={e => setSearch(e.target.value)}
      slotProps={{
        input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> },
        htmlInput: { 'data-testid': 'appt-search' },
      }}
      sx={{ flexGrow: { sm: 1 }, minWidth: { sm: 200 }, maxWidth: { sm: 300 }, width: { xs: '100%', sm: 'auto' } }}
    />
  )

  // Attribute dropdowns (status / service / staff / payment). Collapsed into the
  // mobile filter dialog; rendered inline on desktop.
  const attributeFilters = (
    <>
      <FormControl size="small" sx={{ minWidth: { sm: 130 }, width: { xs: '100%', sm: 'auto' } }}>
        <InputLabel>{t('calendar.status')}</InputLabel>
        <Select
          value={statusFilter}
          label={t('calendar.status')}
          onChange={e => { setStatusFilter(e.target.value as AppointmentStatus | 'all'); setPage(0) }}
          data-testid="appt-status-filter"
        >
          <MenuItem value="all">{t('calendar.all')}</MenuItem>
          {ALL_STATUSES.map(s => (
            <MenuItem key={s} value={s}>{t(`dashboard.${s}`)}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } }}>
        <InputLabel>{t('dashboard.filterService')}</InputLabel>
        <Select
          value={serviceFilter}
          label={t('dashboard.filterService')}
          onChange={e => { setServiceFilter(e.target.value); setPage(0) }}
          data-testid="appt-service-filter"
        >
          <MenuItem value="all">{t('dashboard.allServices')}</MenuItem>
          {services.map(s => (
            <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {/* Staff filter only helps multi-specialist orgs — a solo practitioner
          never sees it. */}
      {bookableMembers.length > 1 && (
        <FormControl size="small" sx={{ minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } }}>
          <InputLabel>{t('dashboard.staff')}</InputLabel>
          <Select
            value={staffFilter}
            label={t('dashboard.staff')}
            onChange={e => { setStaffFilter(e.target.value); setPage(0) }}
            data-testid="appt-staff-filter"
          >
            <MenuItem value="all">{t('dashboard.allStaff')}</MenuItem>
            {bookableMembers.map(m => (
              <MenuItem key={m.id} value={m.id}>{m.display_name || '—'}</MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      <FormControl size="small" sx={{ minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } }}>
        <InputLabel>{t('dashboard.filterPayment')}</InputLabel>
        <Select
          value={paymentFilter}
          label={t('dashboard.filterPayment')}
          onChange={e => { setPaymentFilter(e.target.value); setPage(0) }}
          data-testid="appt-payment-filter"
        >
          <MenuItem value="all">{t('dashboard.allPayments')}</MenuItem>
          <MenuItem value="unpaid">{t('dashboard.payUnpaid')}</MenuItem>
          <MenuItem value="paid">{t('dashboard.payPaid')}</MenuItem>
          <MenuItem value="refunded">{t('dashboard.payRefunded')}</MenuItem>
        </Select>
      </FormControl>
    </>
  )

  // Quick-date presets + explicit from/to range. Collapsed into the mobile
  // filter dialog; rendered inline on desktop.
  const dateFilters = (
    <>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {([
          ['today', 'presetToday'],
          ['week', 'presetWeek'],
          ['month', 'presetMonth'],
          ['upcoming', 'presetUpcoming'],
        ] as const).map(([key, label]) => (
          <Chip
            key={key}
            label={t(`dashboard.${label}`)}
            size="small"
            color={datePreset === key ? 'primary' : 'default'}
            variant={datePreset === key ? 'filled' : 'outlined'}
            onClick={() => applyPreset(key)}
            data-testid={`preset-${key}`}
          />
        ))}
      </Box>
      <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' }, my: 0.5 }} />
      <AppDatePicker
        label={t('dashboard.dateFrom')}
        value={dateFrom}
        onChange={v => { setDateFrom(v); setDatePreset(null); setPage(0) }}
        format="dd MMM yyyy"
        slotProps={{
          textField: { size: 'small', sx: { minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } } },
          field: { clearable: true, onClear: () => { setDateFrom(null); setDatePreset(null); setPage(0) } },
        }}
      />
      <AppDatePicker
        label={t('dashboard.dateTo')}
        value={dateTo}
        minDate={dateFrom ?? undefined}
        onChange={v => { setDateTo(v); setDatePreset(null); setPage(0) }}
        format="dd MMM yyyy"
        slotProps={{
          textField: { size: 'small', sx: { minWidth: { sm: 150 }, width: { xs: '100%', sm: 'auto' } } },
          field: { clearable: true, onClear: () => { setDateTo(null); setDatePreset(null); setPage(0) } },
        }}
      />
    </>
  )

  return (
    <Box>
      <PageHeader title={t('dashboard.overview')} />

      {/* New-org checklist (self-hides once dismissed) + always-visible usage
          meter against the enforced monthly cap. */}
      <OnboardingChecklist />
      <UsageMeter />

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

      {/* Appointments — header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>{t('dashboard.appointments')}</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-testid="appt-add-btn">
          {t('calendar.addAppointment')}
        </Button>
      </Box>

      {/* Filters. On desktop: two aligned rows (search + attribute dropdowns,
          then the date range). On mobile everything except the search collapses
          behind a single "Filters" button that opens a dialog, so the list stays
          in view. */}
      {isMobile ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2.5 }}>
          {searchField}
          <Badge badgeContent={activeFilterCount} color="primary">
            <Button
              variant="outlined"
              startIcon={<TuneOutlinedIcon />}
              onClick={() => setFiltersOpen(true)}
              data-testid="appt-filters-btn"
              sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {t('dashboard.filters')}
            </Button>
          </Badge>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2.5 }}>
          {/* Row 1: search + attribute filters */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {searchField}
            {attributeFilters}
          </Box>
          {/* Row 2: quick-date presets grouped with the explicit date range + reset */}
          <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
            {dateFilters}
            {filtersActive && (
              <Button size="small" variant="text" onClick={resetFilters} data-testid="reset-filters">
                {t('dashboard.resetFilters')}
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* Mobile filter dialog — holds the collapsed attribute + date filters. */}
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>{t('dashboard.filters')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {attributeFilters}
            <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center' }}>
              {dateFilters}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {filtersActive && (
            <Button variant="text" onClick={resetFilters} data-testid="reset-filters" sx={{ mr: 'auto' }}>
              {t('dashboard.resetFilters')}
            </Button>
          )}
          <Button variant="contained" onClick={() => setFiltersOpen(false)} data-testid="appt-filters-done">
            {t('dashboard.showResults')}
          </Button>
        </DialogActions>
      </Dialog>

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
            {[t('calendar.time'), t('calendar.client'), t('calendar.service'), t('calendar.payment'), t('calendar.price'), t('calendar.status')].map(h => (
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
          // A fresh org with no bookings at all gets a welcoming "share your
          // link" nudge; "not found" is reserved for filtered/searched views.
          ? (!filtersActive
            ? <EmptyState
                icon={<EventBusyOutlinedIcon />}
                title={t('dashboard.noBookingsYetTitle')}
                caption={t('dashboard.noBookingsYetCaption')}
              />
            : <EmptyState icon={<EventBusyOutlinedIcon />} title={t('dashboard.noBookingsFound')} />)
          : appointments.map((appt, i) => {
            // Online appointments still missing a join link get a warm warning
            // tint + a left accent stripe so they stand out in the list (matches
            // the "Link needed" chip). The 3px stripe eats 3px of the left
            // padding so the row content stays aligned with the others.
            const needsLink = needsMeetingLink(appt)
            const rowProps = {
              'data-testid': 'appt-row',
              onClick: () => {
                setSelected(appt)
                setAdminNote(appt.admin_notes ?? '')
                setMeetingLink(appt.meeting_link ?? '')
                setMeetingLinkSubmitted(false)
                setConfirmingCancel(false)
              },
              sx: {
                px: 2, py: 2,
                borderBottom: i < appointments.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                cursor: 'pointer',
                // Warning tint (palette.warning.main #C8801F) for link-needed rows.
                ...(needsLink && {
                  bgcolor: 'rgba(200,128,31,0.09)',
                  borderLeft: '3px solid',
                  borderLeftColor: 'warning.main',
                  pl: 'calc(16px - 3px)',
                }),
                '&:hover': { bgcolor: needsLink ? 'rgba(200,128,31,0.16)' : surface.hover },
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
                        {format(new Date(appt.scheduled_at), 'd MMM, HH:mm', { locale: dateLocale() })} · {appt.services?.name}
                        {appt.staff?.display_name ? ` · ${appt.staff.display_name}` : ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: { xs: '0.8rem', md: '0.75rem' } }}>
                        {appt.services?.price} ₾
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                      <StatusChip status={appt.status} />
                      {needsMeetingLink(appt) && (
                        <Chip size="small" color="warning" variant="outlined"
                          label={t('dashboard.meetingLinkNeeded')} data-testid="appt-needs-link" />
                      )}
                    </Box>
                  </Box>
                </Box>
              )
            }

            // Desktop: grid row
            return (
              <Box key={appt.id} {...rowProps} sx={{ ...rowProps.sx, display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {format(new Date(appt.scheduled_at), 'dd MMM', { locale: dateLocale() })}
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
                    {appt.payment_method === 'online' ? t('settings.locationOnline') : t('settings.locationInPerson')}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {appt.services?.price} ₾
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                  <StatusChip status={appt.status} />
                  {needsMeetingLink(appt) && (
                    <Chip size="small" color="warning" variant="outlined"
                      label={t('dashboard.meetingLinkNeeded')} data-testid="appt-needs-link" />
                  )}
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

      {/* Detail drawer */}
      <SideDrawer
        open={!!selected}
        onClose={() => { setSelected(null); setConfirmingCancel(false) }}
        title={selected ? `${selected.customers?.first_name ?? ''} ${selected.customers?.last_name ?? ''}` : ''}
        actions={selected && (selected.status === 'pending' || selected.status === 'approved') ? (
          <>
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
                <>
                  {/* No-show: the slot was consumed (still counts toward usage)
                      — distinct from a cancel. */}
                  <Button variant="outlined" color="warning" data-testid="appt-no-show"
                    onClick={() => changeStatus(selected.id, 'no_show')} disabled={!!actionLoading}>
                    {t('dashboard.markNoShow')}
                  </Button>
                  <Button variant="outlined" color="error" data-testid="appt-cancel"
                    onClick={() => { setRefundOnCancel(true); setConfirmingCancel(true) }} disabled={!!actionLoading}>
                    {t('dashboard.cancelAppointment')}
                  </Button>
                  {seriesId && (
                    <Button variant="outlined" color="error" data-testid="appt-cancel-series"
                      onClick={() => cancelSeries(selected.id)} disabled={!!actionLoading}>
                      {t('recurring.cancelSeries')}
                    </Button>
                  )}
                </>
              )
            )}
          </>
        ) : undefined}
      >
        {selected && (
          <>
            <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.service')}</Typography>
                  <Typography variant="body2">{selected.services?.name} — {selected.services?.price} ₾</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.dateTime')}</Typography>
                  <Typography variant="body2">
                    {format(new Date(selected.scheduled_at), 'd MMMM yyyy, HH:mm', { locale: dateLocale() })}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.phone')}</Typography>
                  <Typography variant="body2">{selected.customers?.phone_number}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.status')}</Typography>
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
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.note')}</Typography>
                    <Typography variant="body2">{selected.notes}</Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.payment')}</Typography>
                  <Typography variant="body2">
                    {selected.payment_method === 'online' ? t('settings.locationOnline') : t('settings.locationInPerson')} ·{' '}
                    {selected.payment_status === 'refunded'
                      ? `↩ ${t('dashboard.refunded')}`
                      : selected.payment_status === 'paid' ? t('calendar.paid') : t('calendar.unpaid')}
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
                    label={t('calendar.internalNoteOptional')}
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    multiline rows={2}
                    slotProps={{ htmlInput: { 'data-testid': 'appt-admin-note' } }}
                  />
                )}
                {/* Online services get a per-appointment join link the owner
                    sends to the customer by SMS. Not on the confirmation SMS,
                    so it works for paid bookings auto-approved before this. */}
                {isOnlineAppt(selected) && (selected.status === 'pending' || selected.status === 'approved') && (
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
                      {t('dashboard.meetingLinkTitle')}
                    </Typography>
                    {/* MUI v9 Stack no longer accepts alignItems as a prop — sx only. */}
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <TextField
                        fullWidth size="small"
                        label={t('settings.meetingLink')}
                        placeholder="https://"
                        value={meetingLink}
                        onChange={e => setMeetingLink(e.target.value)}
                        error={meetingLinkSubmitted && !isValidUrl(meetingLink.trim())}
                        helperText={
                          meetingLinkSubmitted && !isValidUrl(meetingLink.trim())
                            ? t('validation.invalidUrl')
                            : t('dashboard.meetingLinkHelp')
                        }
                        slotProps={{ htmlInput: { inputMode: 'url', maxLength: FIELD_LIMITS.meetingLink, 'data-testid': 'appt-meeting-link' } }}
                      />
                      <Button
                        variant="contained"
                        onClick={sendMeetingLink}
                        disabled={sendingLink}
                        data-testid="appt-send-meeting-link"
                        sx={{ whiteSpace: 'nowrap', mt: { sm: 0.25 } }}
                      >
                        {t('dashboard.sendMeetingLink')}
                      </Button>
                    </Stack>
                  </Box>
                )}
                {/* Refund choice — only while confirming the cancellation of a
                    PAID online appointment. Checked by default; unticking keeps
                    the money (e.g. a late cancellation per the business's
                    policy) and the cancel becomes a plain status change. */}
                {confirmingCancel
                  && selected.payment_method === 'online'
                  && selected.payment_status === 'paid' && (
                  <Box sx={{
                    p: 1.5, borderRadius: 2,
                    border: '1px solid', borderColor: 'divider',
                    bgcolor: surface.hover,
                  }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={refundOnCancel}
                          onChange={e => setRefundOnCancel(e.target.checked)}
                          size="small"
                          data-testid="appt-refund-checkbox"
                        />
                      }
                      label={
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {t('dashboard.refundCustomer')}
                        </Typography>
                      }
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', pl: 3.5 }}>
                      {t('dashboard.refundHint')}
                    </Typography>
                  </Box>
                )}
              </Stack>
          </>
        )}
      </SideDrawer>

      {/* Manual appointment entry (e.g. logging a booking taken over the phone) */}
      {addOpen && (
        <AddAppointmentDialog
          orgId={org.id}
          onClose={() => setAddOpen(false)}
          onCreated={() => { loadAppointments(); loadStats(); refreshBilling() }}
        />
      )}
    </Box>
  )
}
