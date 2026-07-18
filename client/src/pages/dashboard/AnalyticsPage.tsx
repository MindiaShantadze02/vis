import { useCallback, useEffect, useState } from 'react'
import {
  Box, Card, CardContent, Typography, ToggleButtonGroup, ToggleButton, Grid, Stack, Divider,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState } from '@/components/ui'
import { parseAnalytics, pct, type OrgAnalytics } from '@/lib/analytics'

// A labelled horizontal bar (value / max), theme-accented. Dependency-free.
function Bar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.4 }}>
      <Typography variant="caption" sx={{ width: 44, flexShrink: 0, color: 'text.secondary' }}>{label}</Typography>
      <Box sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${w}%`, height: '100%', bgcolor: 'primary.main', borderRadius: 5, transition: 'width .3s' }} />
      </Box>
      <Typography variant="caption" sx={{ width: 52, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>
        {value}{suffix ?? ''}
      </Typography>
    </Box>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{label}</Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, color: accent ? 'primary.main' : 'text.primary' }}>{value}</Typography>
      </CardContent>
    </Card>
  )
}

/**
 * Owner analytics — money-first dashboard for a date range. All numbers come
 * pre-aggregated from get_org_analytics (business time); charts are lightweight
 * CSS bars (no charting dependency).
 */
export default function AnalyticsPage() {
  const { t, i18n } = useTranslation()
  const { org } = useOrg()
  const [days, setDays] = useState<30 | 90 | 365>(30)
  const [data, setData] = useState<OrgAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const to = new Date()
    const from = new Date(Date.now() - days * 86_400_000)
    const { data: raw } = await supabase.rpc('get_org_analytics', {
      p_org_id: org.id, p_from: from.toISOString().slice(0, 10), p_to: to.toISOString().slice(0, 10),
    })
    setData(parseAnalytics(raw))
    setLoading(false)
  }, [org, days])

  useEffect(() => { load() }, [load])

  const money = (n: number) => `${n.toLocaleString(i18n.resolvedLanguage)} ₾`
  const weekdayLabels = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .map(d => t(`days.${d}`).slice(0, 3))

  return (
    <Box>
      <PageHeader
        title={t('analytics.title')}
        action={
          <ToggleButtonGroup exclusive size="small" value={days} onChange={(_, v) => v && setDays(v)}>
            <ToggleButton value={30} data-testid="analytics-30">{t('analytics.days30')}</ToggleButton>
            <ToggleButton value={90}>{t('analytics.days90')}</ToggleButton>
            <ToggleButton value={365}>{t('analytics.days365')}</ToggleButton>
          </ToggleButtonGroup>
        }
      />

      {loading || !data ? <LoadingState /> : (
        <Stack spacing={3} data-testid="analytics-content">
          {/* Money + volume */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.revenue')} value={money(data.revenue)} accent /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.bookings')} value={String(data.bookings)} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.completed')} value={String(data.completed)} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.deposits')} value={String(data.deposits_collected)} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.noShowRate')} value={pct(data.no_show_rate)} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.cancelRate')} value={pct(data.cancellation_rate)} /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Stat label={t('analytics.repeatRate')} value={pct(data.repeat_rate)} /></Grid>
          </Grid>

          <Grid container spacing={2}>
            {/* Revenue by staff */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('analytics.revenueByStaff')}</Typography>
                  {data.revenue_by_staff.length === 0
                    ? <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('analytics.noData')}</Typography>
                    : data.revenue_by_staff.map((s, i) => (
                        <Bar key={i} label={s.name.slice(0, 6)} value={s.revenue} suffix="₾"
                             max={Math.max(...data.revenue_by_staff.map(x => x.revenue), 1)} />
                      ))}
                </CardContent>
              </Card>
            </Grid>

            {/* Busiest weekdays */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('analytics.busiestDays')}</Typography>
                  {data.by_weekday.map((c, i) => (
                    <Bar key={i} label={weekdayLabels[i]} value={c} max={Math.max(...data.by_weekday, 1)} />
                  ))}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Busiest hours */}
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('analytics.busiestHours')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 120 }}>
                {data.by_hour.map((c, h) => {
                  const max = Math.max(...data.by_hour, 1)
                  return (
                    <Box key={h} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: '100%', height: `${Math.round((c / max) * 100)}%`, minHeight: c > 0 ? 3 : 0, bgcolor: 'primary.main', borderRadius: '3px 3px 0 0' }} />
                      {h % 3 === 0 && <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>{h}</Typography>}
                    </Box>
                  )
                })}
              </Box>
            </CardContent>
          </Card>

          <Divider />
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            {t('analytics.footer')}
          </Typography>
        </Stack>
      )}
    </Box>
  )
}
