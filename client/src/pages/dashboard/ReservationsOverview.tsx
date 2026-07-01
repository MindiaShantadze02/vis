import { useCallback, useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Typography, Box, Chip, Stack, Skeleton,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, useTheme,
} from '@mui/material'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { EventSeatOutlined as EventSeatOutlinedIcon } from '@/components/icons'
import { AccessTime as AccessTimeIcon } from '@/components/icons'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { Add as AddIcon } from '@/components/icons'
import { format, startOfDay, endOfDay } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, StatStrip, EmptyState, CopyableText, useToast } from '@/components/ui'
import AddReservationDialog from './AddReservationDialog'
import type { DashboardOutletContext } from './DashboardLayout'
import { surface } from '@/theme/theme'

type ReservationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed' | 'no_show'

interface Reservation {
  id: string
  reserved_at: string
  turn_minutes: number
  party_size: number
  status: ReservationStatus
  notes: string | null
  table_id: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  resources: { name: string; capacity: number } | null
}

const CHIP_COLOR: Record<ReservationStatus, 'warning' | 'success' | 'error' | 'default' | 'info' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'default',
  completed: 'info',
  no_show: 'secondary',
}

export default function ReservationsOverview() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const theme = useTheme()
  const toast = useToast()
  const { refreshSignal } = useOutletContext<DashboardOutletContext>()

  const [reservations, setReservations] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Reservation | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    // Upcoming (and today's) reservations; sorted by seating time.
    const { data } = await supabase
      .from('restaurant_reservations')
      .select('id, reserved_at, turn_minutes, party_size, status, notes, table_id, customers(first_name, last_name, phone_number), resources(name, capacity)')
      .eq('org_id', org.id)
      .gte('reserved_at', startOfDay(new Date()).toISOString())
      .order('reserved_at', { ascending: true })
    setReservations((data ?? []) as unknown as Reservation[])
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])
  // Refetch when the layout bumps the signal (e.g. acting on a notification).
  useEffect(() => { if (refreshSignal > 0) load() }, [refreshSignal, load])

  async function changeStatus(id: string, status: ReservationStatus) {
    setActionLoading(true)
    const { error } = await supabase.from('restaurant_reservations').update({ status }).eq('id', id)
    if (error) {
      toast.error(error.message)
    } else {
      setReservations(prev => prev.map(r => r.id === id ? { ...r, status } : r))
      toast.success(t('common.saved'))
      setSelected(null)
    }
    setActionLoading(false)
  }

  // Stats from today's reservations (the list already starts at today).
  const now = new Date()
  const todayEndMs = endOfDay(now).getTime()
  const todays = reservations.filter(r => {
    const ms = new Date(r.reserved_at).getTime()
    return ms <= todayEndMs && !['rejected', 'cancelled', 'no_show'].includes(r.status)
  })
  const coversToday = todays.reduce((sum, r) => sum + r.party_size, 0)
  const pendingCount = reservations.filter(r => r.status === 'pending').length

  if (!org) return null

  return (
    <Box>
      <PageHeader
        title={t('restaurant.reservations')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-testid="resv-add-btn">
            {t('restaurant.addReservation')}
          </Button>
        }
      />

      {addOpen && org && (
        <AddReservationDialog orgId={org.id} onClose={() => setAddOpen(false)} onCreated={load} />
      )}

      {org.slug && (
        <Box sx={{ mb: 4, maxWidth: 480 }}>
          <CopyableText
            label="თქვენი ბუქინგ ბმული"
            text={`vis.ge/book/${org.slug}`}
            value={`https://vis.ge/book/${org.slug}`}
            href={`https://vis.ge/book/${org.slug}`}
          />
        </Box>
      )}

      <StatStrip
        loading={loading}
        items={[
          { label: t('restaurant.todayReservations'), value: todays.length, icon: <EventSeatOutlinedIcon />, color: theme.palette.primary.main },
          { label: t('restaurant.covers'), value: coversToday, icon: <GroupOutlinedIcon />, color: theme.palette.success.main },
          { label: t('dashboard.pending'), value: pendingCount, icon: <AccessTimeIcon />, color: theme.palette.warning.main },
        ]}
      />

      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>{t('restaurant.reservations')}</Typography>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
            <Box key={i} sx={{ px: 2, py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton height={24} />
            </Box>
          ))
          : reservations.length === 0
          ? <EmptyState icon={<EventBusyOutlinedIcon />} title={t('restaurant.noReservations')} />
          : reservations.map((r, i) => (
            <Box
              key={r.id}
              data-testid="resv-row"
              onClick={() => setSelected(r)}
              sx={{
                px: 2, py: 1.75,
                borderBottom: i < reservations.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 1.5,
                '&:hover': { bgcolor: surface.hover },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {r.customers?.first_name} {r.customers?.last_name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {format(new Date(r.reserved_at), 'd MMM, HH:mm', { locale: ka })}
                  {' · '}{r.party_size} {t('restaurant.guests')}
                  {r.resources?.name ? ` · ${r.resources.name}` : ''}
                </Typography>
              </Box>
              <Chip size="small" label={t(statusLabelKey(r.status))} color={CHIP_COLOR[r.status]} />
            </Box>
          ))
        }
      </Box>

      {/* Detail / actions dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="xs" fullWidth>
        {selected && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              {selected.customers?.first_name} {selected.customers?.last_name}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={1.5}>
                <Field label={t('restaurant.partySize')} value={`${selected.party_size} ${t('restaurant.guests')}`} />
                <Field label={t('booking.summaryDate')} value={format(new Date(selected.reserved_at), 'd MMMM yyyy, HH:mm', { locale: ka })} />
                {selected.resources?.name && <Field label={t('restaurant.table')} value={selected.resources.name} />}
                {selected.customers?.phone_number && <Field label={t('booking.phone')} value={selected.customers.phone_number} />}
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('restaurant.statusLabel')}</Typography>
                  <Box sx={{ mt: 0.25 }}>
                    <Chip size="small" label={t(statusLabelKey(selected.status))} color={CHIP_COLOR[selected.status]} />
                  </Box>
                </Box>
                {selected.notes && <Field label={t('booking.notes')} value={selected.notes} />}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap' }}>
              <Button onClick={() => setSelected(null)}>{t('common.cancel')}</Button>
              {selected.status === 'pending' && (
                <>
                  <Button variant="outlined" color="error" data-testid="resv-reject"
                    onClick={() => changeStatus(selected.id, 'rejected')} disabled={actionLoading}>
                    {t('dashboard.reject')}
                  </Button>
                  <Button variant="contained" color="success" data-testid="resv-approve"
                    onClick={() => changeStatus(selected.id, 'approved')} disabled={actionLoading}>
                    {t('dashboard.approve')}
                  </Button>
                </>
              )}
              {selected.status === 'approved' && (
                <>
                  <Button variant="outlined" color="error" data-testid="resv-no-show"
                    onClick={() => changeStatus(selected.id, 'no_show')} disabled={actionLoading}>
                    {t('restaurant.markNoShow')}
                  </Button>
                  <Button variant="contained" color="info" data-testid="resv-completed"
                    onClick={() => changeStatus(selected.id, 'completed')} disabled={actionLoading}>
                    {t('restaurant.markCompleted')}
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

function statusLabelKey(status: ReservationStatus): string {
  return status === 'no_show' ? 'restaurant.statusNoShow' : `dashboard.${status}`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  )
}
