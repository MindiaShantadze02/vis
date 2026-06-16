import { useEffect, useState } from 'react'
import { Box, Typography, Card, CardActionArea, CardContent, Chip } from '@mui/material'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import DesignServicesOutlinedIcon from '@mui/icons-material/DesignServicesOutlined'
import { supabase } from '@/lib/supabase'
import { anim } from '@/theme/animations'
import { elevation } from '@/theme/theme'
import { LoadingState, EmptyState } from '@/components/ui'
import type { BookingService } from './BookingLayout'

interface Props {
  orgId: string
  onSelect: (service: BookingService) => void
}

export default function Step1ServiceSelect({ orgId, onSelect }: Props) {
  const [services, setServices] = useState<BookingService[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, name, duration_minutes, price, max_per_slot')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setServices((data ?? []) as BookingService[])
        setLoading(false)
      })
  }, [orgId])

  if (loading) return <LoadingState />

  if (services.length === 0) {
    return (
      <EmptyState
        icon={<DesignServicesOutlinedIcon />}
        title="სერვისები ჯერ არ არის დამატებული"
      />
    )
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>სერვისის არჩევა</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        აირჩიეთ სასურველი მომსახურება
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {services.map((s, i) => (
          <Card
            key={s.id}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              transition: 'all 0.18s cubic-bezier(0.16,1,0.3,1)',
              animation: anim.scaleIn,
              animationDelay: `${i * 60}ms`,
              '&:hover': {
                borderColor: 'primary.main',
                transform: 'translateY(-2px)',
                boxShadow: elevation.cardHover,
              },
            }}
          >
            <CardActionArea onClick={() => onSelect(s)}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                    <AccessTimeOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {s.duration_minutes} წუთი
                    </Typography>
                  </Box>
                </Box>
                <Chip
                  label={`${s.price} ₾`}
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    bgcolor: 'secondary.main',
                    color: 'primary.dark',
                    border: '1px solid',
                    borderColor: 'primary.light',
                  }}
                />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Box>
  )
}
