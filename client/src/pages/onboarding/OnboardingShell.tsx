import type { ReactNode } from 'react'
import {
  Box, Typography, Button, useMediaQuery, useTheme,
} from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { DesignServicesOutlined as DesignServicesOutlinedIcon } from '@/components/icons'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { WorkOutlineOutlined as WorkOutlineOutlinedIcon } from '@/components/icons'
import { Check as CheckIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { stepVariants } from '@/theme/motion'
import { INK, displayFont } from '@/theme/theme'
import type { OnboardingData } from './OnboardingLayout'
import OnboardingPreview from './OnboardingPreview'

interface Props {
  /** Current step index (0-based). */
  step: number
  /** Travel direction for the slide animation: +1 forward, -1 back. */
  direction: number
  /** Live onboarding data — drives the sidebar preview. */
  data: OnboardingData
  onSkip: () => void
  /** Non-animated content shown above the step (e.g. pending invites). */
  banner?: ReactNode
  children: ReactNode
}

const STEP_META = [
  { labelKey: 'onboarding.step1',           Icon: StorefrontOutlinedIcon },
  { labelKey: 'onboarding.step2',           Icon: DesignServicesOutlinedIcon },
  { labelKey: 'onboarding.stepSpecialists', Icon: GroupOutlinedIcon },
  { labelKey: 'onboarding.step3',           Icon: WorkOutlineOutlinedIcon },
]

// Content column — scales with the viewport instead of a fixed cap (was 620,
// which left most of a large screen empty), while never exceeding a width
// where form fields stop reading as a column.
const STEP_MAX_WIDTH = { xs: '100%', md: 720, lg: 900, xl: 1120 }

/**
 * The branded frame for the business onboarding: a dark ink sidebar (welcome +
 * vertical step rail + a live preview of the booking page being built) and a warm
 * content panel with directional step motion. Mirrors the public BookingShell so
 * onboarding shares the app's signature look. Uses the base brand theme — there's
 * no org/booking-theme yet.
 */
export default function OnboardingShell({ step, direction, data, onSkip, banner, children }: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  const logo = (size: number, radius: number) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
      <Box
        sx={{
          width: size, height: size, borderRadius: `${radius}px`, bgcolor: 'primary.main',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: size * 0.5, lineHeight: 1 }}>V</Typography>
      </Box>
      <Typography variant="h6" sx={{ color: '#fff', fontWeight: 800, letterSpacing: '-0.3px' }}>Vis</Typography>
    </Box>
  )

  const rail = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {STEP_META.map((s, i) => {
        const done = i < step
        const current = i === step
        return (
          <Box
            key={i}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              px: 1.25, py: 1, borderRadius: 2,
              bgcolor: current ? 'rgba(255,255,255,0.08)' : 'transparent',
              transition: 'background-color 0.2s',
            }}
          >
            <Box
              sx={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: done ? 'primary.main' : current ? 'rgba(255,255,255,0.12)' : 'transparent',
                border: done || current ? 'none' : '1.5px solid rgba(255,255,255,0.25)',
                color: '#fff', transition: 'all 0.2s',
              }}
            >
              {done
                ? <CheckIcon sx={{ fontSize: 16 }} />
                : <s.Icon sx={{ fontSize: 15, opacity: current ? 1 : 0.6 }} />}
            </Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: current ? 700 : 500, color: '#fff', opacity: current ? 1 : done ? 0.8 : 0.55 }}
            >
              {t(s.labelKey)}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )

  const sidebar = (
    <Box
      sx={{
        width: 320, flexShrink: 0, bgcolor: INK[800], color: '#fff',
        p: 4, display: 'flex', flexDirection: 'column', gap: 3,
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {logo(30, 9)}
      <Box>
        <Typography sx={{ fontFamily: displayFont, fontWeight: 700, fontSize: 26, lineHeight: 1.2, letterSpacing: '-0.3px' }}>
          {t('onboarding.welcomeTitle')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7, mt: 1, lineHeight: 1.6 }}>
          {t('onboarding.welcomeSubtitle')}
        </Typography>
      </Box>
      {rail}
      <Box sx={{ mt: 'auto' }}>
        <OnboardingPreview data={data} />
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh', bgcolor: 'background.default' }}>
      {!isMobile && sidebar}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Mobile ink header — replaces the sidebar below md. */}
        {isMobile && (
          <Box sx={{ bgcolor: INK[800], color: '#fff', px: 2, py: 1.5, display: 'flex', alignItems: 'center' }}>
            {logo(28, 8)}
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 700, letterSpacing: '0.5px' }}>
              {t('booking.stepCounter', { n: step + 1 })}
            </Typography>
          </Box>
        )}

        {/* Skip + mobile segmented progress */}
        <Box sx={{ px: { xs: 2, md: 5 }, pt: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={onSkip} size="small" sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {t('onboarding.skip')}
            </Button>
          </Box>
          {isMobile && (
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {STEP_META.map((_, i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1, height: 5, borderRadius: 3, transition: 'background-color 0.3s',
                    bgcolor: i <= step ? 'primary.main' : 'rgba(30,36,51,0.12)',
                  }}
                />
              ))}
            </Box>
          )}
        </Box>

        {banner && (
          <Box sx={{ px: { xs: 2, md: 5 }, pt: 2, maxWidth: STEP_MAX_WIDTH, mx: 'auto', width: '100%' }}>
            {banner}
          </Box>
        )}

        {/* Step content — slides in the travelled direction on step change. */}
        <Box sx={{ flex: 1, position: 'relative', overflowX: 'hidden' }}>
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <Box
              component={motion.div}
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 4 }, maxWidth: STEP_MAX_WIDTH, mx: 'auto', width: '100%' }}
            >
              {children}
            </Box>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
  )
}
