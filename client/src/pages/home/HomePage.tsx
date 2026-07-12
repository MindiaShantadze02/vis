import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Box, Button, Chip, Container, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { LanguageSwitcher } from '@/components/ui'
import VisLogo from '@/components/VisLogo'
import { displayFont, radii } from '@/theme/theme'
import { anim } from '@/theme/animations'
import { TIERS } from '@/lib/tiers'
import {
  StorefrontOutlined, GroupOutlined, ScheduleOutlined, StarRounded,
  LanguageOutlined, CodeOutlined, Check,
} from '@/components/icons'

// Landing page shown at "/". Deliberately built from the same primitives as the
// rest of the app — near-white page, flat hairline cards (no shadows, no
// hover-lift), serif display headings, accent used only on the primary CTA — so
// it reads as the front door of the product, not a separate marketing template.

const MAX_W = 1040

// Real, shipped features only — mirrors src/lib copy and docs/APP_OVERVIEW.md.
const FEATURES: { key: string; Icon: typeof StorefrontOutlined }[] = [
  { key: 'booking', Icon: StorefrontOutlined },
  { key: 'staff', Icon: GroupOutlined },
  { key: 'hours', Icon: ScheduleOutlined },
  { key: 'reviews', Icon: StarRounded },
  { key: 'widget', Icon: LanguageOutlined },
  { key: 'api', Icon: CodeOutlined },
]

/** The brand wordmark (shared VisLogo SVG). */
function BrandLockup() {
  return <VisLogo height={26} />
}

