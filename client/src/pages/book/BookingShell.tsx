import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Box, Typography, Avatar, Divider, useMediaQuery, useTheme,
} from '@mui/material'
import { AnimatePresence, motion } from 'framer-motion'
import { PhoneOutlined as PhoneOutlinedIcon } from '@/components/icons'
import { PlaceOutlined as PlaceOutlinedIcon } from '@/components/icons'
import { MailOutlined as MailOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { stepVariants } from '@/theme/motion'
import { LanguageSwitcher, SkeletonImage } from '@/components/ui'
import VisLogo from '@/components/VisLogo'
import { displayGeorgianPhone } from '@/lib/validation'
import type { BookingTheme } from '@/theme/bookingThemes'
import type { BookingOrg } from './BookingLayout'
import BookingReviews from './BookingReviews'
import EmbedScrollHint from './EmbedScrollHint'

/** Sidebar height change (px) big enough to re-hide the watermark while the
 *  panel re-flows — below this the mark just moves with it. */
const MARK_SETTLE_EPSILON = 32
/** How long the height must hold steady before the mark fades back in. Long
 *  enough to cover a step change settling in stages (the content slides in,
 *  then the slot list resolves), so the fade isn't started and cut short. */
const MARK_SETTLE_MS = 350

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
  /** Bare/chromeless layout for embedding in a third-party site (no sidebar/branding). */
  embed?: boolean
  /** The current step's content. */
  children: ReactNode
}

/**
 * The shared frame for the public booking flow: a branded sidebar (org header +
 * description + live summary), a segmented progress bar, and a motion step
 * container. Every step renders inside this so the flow reads as one screen.
 *
 * Assumes it is already wrapped in the booking `ThemeProvider`
 * (makeBookingTheme) — BookingLayout provides that.
 */
