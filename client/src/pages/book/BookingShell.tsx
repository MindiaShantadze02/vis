import type { ReactNode } from 'react'
import {
  Box, Typography, Avatar, Divider, useMediaQuery, useTheme,
} from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { stepVariants } from '@/theme/motion'
import type { BookingTheme } from '@/theme/bookingThemes'
import type { BookingOrg } from './BookingLayout'

interface Props {
  org: BookingOrg
  bookingTheme: BookingTheme
  /** Current step index (0-based). */
  step: number
  /** Travel direction for the slide animation: +1 forward, -1 back. */
  direction: number
  /** Title per step, shown in the progress bar. Its length = number of segments. */
  stepTitles: string[]
  /** Live "your booking" summary rendered in the sidebar (e.g. BookingSummaryCard). */
  summary?: ReactNode
  /** Compact aside shown in the mobile header (e.g. running price). */
  mobileAside?: ReactNode
  /** The current step's content. */
  children: ReactNode
}

/**
 * The shared frame for every public booking flow: a branded sidebar (org header +
 * description + live summary), a segmented progress bar, and a motion step
 * container. Appointments, restaurants and hotels all render their steps inside
 * this so the three verticals look identical apart from their domain-specific
 * step content.
 *
 * Assumes it is already wrapped in the booking `ThemeProvider`
 * (makeBookingTheme) — BookingLayout provides that for every vertical.
 */
export default function BookingShell({
  org, bookingTheme, step, direction, stepTitles, summary, mobileAside, children,
}: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  // Light vs. dark sidebar content (the white "minimal" theme uses a light panel,
  // so its text/overlays must flip to dark to stay legible).
  const darkSidebar = bookingTheme.sidebarText === 'dark'
  const sideFg = darkSidebar ? '#1F2937' : '#FFFFFF'
  const sideOverlay = (a: number) => `rgba(${darkSidebar ? '0,0,0' : '255,255,255'},${a})`
  const flatSidebar = darkSidebar

  const sidebar = (
    <Box
      sx={{
        width: { xs: '100%', md: 300 },
        background: bookingTheme.sidebar,
        color: sideFg,
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        ...(flatSidebar && {
          borderRight: { md: '1px solid #E5E7EB' },
          borderBottom: { xs: '1px solid #E5E7EB', md: 'none' },
        }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
        <Avatar
          src={org.logo_url ?? undefined}
          sx={{
            width: 56, height: 56,
            background: sideOverlay(darkSidebar ? 0.06 : 0.15),
            color: sideFg,
            fontSize: 22, fontWeight: 700,
            border: flatSidebar ? '1px solid #E5E7EB' : `2px solid ${sideOverlay(0.30)}`,
            boxShadow: flatSidebar ? '0 1px 3px rgba(0,0,0,0.06)' : '0 4px 16px rgba(0,0,0,0.20)',
          }}
        >
          {org.name.charAt(0)}
        </Avatar>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: sideFg }}>{org.name}</Typography>
          {org.contact_phone && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <PhoneOutlinedIcon sx={{ fontSize: 14, opacity: 0.8 }} />
              <Typography variant="caption" sx={{ opacity: 0.8 }}>{org.contact_phone}</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {org.description && (
        <>
          <Divider sx={{ borderColor: sideOverlay(0.15) }} />
          <Typography variant="body2" sx={{ opacity: 0.85, lineHeight: 1.65, position: 'relative' }}>
            {org.description}
          </Typography>
        </>
      )}

      {summary}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh' }}>
      {!isMobile && sidebar}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: bookingTheme.pageBg, minWidth: 0 }}>
        {/* Compact mobile header — replaces the full sidebar below md. */}
        {isMobile && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, background: bookingTheme.sidebar, color: sideFg }}>
            <Avatar
              src={org.logo_url ?? undefined}
              sx={{ width: 38, height: 38, background: sideOverlay(darkSidebar ? 0.06 : 0.16), color: sideFg, fontSize: 16, fontWeight: 700 }}
            >
              {org.name.charAt(0)}
            </Avatar>
            <Typography variant="subtitle2" noWrap sx={{ flex: 1, fontWeight: 700 }}>{org.name}</Typography>
            {mobileAside}
          </Box>
        )}

        {/* Progress bar — segmented, one segment per step. */}
        <Box sx={{ bgcolor: 'background.paper', px: { xs: 2, md: 5 }, py: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ width: { xs: '100%', md: '85%' }, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.5px', color: 'text.secondary' }}>
                {t('booking.stepCounter', { n: step + 1 })}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {stepTitles[step]}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              {stepTitles.map((_, i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1, height: 5, borderRadius: 3,
                    transition: 'background-color 0.3s',
                    bgcolor: i <= step ? 'primary.main' : 'rgba(30,36,51,0.12)',
                  }}
                />
              ))}
            </Box>
          </Box>
        </Box>

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
              sx={{ px: { xs: 2, md: 5 }, py: 4, width: { xs: '100%', md: '85%' }, mx: 'auto' }}
            >
              {children}
            </Box>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
  )
}
