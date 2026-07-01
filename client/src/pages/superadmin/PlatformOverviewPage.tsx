import { useEffect, useState } from 'react'
import { Box, Grid, Card, CardContent, Typography, Chip, useTheme } from '@mui/material'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { EventNoteOutlined as EventNoteOutlinedIcon } from '@/components/icons'
import { PersonAddAltOutlined as PersonAddAltOutlinedIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { PageHeader, StatCard } from '@/components/ui'
import { TIERS, tierColor } from '@/lib/tiers'

interface Stats {
  total_orgs: number
  total_appointments: number
  signups_last_30d: number
  orgs_by_tier: Record<string, number>
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
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard
            label="ორგანიზაციები"
            value={stats?.total_orgs ?? 0}
            icon={<StorefrontOutlinedIcon />}
            color={theme.palette.primary.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard
            label="ჯავშნები (სულ)"
            value={stats?.total_appointments ?? 0}
            icon={<EventNoteOutlinedIcon />}
            color={theme.palette.info.main}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <StatCard
            label="ახალი რეგისტრაცია (30 დღე)"
            value={stats?.signups_last_30d ?? 0}
            icon={<PersonAddAltOutlinedIcon />}
            color={theme.palette.success.main}
            loading={loading}
          />
        </Grid>
      </Grid>

      {/* Orgs by tier */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
            ორგანიზაციები გეგმის მიხედვით
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {TIERS.map(tier => (
              <Box
                key={tier.key}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  px: 2, py: 1.5, borderRadius: 2,
                  border: '1px solid', borderColor: 'divider', minWidth: 140,
                }}
              >
                <Chip
                  label={tier.label}
                  size="small"
                  sx={{ bgcolor: tierColor(theme, tier.colorKey), color: 'white', fontWeight: 700 }}
                />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {stats?.orgs_by_tier?.[tier.key] ?? 0}
                </Typography>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