export default function BookingShell({
  org, bookingTheme, step, direction, stepTitles, summary, mobileAside, embed, children,
}: Props) {
  const { t } = useTranslation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  // Each step opens at the top. Without this, picking a time at the bottom of a
  // long slot list leaves the next step scrolled to the same offset (worst in a
  // height-capped embed, where the step content scrolls inside the iframe).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  // The sidebar stretches to the step column, so its height changes both on
  // load (520px → 1030px once the service list and its photos arrive) and on
  // every step change (a list of photo cards is far taller than a slot grid).
  // The watermark is anchored to a percentage of that height, so each change
  // would slide it across the panel — over the org header on load, then flying
  // up or down between steps.
  //
  // So the mark is never shown *while* the panel is re-flowing: any height
  // change over MARK_SETTLE_EPSILON hides it instantly, and it fades back in
  // once the height has held steady. The reposition always happens invisibly.
  // Small changes are ignored so a scrollbar or a one-line reflow can't make it
  // blink.
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const [markVisible, setMarkVisible] = useState(false)

  // Hide it on a step change before the browser paints the new step. This is
  // the render-phase adjustment pattern rather than an effect: an effect lands
  // a frame late, which is long enough to flash the mark at its outgoing spot.
  const [markStep, setMarkStep] = useState(step)
  if (markStep !== step) {
    setMarkStep(step)
    setMarkVisible(false)
  }

  useEffect(() => {
    const el = sidebarRef.current
    if (!el) return
    let lastHeight = -1
    let timer: number | undefined
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.offsetHeight - lastHeight) < MARK_SETTLE_EPSILON) return
      lastHeight = el.offsetHeight
      setMarkVisible(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMarkVisible(true), MARK_SETTLE_MS)
    })
    observer.observe(el)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])

  // Light vs. dark sidebar content (the white "minimal" theme uses a light panel,
  // so its text/overlays must flip to dark to stay legible).
  const darkSidebar = bookingTheme.sidebarText === 'dark'
  const sideFg = darkSidebar ? '#1F2937' : '#FFFFFF'
  const sideOverlay = (a: number) => `rgba(${darkSidebar ? '0,0,0' : '255,255,255'},${a})`
  const flatSidebar = darkSidebar

  // Merchant contact details (phone/address/email — the E-Commerce Law Art. 4
  // disclosure), rendered as labelled rows rather than a run of caption lines.
  const iconSx = { fontSize: 14, opacity: 0.9 }
  const contactRows = [
    org.contact_phone && {
      key: 'phone',
      icon: <PhoneOutlinedIcon sx={iconSx} />,
      label: t('booking.phone'),
      value: displayGeorgianPhone(org.contact_phone),
    },
    org.address && {
      key: 'address', testId: 'booking-address',
      icon: <PlaceOutlinedIcon sx={iconSx} />,
      label: t('booking.address'),
      value: org.address,
    },
    org.contact_email && {
      key: 'email', testId: 'booking-email',
      icon: <MailOutlinedIcon sx={iconSx} />,
      label: t('booking.email'),
      value: org.contact_email,
      href: `mailto:${org.contact_email}`,
    },
  ].filter(Boolean) as {
    key: string; testId?: string; icon: ReactNode; label: string; value: string; href?: string
  }[]

  const sidebar = (
    <Box
      ref={sidebarRef}
      sx={{
        width: { xs: '100%', md: '25%' },
        // Never so narrow that the org header wraps badly on a small laptop,
        // nor so wide that it eats the step column on an ultrawide.
        minWidth: { md: 300 }, maxWidth: { md: 420 },
        background: bookingTheme.sidebar,
        color: sideFg,
        // Tuned (not a spacing step) so the org name lines up with the
        // "Step 1 / 3 · Service" row across the divide: the progress bar's 20px
        // top padding minus half the difference between the two line heights.
        px: 4, pt: '15px', pb: 4,
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
      {/* Oversized Vis wordmark, laid diagonally across the panel — brand
          presence without a second badge competing with the business's own.
          Drawn in the sidebar's foreground colour at a few percent, so it reads
          on every preset *and* on a custom brand hex (light panels flip to a
          dark mark via sideOverlay). It closes the panel — centred 15% of the
          panel height above its foot — cropped by the panel's overflow:hidden. */}
      <Box
        aria-hidden
        data-testid="booking-vis-watermark"
        sx={{
          position: 'absolute', left: '50%', bottom: '15%', zIndex: 0,
          transform: 'translate(-50%,50%) rotate(-45deg)',
          transformOrigin: 'center',
          color: sideOverlay(darkSidebar ? 0.06 : 0.09),
          // Only ever shown at rest (see markVisible): hidden instantly the
          // moment the panel resizes, faded back in once it has settled.
          opacity: markVisible ? 1 : 0,
          transition: markVisible ? 'opacity 0.35s ease' : 'none',
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        <VisLogo height={170} color="currentColor" />
      </Box>

      {/* Content sits above the watermark: an absolutely positioned z-index:0
          layer would otherwise paint over its static siblings. */}
      <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Identity lockup: the business name is the panel's one headline (the
          display serif, matching the step headings across the divide). The
          contact lines used to sit here under the name, which flattened all
          three tiers into one 12px list — they now follow the description as
          labelled rows. */}
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
        <Typography variant="h5" sx={{ fontWeight: 700, fontSize: '1.45rem', lineHeight: 1.3, color: sideFg }}>
          {org.name}
        </Typography>
      </Box>

      {/* The pitch, promoted to the lead paragraph — a step up in size from the
          contact rows below it, so the eye lands here first. */}
      {org.description && (
        <Typography sx={{ fontSize: '0.95rem', lineHeight: 1.7, opacity: 0.92, position: 'relative' }}>
          {org.description}
        </Typography>
      )}

      {contactRows.length > 0 && (
        <Box>
          <Divider sx={{ borderColor: sideOverlay(0.15), mb: 0.5 }} />
          {contactRows.map(row => (
            <Box
              key={row.key}
              data-testid={row.testId}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.9 }}
            >
              <Box
                sx={{
                  width: 28, height: 28, borderRadius: 2, flexShrink: 0,
                  background: sideOverlay(darkSidebar ? 0.06 : 0.12),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {row.icon}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', fontSize: '0.66rem', letterSpacing: '0.6px', textTransform: 'uppercase', opacity: 0.55, lineHeight: 1.3 }}
                >
                  {row.label}
                </Typography>
                {row.href ? (
                  <Typography
                    component="a"
                    href={row.href}
                    sx={{ fontSize: '0.84rem', lineHeight: 1.35, color: 'inherit', textDecoration: 'none', wordBreak: 'break-all', '&:hover': { textDecoration: 'underline' } }}
                  >
                    {row.value}
                  </Typography>
                ) : (
                  <Typography sx={{ fontSize: '0.84rem', lineHeight: 1.35 }}>{row.value}</Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {summary}

      {/* Social proof lives in the branded panel (desktop). Self-hides when the
          business has reviews off or none yet. */}
      <BookingReviews
        variant="sidebar"
        enabled={org.reviews_enabled}
        avg={org.review_avg}
        count={org.review_count}
        fg={sideFg}
        overlay={sideOverlay}
        accent={bookingTheme.deep}
      />
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: embed ? 'auto' : '100vh' }}>
      {/* Optional full-width cover banner across the top of the booking page.
          Owner-uploaded (Booking-page settings); hidden in embed mode, where the
          host site provides its own branding. */}
      {org.cover_url && !embed && (
        <SkeletonImage
          src={org.cover_url}
          alt={org.name}
          data-testid="booking-cover"
          // Full-bleed hero. Tall enough that a wide upload isn't reduced to a
          // thin band — the old 180px strip cropped out most of the photo.
          sx={{ width: '100%', height: { xs: 200, md: 380 }, flexShrink: 0 }}
          imgSx={{ objectPosition: 'center' }}
        />
      )}

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, flex: 1, minWidth: 0 }}>
      {/* Branded sidebar — hidden in embed mode (the host site provides branding). */}
      {!isMobile && !embed && sidebar}

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: embed ? 'background.paper' : bookingTheme.pageBg, minWidth: 0 }}>
        {/* Compact mobile header — replaces the full sidebar below md. */}
        {isMobile && !embed && (
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
          <Box sx={{ width: { xs: '100%', md: '85%' }, maxWidth: 1040, mx: 'auto' }}>
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
              // Capped so the column stays a readable, centred card stack on wide
              // screens — service photos otherwise stretch into thin letterboxes.
              sx={{ px: { xs: 2, md: 5 }, py: 4, width: { xs: '100%', md: '85%' }, maxWidth: 1040, mx: 'auto' }}
            >
              {children}
              {/* When the branded sidebar isn't shown (embed / mobile), fall back
                  to an inline reviews block on the landing step so social proof
                  still appears. */}
              {step === 0 && (isMobile || embed) && (
                <BookingReviews
                  variant="inline"
                  enabled={org.reviews_enabled}
                  avg={org.review_avg}
                  count={org.review_count}
                />
              )}
            </Box>
          </AnimatePresence>
        </Box>

        {/* Footer: the language switcher sits here, out of the flow's way — a
            non-Georgian visitor still has a way out of the default language,
            but it no longer competes with the step header. Hidden in embed
            mode, where language comes from ?lang=.

            Beside it, "Powered by Vis" — the built-in growth loop: every
            booking page (all themes, standalone and embedded) carries one quiet
            link back to the marketing site. Deliberately low-contrast so it
            never competes with the business's own branding. */}
        <Box
          component="footer"
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 1, flexWrap: 'wrap', py: 1.5, px: 2,
          }}
        >
          {!embed && <LanguageSwitcher />}
          <Box data-testid="powered-by-vis">
          <Typography
            component="a"
            href="https://vis.ge/?ref=badge"
            target="_blank"
            rel="noopener"
            variant="caption"
            sx={{
              color: 'text.disabled',
              textDecoration: 'none',
              '&:hover': { color: 'text.secondary', textDecoration: 'underline' },
            }}
          >
            {t('booking.poweredBy')}
          </Typography>
          </Box>
        </Box>
      </Box>

      {/* Hosts cap the iframe height, which clips tall steps — cue the visitor
          that more content (e.g. afternoon slots) is below the fold. */}
      {embed && <EmbedScrollHint />}
      </Box>
    </Box>
  )
}
