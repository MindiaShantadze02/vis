import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { displayGeorgianPhone, toE164Georgian } from '@/lib/validation'

interface Props {
  phone: string | null | undefined
}

/** Shared "call the business to cancel or change" callout shown on the booking
 *  done screens. Guests have no self-service cancel, so every vertical points
 *  them at the org's phone — formatted and tappable, not a bare number. */
export default function BookingContactNote({ phone }: Props) {
  const { t } = useTranslation()
  if (!phone) return null
  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        p: 1.5, mt: 3, borderRadius: 2, textAlign: 'left',
        bgcolor: (t) => alpha(t.palette.primary.main, 0.14),
        border: (t) => `1px solid ${alpha(t.palette.primary.main, 0.3)}`,
        color: 'primary.dark',
      }}
    >
      <PhoneOutlinedIcon fontSize="small" sx={{ color: 'primary.dark' }} />
      <Box>
        <Typography variant="caption" sx={{ display: 'block', color: 'primary.dark', opacity: 0.9 }}>
          {t('booking.contactToCancel')}
        </Typography>
        <Typography
          variant="body2"
          component="a"
          href={`tel:${toE164Georgian(phone)}`}
          sx={{ fontWeight: 700, color: 'primary.dark', textDecoration: 'none' }}
        >
          {displayGeorgianPhone(phone)}
        </Typography>
      </Box>
    </Box>
  )
}
