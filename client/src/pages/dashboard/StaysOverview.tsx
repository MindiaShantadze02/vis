import { useCallback, useEffect, useState } from 'react'
import {
  Grid, Card, Typography, Box, Chip, Stack, Skeleton, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
} from '@mui/material'
import LoginOutlinedIcon from '@mui/icons-material/LoginOutlined'
import HotelOutlinedIcon from '@mui/icons-material/HotelOutlined'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, StatCard, EmptyState, CopyableText, useToast } from '@/components/ui'
import type { DashboardOutletContext } from './DashboardLayout'
import { useOutletContext } from 'react-router-dom'

type StayStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'checked_in' | 'checked_out' | 'no_show'

interface Stay {
  id: string
  check_in: string
  check_out: string
  guests: number
  nightly_rate: number
  total_amount: number
  status: StayStatus
  notes: string | null
  room_type_id: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  resources: { name: string } | null
}

const CHIP_COLOR: Record<StayStatus, 'warning' | 'success' | 'error' | 'default' | 'info' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  cancelled: 'default',
  checked_in: 'info',
  checked_out: 'secondary',
  no_show: 'error',
}

function statusLabelKey(s: StayStatus): string {
  if (s === 'checked_in') return 'hotel.statusCheckedIn'
  if (s === 'checked_out') return 'hotel.statusCheckedOut'
  if (s === 'no_show') return 'restaurant.statusNoShow'
  return `dashboard.${s}`
}

export default function StaysOverview() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const theme = useTheme()
  const toast = useToast()
  const { refreshSignal } = useOutletContext<DashboardOutletContext>()

  const [stays, setStays] = useState<Stay[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Stay | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const today = format(new Date(), 'yyyy-MM-dd')
    // Current & upcoming stays (anything not yet checked out).
    const { data } = await supabase
      .from('hotel_stays')
      .select('id, check_in, check_out, guests, nightly_rate, total_amount, status, notes, room_type_id, customers(first_name, last_name, phone_number), resources(name)')
      .eq('org_id', org.id)
      .gte('check_out', today)
      .order('check_in', { ascending: true })
    setStays((data ?? []) as unknown as Stay[])
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (refreshSignal > 0) load() }, [refreshSignal, load])

  async function changeStatus(id: string, status: StayStatus) {
    setActionLoading(true)
    const { error } = await supabase.from('hotel_stays').update({ status }).eq('id', id)
    if (error) {
      toast.error(error.message)
    } else {
      setStays(prev => prev.map(s => s.id === id ? { ...s, status } : s))
      toast.success(t('common.saved'))
      setSelected(null)
    }
    setActionLoading(false)
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  const arrivalsToday = stays.filter(s => s.check_in === today && !['rejected', 'cancelled', 'no_show'].includes(s.status)).length
  const inHouse = stays.filter(s => s.status === 'checked_in').length
  const pendingCount = stays.filter(s => s.status === 'pending').length

  if (!org) return null

  return (
    <Box>
      <PageHeader title={t('hotel.stays')} />

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

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label={t('hotel.arrivalsToday')} value={arrivalsToday} icon={<LoginOutlinedIcon />} color={theme.palette.primary.main} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label={t('hotel.inHouse')} value={inHouse} icon={<HotelOutlinedIcon />} color={theme.palette.success.main} loading={loading} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard label={t('dashboard.pending')} value={pendingCount} icon={<AccessTimeIcon />} color={theme.palette.warning.main} loading={loading} />
        </Grid>
      </Grid>

      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>{t('hotel.stays')}</Typography>

      <Card>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
            <Box key={i} sx={{ px: 2, py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton height={24} />
            </Box>
          ))
          : stays.length === 0
          ? <EmptyState icon={<EventBusyOutlinedIcon />} title={t('hotel.noStays')} />
          : stays.map((s, i) => (
            <Box
              key={s.id}
              data-testid="stay-row"
              onClick={() => setSelected(s)}
              sx={{
                px: 2, py: 1.75,
                borderBottom: i < stays.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 1.5,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {s.customers?.first_name} {s.customers?.last_name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {format(new Date(`${s.check_in}T00:00:00`), 'd MMM', { locale: ka })} – {format(new Date(`${s.check_out}T00:00:00`), 'd MMM', { locale: ka })}
                  {s.resources?.name ? ` · ${s.resources.name}` : ''} · {s.guests} {t('hotel.guests')}
                </Typography>
              </Box>
              <Chip size="small" label={t(statusLabelKey(s.status))} color={CHIP_COLOR[s.status]} />
            </Box>
          ))
        }
      </Card>

      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="xs" fullWidth>
        {selected && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              {selected.customers?.first_name} {selected.customers?.last_name}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={1.5}>
                {selected.resources?.name && <Field label={t('hotel.room')} value={selected.resources.name} />}
                <Field label={t('hotel.checkIn')} value={format(new Date(`${selected.check_in}T00:00:00`), 'd MMMM yyyy', { locale: ka })} />
                <Field label={t('hotel.checkOut')} value={format(new Date(`${selected.check_out}T00:00:00`), 'd MMMM yyyy', { locale: ka })} />
                <Field label={t('hotel.guests')} value={`${selected.guests}`} />
                <Field label={t('hotel.total')} value={`${selected.total_amount} ₾`} />
                {selected.customers?.phone_number && <Field label={t('booking.phone')} value={selected.customers.phone_number} />}
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('hotel.statusLabel')}</Typography>
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
                  <Button variant="outlined" color="error" data-testid="stay-reject"
                    onClick={() => changeStatus(selected.id, 'rejected')} disabled={actionLoading}>
                    {t('dashboard.reject')}
                  </Button>
                  <Button variant="contained" color="success" data-testid="stay-approve"
                    onClick={() => changeStatus(selected.id, 'approved')} disabled={actionLoading}>
                    {t('dashboard.approve')}
                  </Button>
                </>
              )}
              {selected.status === 'approved' && (
                <>
                  <Button variant="outlined" color="error" data-testid="stay-no-show"
                    onClick={() => changeStatus(selected.id, 'no_show')} disabled={actionLoading}>
                    {t('restaurant.markNoShow')}
                  </Button>
                  <Button variant="contained" color="info" data-testid="stay-check-in"
                    onClick={() => changeStatus(selected.id, 'checked_in')} disabled={actionLoading}>
                    {t('hotel.checkInAction')}
                  </Button>
                </>
              )}
              {selected.status === 'checked_in' && (
                <Button variant="contained" color="secondary" data-testid="stay-check-out"
                  onClick={() => changeStatus(selected.id, 'checked_out')} disabled={actionLoading}>
                  {t('hotel.checkOutAction')}
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  )
}
