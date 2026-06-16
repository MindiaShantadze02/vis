import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, LinearProgress,
  Stack, Chip, Divider, CircularProgress, useTheme,
} from '@mui/material'
import type { Theme } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'

type Tier = 'free' | 'starter' | 'pro' | 'business'
type TierColorKey = 'grey' | 'info' | 'primary' | 'success'

interface TierInfo {
  key: Tier
  label: string
  price: string
  limit: number | null
  features: string[]
  colorKey: TierColorKey
}

const TIERS: TierInfo[] = [
  {
    key: 'free', label: 'უფასო', price: '₾0 / თვე', limit: 30, colorKey: 'grey',
    features: ['30 ჯავშანი/თვე', 'ონლაინ ბუქინგ გვერდი', 'SMS შეტყობინებები'],
  },
  {
    key: 'starter', label: 'სტარტერი', price: '₾15 / თვე', limit: 200, colorKey: 'info',
    features: ['200 ჯავშანი/თვე', 'ყველა უფასო ფუნქცია', 'პრიორიტეტული მხარდაჭერა'],
  },
  {
    key: 'pro', label: 'პრო', price: '₾40 / თვე', limit: 600, colorKey: 'primary',
    features: ['600 ჯავშანი/თვე', 'ყველა სტარტერის ფუნქცია', 'BOG / TBC ონლაინ გადახდა', 'გუნდის მართვა'],
  },
  {
    key: 'business', label: 'ბიზნესი', price: '₾80 / თვე', limit: null, colorKey: 'success',
    features: ['ულიმიტო ჯავშნები', 'ყველა პრო ფუნქცია', 'VIP მხარდაჭერა'],
  },
]

/** Resolve a tier's accent color from the theme palette. */
function tierColor(theme: Theme, key: TierColorKey): string {
  return key === 'grey' ? theme.palette.text.secondary : theme.palette[key].main
}

export default function SubscriptionPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const theme = useTheme()

  const [used, setUsed] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const currentTier = (org as unknown as Record<string, string>)?.subscription_tier as Tier ?? 'free'
  const expires = (org as unknown as Record<string, string>)?.subscription_expires_at
  const tierInfo = TIERS.find(t => t.key === currentTier) ?? TIERS[0]

  useEffect(() => {
    if (org) loadUsage()
  }, [org])

  async function loadUsage() {
    if (!org) return
    setLoading(true)
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .not('status', 'in', '(rejected,cancelled)')
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
    setUsed(count ?? 0)
    setLoading(false)
  }

  const limit = tierInfo.limit
  const pct = limit && used !== null ? Math.min((used / limit) * 100, 100) : 0
  const nearLimit = limit && used !== null && used >= limit * 0.8

  const currentColor = tierColor(theme, tierInfo.colorKey)

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader title={t('settings.subscription')} />

      {/* Current plan */}
      <Card sx={{ mb: 4 }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                მიმდინარე გეგმა
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Chip
                  label={tierInfo.label}
                  size="small"
                  sx={{ bgcolor: currentColor, color: 'white', fontWeight: 700 }}
                />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {tierInfo.price}
                </Typography>
              </Box>
              {expires && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                  ვადა: {new Date(expires).toLocaleDateString('ka-GE')}
                </Typography>
              )}
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Usage bar */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                ჯავშნები ამ თვეში
              </Typography>
              {loading
                ? <CircularProgress size={14} />
                : (
                  <Typography variant="body2" sx={{ color: nearLimit ? 'error.main' : 'text.secondary' }}>
                    {used} / {limit ?? '∞'}
                  </Typography>
                )
              }
            </Box>
            {limit && (
              <LinearProgress
                variant="determinate"
                value={pct}
                aria-label={`${used ?? 0} / ${limit}`}
                sx={{
                  height: 8, borderRadius: 4,
                  bgcolor: 'grey.100',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: pct >= 100 ? 'error.main' : pct >= 80 ? 'warning.main' : 'primary.main',
                  },
                }}
              />
            )}
            {nearLimit && limit && used !== null && used < limit && (
              <Typography variant="caption" sx={{ color: 'warning.main', mt: 0.5, display: 'block' }}>
                ლიმიტის 80% გამოყენებულია — განიხილეთ გაუმჯობესება
              </Typography>
            )}
            {limit && used !== null && used >= limit && (
              <Typography variant="caption" sx={{ color: 'error.main', mt: 0.5, display: 'block' }}>
                {t('subscription.limitReached')} — ახალი ჯავშნები დაბლოკილია
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Tier cards */}
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
        გეგმების შედარება
      </Typography>
      <Stack spacing={2}>
        {TIERS.map(tier => {
          const isCurrent = tier.key === currentTier
          const color = tierColor(theme, tier.colorKey)
          return (
            <Card
              key={tier.key}
              sx={{
                border: '2px solid',
                borderColor: isCurrent ? color : 'divider',
                transition: 'border-color 0.2s',
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {tier.label}
                      </Typography>
                      {isCurrent && (
                        <Chip label="მიმდინარე" size="small" sx={{ bgcolor: color, color: 'white', fontWeight: 600 }} />
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, color, mb: 1.5 }}>
                      {tier.price}
                    </Typography>
                    <Stack spacing={0.5}>
                      {tier.features.map(f => (
                        <Box key={f} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <CheckIcon sx={{ fontSize: 14, color }} />
                          <Typography variant="caption">{f}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>

                  {!isCurrent && tier.key !== 'free' && (
                    <Button
                      variant="outlined"
                      size="small"
                      sx={{ borderColor: color, color, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {t('subscription.upgrade')}
                    </Button>
                  )}
                </Box>
              </CardContent>
            </Card>
          )
        })}
      </Stack>

      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 3, textAlign: 'center' }}>
        გადახდა ხდება ყოველთვიურად · გაუქმება ნებისმიერ დროს · საჭიროების შემთხვევაში დაგვიკავშირდით
      </Typography>
    </Box>
  )
}
