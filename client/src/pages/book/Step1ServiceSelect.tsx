import { useEffect, useState } from 'react'
import { Box, Typography, Card, CardActionArea, CardContent, Chip } from '@mui/material'
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import DesignServicesOutlinedIcon from '@mui/icons-material/DesignServicesOutlined'
import { supabase } from '@/lib/supabase'
import { useTheme, alpha } from '@mui/material/styles'
import { motion } from 'framer-motion'
import { staggerContainer, listItem, baseTransition } from '@/theme/motion'
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

  const theme = useTheme()
  const cardHover = `0 8px 24px ${alpha(theme.palette.primary.main, 0.1)}, 0 2px 8px rgba(0,0,0,0.04)`

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

      <Box
        component={motion.div}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {services.map((s) => (
          <Card
            key={s.id}
            component={motion.div}
            variants={listItem}
            whileHover={{ y: -2, boxShadow: cardHover }}
            whileTap={{ scale: 0.98 }}
            transition={baseTransition}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              // Hover lift/shadow are Framer-controlled (above); keep only the
              // border accent as CSS so it doesn't fight the inline transform.
              '&:hover': { borderColor: 'primary.main' },
            }}
          >
            <CardActionArea onClick={() => onSelect(s)} data-testid="book-service">
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
