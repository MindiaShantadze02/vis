import { useEffect, useState } from 'react'
import { Box, Grid, Card, CardContent, Typography, Chip, useTheme } from '@mui/material'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { EventNoteOutlined as EventNoteOutlinedIcon } from '@/components/icons'
import { PersonAddAltOutlined as PersonAddAltOutlinedIcon } from '@/components/icons'
import { VisibilityOutlined as VisibilityOutlinedIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { PageHeader, StatCard } from '@/components/ui'

const BILLING_STATUSES: { key: string; label: string; color: 'success' | 'warning' | 'error' }[] = [
  { key: 'active', label: 'აქტიური', color: 'success' },
  { key: 'past_due', label: 'ვადაგადაცილებული', color: 'warning' },
  { key: 'suspended', label: 'შეჩერებული', color: 'error' },
]

interface Stats {
  total_orgs: number
  total_appointments: number
  signups_last_30d: number
  /** Booking-page views across every business: all time, and the last 30 days. */
  booking_views_total: number
  booking_views_30d: number
  orgs_by_billing_status: Record<string, number>
}

export default function PlatformOverviewPage() {
  const theme = useTheme()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.rpc('platform_stats').then(({ data }) => {
      setStats((data ?? null) as Stats | null)
      setLoading(false)
    })
  }, [])

  return (
    <Box>
      <PageHeader title="პლატფორმის მიმოხილვა" />

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="ორგანიზაციები"
            value={stats?.total_orgs ?? 0}
            icon={<StorefrontOutlinedIcon />}
            color={theme.palette.primary.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="ჯავშნები (სულ)"
            value={stats?.total_appointments ?? 0}
            icon={<EventNoteOutlinedIcon />}
            color={theme.palette.info.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            label="ახალი რეგისტრაცია (30 დღე)"
            value={stats?.signups_last_30d ?? 0}
            icon={<PersonAddAltOutlinedIcon />}
            color={theme.palette.success.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {/* One visitor per business per day. Counts people who reached a
              booking form, so it reads next to "ჯავშნები" as a rough funnel. */}
          <StatCard
            label="ჯავშნის გვერდის ნახვები"
            value={stats?.booking_views_total ?? 0}
            icon={<VisibilityOutlinedIcon />}
            color={theme.palette.warning.main}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 3 }}>
        ბოლო 30 დღეში — {stats?.booking_views_30d ?? 0} ნახვა. ერთი ვიზიტორი დღეში ერთხელ ითვლება.
      </Typography>

      {/* Orgs by billing status */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            ორგანიზაციები სტატუსის მიხედვით
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {BILLING_STATUSES.map(s => (
              <Box
                key={s.key}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  px: 2, py: 1.5, borderRadius: 2,
                  border: '1px solid', borderColor: 'divider', minWidth: 140,
                }}
              >
                <Chip label={s.label} size="small" color={s.color} sx={{ fontWeight: 700 }} />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {stats?.orgs_by_billing_status?.[s.key] ?? 0}
                </Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
