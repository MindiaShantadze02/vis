import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Card, Typography, TextField, Chip, Skeleton, useTheme, useMediaQuery,
} from '@mui/material'
import { Search as SearchIcon } from '@/components/icons'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { PageHeader, EmptyState } from '@/components/ui'
import { tierInfo, tierColor } from '@/lib/tiers'

interface OrgRow {
  id: string
  name: string
  slug: string
  subscription_tier: string
  created_at: string
  owner_email: string | null
  member_count: number
  usage: number
}

const GRID_COLS = '1.6fr 1fr 110px 90px 110px'

export default function OrgsListPage() {
  const theme = useTheme()
  const navigate = useNavigate()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.rpc('list_orgs_overview').then(({ data }) => {
      setOrgs((data ?? []) as OrgRow[])
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orgs
    return orgs.filter(o =>
      o.name.toLowerCase().includes(q)
      || o.slug.toLowerCase().includes(q)
      || (o.owner_email ?? '').toLowerCase().includes(q)
    )
  }, [orgs, search])

  return (
    <Box>
      <PageHeader title="ორგანიზაციები" />

      <Box sx={{ mb: 2, maxWidth: 360 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="ძებნა (სახელი, slug, მფლობელი)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> } }}
        />
      </Box>

      <Card>
        {/* Desktop header */}
        {!isMobile && (
          <Box
            sx={{
              display: 'grid', gridTemplateColumns: GRID_COLS,
              px: 2, py: 1.5, bgcolor: 'grey.50',
              borderBottom: '1px solid', borderColor: 'divider',
            }}
          >
            {['ორგანიზაცია', 'მფლობელი', 'გეგმა', 'წევრები', 'გამოყენება'].map(h => (
              <Typography key={h} variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{h}</Typography>
            ))}
          </Box>
        )}

        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
            <Box key={i} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton height={24} />
            </Box>
          ))
          : filtered.length === 0
          ? <EmptyState icon={<StorefrontOutlinedIcon />} title="ორგანიზაცია ვერ მოიძებნა" />
          : filtered.map((o, i) => {
            const info = tierInfo(o.subscription_tier)
            const rowSx = {
              px: 2, py: 1.5,
              borderBottom: i < filtered.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider', cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
            }
            const tierChip = (
              <Chip label={info.label} size="small" sx={{ bgcolor: tierColor(theme, info.colorKey), color: 'white', fontWeight: 600, justifySelf: 'start' }} />
            )

            if (isMobile) {
              return (
                <Box key={o.id} onClick={() => navigate(`/superadmin/orgs/${o.id}`)} sx={rowSx}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{o.name}</Typography>
                      <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
                        {o.owner_email ?? '—'} · {o.member_count} წევრი · {o.usage} ჯავშანი
                      </Typography>
                    </Box>
                    {tierChip}
                  </Box>
                </Box>
              )
            }

            return (
              <Box
                key={o.id}
                onClick={() => navigate(`/superadmin/orgs/${o.id}`)}
                sx={{ ...rowSx, display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center' }}
              >
                <Box sx={{ minWidth: 0, pr: 1 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{o.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    /{o.slug} · {format(new Date(o.created_at), 'dd MMM yyyy')}
                  </Typography>
                </Box>
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary', pr: 1 }}>{o.owner_email ?? '—'}</Typography>
                {tierChip}
                <Typography variant="body2">{o.member_count}</Typography>
                <Typography variant="body2">{o.usage}</Typography>
              </Box>
            )
          })
        }
      </Card>
    </Box>
  )
}