/** A flat hairline panel — the app's Card look, used directly for full control. */
function Panel({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid', borderColor: 'divider',
        borderRadius: `${radii.card}px`,
        p: { xs: 3, sm: 3.5 },
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}

export default function HomePage() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <Box
        component="header"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Container maxWidth={false} sx={{ maxWidth: MAX_W, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          <BrandLockup />
          <Box sx={{ flex: 1 }} />
          <LanguageSwitcher />
          <Button component={RouterLink} to="/login" color="inherit" sx={{ color: 'text.secondary' }}>
            {t('auth.login')}
          </Button>
          <Button component={RouterLink} to="/register" variant="contained">
            {t('home.getStarted')}
          </Button>
        </Container>
      </Box>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <Container
        maxWidth={false}
        sx={{
          maxWidth: MAX_W, pt: { xs: 7, sm: 10 }, pb: { xs: 5, sm: 7 },
          animation: anim.fadeInUp,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Box sx={{ maxWidth: 720 }}>
          <Typography
            component="h1"
            sx={{
              fontFamily: displayFont, fontWeight: 700,
              fontSize: { xs: 34, sm: 46 }, lineHeight: 1.15, letterSpacing: '-0.5px',
            }}
          >
            {t('home.heroTitle')}
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', mt: 2, fontSize: { xs: 16, sm: 18 } }}>
            {t('home.heroSubtitle')}
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ mt: 4, flexWrap: 'wrap', gap: 1.5 }}>
            <Button component={RouterLink} to="/register" variant="contained" size="large">
              {t('home.getStarted')}
            </Button>
            <Button component={RouterLink} to="/login" variant="outlined" size="large">
              {t('auth.login')}
            </Button>
          </Stack>
        </Box>
      </Container>

      {/* ── Features ────────────────────────────────────────────── */}
      <Container maxWidth={false} sx={{ maxWidth: MAX_W, pb: { xs: 6, sm: 8 } }}>
        <Typography
          component="h2"
          sx={{ fontFamily: displayFont, fontWeight: 700, fontSize: { xs: 24, sm: 28 }, letterSpacing: '-0.3px', mb: 3 }}
        >
          {t('home.featuresTitle')}
        </Typography>
        <Box
          sx={{
            display: 'grid', gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          }}
        >
          {FEATURES.map(({ key, Icon }) => (
            <Panel key={key}>
              <Icon sx={{ fontSize: 30, color: 'primary.main' }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 1.5 }}>
                {t(`home.features.${key}.title`)}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75 }}>
                {t(`home.features.${key}.desc`)}
              </Typography>
            </Panel>
          ))}
        </Box>
      </Container>

      {/* ── Pricing ─────────────────────────────────────────────── */}
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Container maxWidth={false} sx={{ maxWidth: MAX_W, py: { xs: 6, sm: 8 } }}>
          <Typography
            component="h2"
            sx={{ fontFamily: displayFont, fontWeight: 700, fontSize: { xs: 24, sm: 28 }, letterSpacing: '-0.3px' }}
          >
            {t('home.pricingTitle')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, mb: 3 }}>
            {t('home.pricingNote')}
          </Typography>
          <Box
            sx={{
              display: 'grid', gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              alignItems: 'start',
            }}
          >
            {TIERS.map(tier => (
              <Panel
                key={tier.key}
                sx={{ borderColor: tier.recommended ? 'primary.main' : 'divider', height: '100%' }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {t(`tiers.${tier.key}.label`)}
                  </Typography>
                  {tier.recommended && (
                    <Chip label={t('subscription.recommended')} size="small" color="primary" sx={{ fontWeight: 600 }} />
                  )}
                </Stack>
                <Typography sx={{ fontFamily: displayFont, fontWeight: 700, fontSize: 26 }}>
                  {t(`tiers.${tier.key}.price`)}
                </Typography>
                <Stack spacing={1} sx={{ mt: 2, mb: 3 }}>
                  {(t(`tiers.${tier.key}.features`, { returnObjects: true }) as string[]).map(f => (
                    <Stack key={f} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <Check sx={{ fontSize: 18, color: 'primary.main', mt: '2px' }} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{f}</Typography>
                    </Stack>
                  ))}
                </Stack>
                <Button
                  component={RouterLink}
                  to="/register"
                  fullWidth
                  variant={tier.recommended ? 'contained' : 'outlined'}
                >
                  {t('home.getStarted')}
                </Button>
              </Panel>
            ))}
          </Box>
        </Container>
      </Box>

      {/* ── Developer / API strip ───────────────────────────────── */}
      <Container maxWidth={false} sx={{ maxWidth: MAX_W, py: { xs: 6, sm: 8 } }}>
        <Panel sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2.5}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <CodeOutlined sx={{ fontSize: 34, color: 'primary.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('home.devTitle')}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {t('home.devDesc')}
              </Typography>
            </Box>
            {/* Sign-up mints keys under Settings → API. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button component={RouterLink} to="/docs/api" variant="outlined">
                {t('home.apiDocs')}
              </Button>
              <Button component={RouterLink} to="/docs/widget" variant="outlined">
                {t('home.widgetDocs')}
              </Button>
              <Button component={RouterLink} to="/register" variant="contained">
                {t('home.devCta')}
              </Button>
            </Stack>
          </Stack>
        </Panel>
      </Container>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <Box
        component="footer"
        sx={{ mt: 'auto', borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Container
          maxWidth={false}
          sx={{
            maxWidth: MAX_W, py: 3,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: { xs: 1.5, sm: 3 },
          }}
        >
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            © {year} Vis. {t('home.footerRights')}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button component={RouterLink} to="/docs/api" size="small" color="inherit" sx={{ color: 'text.secondary' }}>
            {t('home.apiDocs')}
          </Button>
          <Button component={RouterLink} to="/docs/widget" size="small" color="inherit" sx={{ color: 'text.secondary' }}>
            {t('home.widgetDocs')}
          </Button>
          <Button component={RouterLink} to="/privacy" size="small" color="inherit" sx={{ color: 'text.secondary' }}>
            {t('common.privacyPolicy')}
          </Button>
          <Button component={RouterLink} to="/terms" size="small" color="inherit" sx={{ color: 'text.secondary' }}>
            {t('common.termsOfService')}
          </Button>
        </Container>
      </Box>
    </Box>
  )
}
