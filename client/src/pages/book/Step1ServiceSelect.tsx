import { useEffect, useState } from 'react'
import { Box, Typography, Card, CardActionArea, CardContent } from '@mui/material'
import { AccessTimeOutlined as AccessTimeOutlinedIcon } from '@/components/icons'
import { ChevronRight as ChevronRightIcon } from '@/components/icons'
import { DesignServicesOutlined as DesignServicesOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
        title={t('booking.noServices')}
      />
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('booking.serviceHeading')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {t('booking.serviceSubtext')}
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
              position: 'relative',
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'divider',
              // A citrus rail down the left edge — the ticket-stub edge, carried
              // onto the service cards so they read as branded, not generic rows.
              '&::before': {
                content: '""', position: 'absolute', left: 0, top: 0, bottom: 0,
                width: 4, bgcolor: 'primary.main',
                transition: 'width 0.18s ease',
              },
              '&:hover': { borderColor: 'primary.main' },
              '&:hover::before': { width: 6 },
            }}
          >
            <CardActionArea onClick={() => onSelect(s)} data-testid="book-service">
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2.25, pl: 2.75 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{s.name}</Typography>
                  <Box
                    sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.75,
                      px: 1, py: 0.25, borderRadius: 1.5,
                      bgcolor: 'secondary.main', color: 'secondary.contrastText',
                    }}
                  >
                    <AccessTimeOutlinedIcon sx={{ fontSize: 14 }} />
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {s.duration_minutes} {t('common.minutesShort')}
                    </Typography>
                  </Box>
                </Box>
                <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: 'text.primary', whiteSpace: 'nowrap' }}>
                  {s.price} ₾
                </Typography>
                <ChevronRightIcon sx={{ color: 'text.disabled', flexShrink: 0 }} />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Box>
  )
}
