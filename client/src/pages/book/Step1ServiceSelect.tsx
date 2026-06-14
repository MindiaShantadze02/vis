import { useEffect, useState } from 'react'
import { Box, Typography, Card, CardActionArea, CardContent, CircularProgress, Chip } from '@mui/material'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import { supabase } from '@/lib/supabase'
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
      .select('id, name, duration_minutes, price')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setServices((data ?? []) as BookingService[])
        setLoading(false)
      })
  }, [orgId])

  if (loading) return <Box sx={{ py: 6, textAlign: 'center' }}><CircularProgress /></Box>

  if (services.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          სერვისები ჯერ არ არის დამატებული
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>სერვისის არჩევა</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        აირჩიეთ სასურველი მომსახურება
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {services.map(s => (
          <Card
            key={s.id}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              '&:hover': { borderColor: 'primary.main', boxShadow: 2 },
              transition: 'all 0.15s',
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
                  sx={{ fontWeight: 700, fontSize: 15, bgcolor: 'primary.main', color: 'white' }}
                />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Box>
  )
}
