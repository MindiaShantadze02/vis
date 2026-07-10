import { Box, Typography, Avatar, AvatarGroup } from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { DesignServicesOutlined as DesignServicesOutlinedIcon } from '@/components/icons'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { WorkOutlineOutlined as WorkOutlineOutlinedIcon } from '@/components/icons'
import { OpenInNewOutlined as OpenInNewOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { slugify } from '@/lib/slug'
import { HONEY, INK } from '@/theme/theme'
import { listItem } from '@/theme/motion'
import type { OnboardingData } from './OnboardingLayout'

// Short Georgian weekday labels for the compact hours line (Mon→Sun order,
// matching workingHours keys).
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const SHORT_DAY: Record<string, string> = {
  monday: 'ორ', tuesday: 'სამ', wednesday: 'ოთხ', thursday: 'ხუთ',
  friday: 'პარ', saturday: 'შაბ', sunday: 'კვ',
}

/** A preview section — a dashed-divided block that fades in as it populates. */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component={motion.div}
      variants={listItem}
      initial="hidden"
      animate="visible"
      sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed rgba(30,36,51,0.14)' }}
    >
      {children}
    </Box>
  )
}

const emptyHint = (label: string) => (
  <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>{label}</Typography>
)

/** Compact "which days · what hours" summary, or null when nothing is open. */
function hoursSummary(workingHours: OnboardingData['workingHours']) {
  const openDays = DAY_ORDER.filter(d => workingHours[d]?.open)
  if (openDays.length === 0) return null
  const first = workingHours[openDays[0]]
  return {
    days: openDays.map(d => SHORT_DAY[d]).join(', '),
    window: `${first.openTime}–${first.closeTime}`,
  }
}

/**
 * The signature onboarding element: a live, ticket-style preview of the public
 * booking page the owner is building. Fills in as they complete each step
 * (name/logo → services → hours → link), echoing the booking flow's summary
 * ticket. Always rendered on the dark ink sidebar, so the outer label is light.
 */
export default function OnboardingPreview({ data }: { data: OnboardingData }) {
  const { t } = useTranslation()
  const name = data.name.trim()
  const slug = name ? slugify(name) : ''
  const hrs = hoursSummary(data.workingHours)
  const shownServices = data.services.slice(0, 3)
  const extraServices = data.services.length - shownServices.length

  return (
    <Box sx={{ mt: 1 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block', fontWeight: 700, letterSpacing: '1px',
          textTransform: 'uppercase', color: '#FFFFFF', opacity: 0.5, mb: 1.25,
        }}
      >
        {t('onboarding.previewLabel')}
      </Typography>

      <Box sx={{ bgcolor: '#FFFFFF', color: 'text.primary', borderRadius: 2.5, p: 2, boxShadow: '0 12px 30px rgba(0,0,0,0.28)' }}>
        {/* Header — logo (uploaded image or initial) + business name */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Avatar src={data.logoPreview ?? undefined} sx={{ width: 38, height: 38, bgcolor: name ? 'primary.main' : 'rgba(30,36,51,0.10)', color: name ? '#fff' : 'text.disabled', fontWeight: 700, fontSize: 16 }}>
            {name ? name.charAt(0).toUpperCase() : '?'}
          </Avatar>
          <Typography variant="body2" sx={{ fontWeight: 700, color: name ? 'text.primary' : 'text.disabled' }} noWrap>
            {name || t('onboarding.previewBusinessPlaceholder')}
          </Typography>
        </Box>

        {/* Services */}
        <Section>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: shownServices.length ? 0.75 : 0 }}>
            <DesignServicesOutlinedIcon sx={{ fontSize: 15, color: 'primary.main' }} />
            <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 0.5, color: 'text.secondary', lineHeight: 1 }}>
              {t('onboarding.step2')}
            </Typography>
          </Box>
          {shownServices.length === 0
            ? emptyHint(t('onboarding.previewNoServices'))
            : (
              <AnimatePresence initial={false}>
                {shownServices.map((s, i) => (
                  <Box
                    key={`${s.name}-${i}`}
                    component={motion.div}
                    variants={listItem}
                    initial="hidden"
                    animate="visible"
                    sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.5 }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>{s.name}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: HONEY, flexShrink: 0 }}>
                      {s.price} ₾
                    </Typography>
                  </Box>
                ))}
                {extraServices > 0 && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    +{extraServices}
                  </Typography>
                )}
              </AnimatePresence>
            )}
        </Section>

        {/* Specialists — optional, so the section only appears once one exists */}
        {data.specialists.length > 0 && (
          <Section>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
              <GroupOutlinedIcon sx={{ fontSize: 15, color: 'primary.main' }} />
              <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 0.5, color: 'text.secondary', lineHeight: 1 }}>
                {t('onboarding.stepSpecialists')}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AvatarGroup max={4} sx={{ '& .MuiAvatar-root': { width: 24, height: 24, fontSize: 11 } }}>
                {data.specialists.map((sp, i) => (
                  <Avatar key={i} src={sp.photoPreview ?? undefined} sx={{ bgcolor: 'primary.main' }}>
                    {sp.name.charAt(0).toUpperCase()}
                  </Avatar>
                ))}
              </AvatarGroup>
              <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
                {data.specialists.map(sp => sp.name).slice(0, 2).join(', ')}
                {data.specialists.length > 2 ? ` +${data.specialists.length - 2}` : ''}
              </Typography>
            </Box>
          </Section>
        )}

        {/* Working hours */}
        <Section>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: hrs ? 0.5 : 0 }}>
            <WorkOutlineOutlinedIcon sx={{ fontSize: 15, color: 'primary.main' }} />
            <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 0.5, color: 'text.secondary', lineHeight: 1 }}>
              {t('onboarding.step3')}
            </Typography>
          </Box>
          {hrs
            ? (
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{hrs.days}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hrs.window}</Typography>
              </Box>
            )
            : emptyHint(t('onboarding.previewNoHours'))}
        </Section>

        {/* Public link — the payoff, appears once a name exists */}
        {slug && (
          <Box
            component={motion.div}
            variants={listItem}
            initial="hidden"
            animate="visible"
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              mt: 1.5, pt: 1.25, borderTop: `2px solid ${INK[700]}`,
              color: 'primary.dark',
            }}
          >
            <OpenInNewOutlinedIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption" sx={{ fontWeight: 700 }} noWrap>
              vis.ge/book/{slug}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}
