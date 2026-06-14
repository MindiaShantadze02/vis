import { useEffect, useState } from 'react'
import { Grid, Card, CardContent, Typography, Box, Skeleton, Chip } from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, formatDistanceToNow } from 'date-fns'
import { ka } from 'date-fns/locale'

interface Stats {
  revenueThisWeek: number
  revenueThisMonth: number
  appointmentsToday: number
  appointmentsThisWeek: number
  pendingCount: number
}

interface RecentAppointment {
  id: string
  scheduled_at: string
  status: string
  customers: { first_name: string; last_name: string | null } | null
  services: { name: string; price: number } | null
}

function StatCard({
  label, value, icon, color, loading,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
  loading: boolean
}) {
  return (
    <Card>
      <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box
          sx={{
            width: 48, height: 48, borderRadius: 2,
            bgcolor: `${color}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {label}
          </Typography>
          {loading
            ? <Skeleton width={80} height={36} />
            : (
              <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }}>
                {value}
              </Typography>
            )
          }
        </Box>
      </CardContent>
    </Card>
  )
}

const STATUS_COLOR: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'error',
  cancelled: 'default',
  completed: 'default',
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'მოლოდინში',
  approved:  'დამტკიცებული',
  rejected:  'უარყოფილი',
  cancelled: 'გაუქმებული',
  completed: 'დასრულებული',
}

export default function OverviewPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<RecentAppointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!org) return
    loadStats()
  }, [org])

  async function loadStats() {
    if (!org) return
    setLoading(true)

    const now = new Date()
    const todayStart = startOfDay(now).toISOString()
    const todayEnd = endOfDay(now).toISOString()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 }).toISOString()
    const monthStart = startOfMonth(now).toISOString()
    const monthEnd = endOfMonth(now).toISOString()

    const [todayRes, weekRes, monthRes, pendingRes, recentRes] = await Promise.all([
      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .gte('scheduled_at', todayStart)
        .lte('scheduled_at', todayEnd)
        .not('status', 'in', '(rejected,cancelled)'),

      supabase
        .from('appointments')
        .select('id, services(price)', { count: 'exact' })
        .eq('org_id', org.id)
        .gte('scheduled_at', weekStart)
        .lte('scheduled_at', weekEnd)
        .not('status', 'in', '(rejected,cancelled)'),

      supabase
        .from('appointments')
        .select('id, services(price)')
        .eq('org_id', org.id)
        .gte('scheduled_at', monthStart)
        .lte('scheduled_at', monthEnd)
        .eq('payment_status', 'paid'),

      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('status', 'pending'),

      supabase
        .from('appointments')
        .select('id, scheduled_at, status, customers(first_name, last_name), services(name, price)')
        .eq('org_id', org.id)
        .not('status', 'in', '(rejected,cancelled)')
        .order('scheduled_at', { ascending: false })
        .limit(5),
    ])

    const weekRevenue = (weekRes.data ?? []).reduce(
      (sum, a) => sum + ((a.services as { price: number } | null)?.price ?? 0), 0
    )
    const monthRevenue = (monthRes.data ?? []).reduce(
      (sum, a) => sum + ((a.services as { price: number } | null)?.price ?? 0), 0
    )

    setStats({
      revenueThisWeek: weekRevenue,
      revenueThisMonth: monthRevenue,
      appointmentsToday: todayRes.count ?? 0,
      appointmentsThisWeek: weekRes.count ?? 0,
      pendingCount: pendingRes.count ?? 0,
    })
    setRecent((recentRes.data ?? []) as unknown as RecentAppointment[])
    setLoading(false)
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        {t('dashboard.overview')}
      </Typography>

      {/* Stat cards */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.revenueThisWeek')}
            value={`${stats?.revenueThisWeek ?? 0} ₾`}
            icon={<TrendingUpIcon />}
            color="#3D52D5"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.revenueThisMonth')}
            value={`${stats?.revenueThisMonth ?? 0} ₾`}
            icon={<TrendingUpIcon />}
            color="#059669"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.todayAppointments')}
            value={stats?.appointmentsToday ?? 0}
            icon={<CalendarTodayIcon />}
            color="#7C3AED"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label={t('dashboard.pendingApprovals')}
            value={stats?.pendingCount ?? 0}
            icon={<AccessTimeIcon />}
            color="#F59E0B"
            loading={loading}
          />
        </Grid>
      </Grid>

      {/* Recent appointments */}
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
        ბოლო ჯავშნები
      </Typography>
      <Card>
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
            <Box key={i} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton height={24} width="60%" />
              <Skeleton height={18} width="40%" />
            </Box>
          ))
          : recent.length === 0
          ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <CheckCircleOutlineIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                ჯავშნები არ არის
              </Typography>
            </Box>
          )
          : recent.map((appt, i) => (
            <Box
              key={appt.id}
              sx={{
                p: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                borderBottom: i < recent.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {appt.customers?.first_name} {appt.customers?.last_name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {appt.services?.name} ·{' '}
                  {formatDistanceToNow(new Date(appt.scheduled_at), { addSuffix: true, locale: ka })}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {appt.services?.price} ₾
                </Typography>
                <Chip
                  label={STATUS_LABEL[appt.status] ?? appt.status}
                  color={STATUS_COLOR[appt.status] ?? 'default'}
                  size="small"
                  sx={{ mt: 0.25 }}
                />
              </Box>
            </Box>
          ))
        }
      </Card>
    </Box>
  )
}
