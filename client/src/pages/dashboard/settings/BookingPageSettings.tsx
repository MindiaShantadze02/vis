import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, Divider, CircularProgress,
  Stack, Switch, FormControlLabel, Link as MuiLink,
} from '@mui/material'
import { OpenInNewOutlined as OpenInNewOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, CopyableText, FormErrorAlert, useToast } from '@/components/ui'
import { surface } from '@/theme/theme'
import {
  BOOKING_THEME_LIST, DEFAULT_BOOKING_THEME, getBookingTheme, isCustomBookingColor,
} from '@/theme/bookingThemes'

/**
 * Everything about the public booking page a customer sees: the shareable link +
 * website embed, the colour theme, and the reviews toggle. Grouped here (rather
 * than mixed into the business profile) so all customer-facing settings have one
 * obvious home.
 */
export default function BookingPageSettings() {
  const { t } = useTranslation()
  const { org, refresh } = useOrg()
  const toast = useToast()

  // Preset key (e.g. 'citrus') or a custom brand colour as a #RRGGBB hex.
  const [bookingTheme, setBookingTheme] = useState<string>(DEFAULT_BOOKING_THEME)
  // Whole-feature on/off for customer reviews (badge on the booking page).
  const [reviewsEnabled, setReviewsEnabled] = useState(true)
  // When on (default), new bookings arrive as 'pending' and need manual
  // approval; off means bookings auto-approve on creation.
  const [requireApproval, setRequireApproval] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (org) {
      setBookingTheme(getBookingTheme(org.booking_theme).key)
      setReviewsEnabled(org.reviews_enabled)
      setRequireApproval(org.require_approval)
    }
  }, [org])

  async function handleSave() {
    if (!org) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('organisations')
      .update({ booking_theme: bookingTheme, reviews_enabled: reviewsEnabled, require_approval: requireApproval })
      .eq('id', org.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    await refresh()
    toast.success(t('common.saved'))
  }

  return (
    <Box>
      <PageHeader title={t('settings.bookingPage')} />

      <FormErrorAlert message={error} data-testid="booking-error" />

      {/* Share / preview / embed */}
      {org?.slug && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('settings.shareBookingPage')}</Typography>
              <MuiLink
                href={`/book/${org.slug}`}
                target="_blank"
                rel="noopener"
                underline="hover"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 14, fontWeight: 600 }}
              >
                {t('settings.viewBookingPage')}
                <OpenInNewOutlinedIcon sx={{ fontSize: 16 }} />
              </MuiLink>
            </Box>
            <Stack spacing={1.5}>
              <CopyableText
                label={t('settings.yourBookingLink')}
                text={`vis.ge/book/${org.slug}`}
                value={`https://vis.ge/book/${org.slug}`}
                href={`https://vis.ge/book/${org.slug}`}
              />
              <CopyableText
                label={t('dashboard.embedCode')}
                text={`<iframe data-vis src="…/book/${org.slug}?embed=1"> … + embed.js`}
                value={
                  `<iframe data-vis src="https://vis.ge/book/${org.slug}?embed=1&lang=ka" style="width:100%;border:0"></iframe>\n` +
                  `<script src="https://vis.ge/embed.js" async></script>`
                }
              />
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Appearance + reviews */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          {/* Booking page colour theme — what customers see when booking. */}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('settings.bookingPageColor')}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('settings.bookingPageColorHelp')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
            {BOOKING_THEME_LIST.map(th => {
              const selected = th.key === bookingTheme
              return (
                <Box
                  key={th.key}
                  onClick={() => setBookingTheme(th.key)}
                  role="button"
                  aria-pressed={selected}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    px: 1.5, py: 1, borderRadius: 2, cursor: 'pointer',
                    border: '2px solid',
                    borderColor: selected ? 'primary.main' : 'divider',
                    bgcolor: selected ? surface.hover : 'transparent',
                    transition: 'border-color 0.15s ease, background-color 0.15s ease',
                    '&:hover': { borderColor: selected ? 'primary.main' : 'text.disabled' },
                  }}
                >
                  <Box
                    sx={{
                      width: 22, height: 22, borderRadius: '50%',
                      // Match what customers actually see: the theme's primary
                      // accent. Two-tone themes (deep ≠ primary, e.g. brass) show
                      // the primary dominant with the deep accent as a wedge.
                      background: th.deep !== th.primary
                        ? `linear-gradient(135deg, ${th.primary} 0 58%, ${th.deep} 58% 100%)`
                        : th.primary,
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: selected ? 600 : 500 }}>
                    {th.label}
                  </Typography>
                </Box>
              )
            })}

            {/* Custom brand colour — the whole tile is a <label> for a native
                colour input, so clicking it opens the OS colour picker. */}
            {(() => {
              const customActive = isCustomBookingColor(bookingTheme)
              return (
                <Box
                  component="label"
                  role="button"
                  aria-pressed={customActive}
                  sx={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center', gap: 1,
                    px: 1.5, py: 1, borderRadius: 2, cursor: 'pointer',
                    border: '2px solid',
                    borderColor: customActive ? 'primary.main' : 'divider',
                    bgcolor: customActive ? surface.hover : 'transparent',
                    transition: 'border-color 0.15s ease, background-color 0.15s ease',
                    '&:hover': { borderColor: customActive ? 'primary.main' : 'text.disabled' },
                  }}
                >
                  <Box
                    sx={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: customActive
                        ? bookingTheme
                        : 'conic-gradient(from 0deg, #FF6B35, #F6B042, #0E9F6E, #5B4BE0, #C4572F, #FF6B35)',
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: customActive ? 600 : 500 }}>
                    {customActive ? bookingTheme.toUpperCase() : t('settings.customColor')}
                  </Typography>
                  <input
                    type="color"
                    value={customActive ? bookingTheme : '#B76E79'}
                    onChange={e => setBookingTheme(e.target.value)}
                    style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                    data-testid="booking-custom-color"
                  />
                </Box>
              )
            })()}
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Customer reviews — whole-feature on/off. When off, the public booking
              page shows no rating, and new reviews can't be submitted. */}
          <FormControlLabel
            sx={{ ml: 0 }}
            control={
              <Switch
                checked={reviewsEnabled}
                onChange={e => setReviewsEnabled(e.target.checked)}
                data-testid="reviews-enabled-toggle"
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('reviews.settingTitle')}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('reviews.settingHelp')}
                </Typography>
              </Box>
            }
          />

          <Divider sx={{ my: 3 }} />

          {/* Manual approval — when off (default), guest bookings auto-approve
              on creation; when on, they arrive 'pending' until approved. */}
          <FormControlLabel
            sx={{ ml: 0 }}
            control={
              <Switch
                checked={requireApproval}
                onChange={e => setRequireApproval(e.target.checked)}
                data-testid="require-approval-toggle"
              />
            }
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('settings.requireApprovalTitle')}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('settings.requireApprovalHelp')}
                </Typography>
              </Box>
            }
          />

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
              data-testid="booking-save"
            >
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
