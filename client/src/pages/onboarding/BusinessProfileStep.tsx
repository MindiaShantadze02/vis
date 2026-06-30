import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Box, TextField, Button, Typography, Stack, Chip } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { slugify } from '@/lib/slug'
import { isValidGeorgianPhone, FIELD_LIMITS } from '@/lib/validation'
import type { Vertical } from '@/lib/verticals'
import type { OnboardingData } from './OnboardingLayout'

// Vertical chooser — all three are now shippable.
const VERTICAL_OPTIONS: { key: Vertical; disabled?: boolean }[] = [
  { key: 'appointments' },
  { key: 'restaurant' },
  { key: 'hotel' },
]

interface OutletCtx {
  goNext: () => void
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

export default function BusinessProfileStep() {
  const { t } = useTranslation()
  const { goNext, data, update } = useOutletContext<OutletCtx>()

  // Auto-derive slug from name silently — not shown to the user
  useEffect(() => {
    if (data.name) update({ slug: slugify(data.name) })
  }, [data.name])

  const phoneInvalid =
    data.contact_phone.trim().length > 0 && !isValidGeorgianPhone(data.contact_phone)
  const nameTooShort = data.name.trim().length > 0 && data.name.trim().length < 2
  const canProceed =
    data.name.trim().length >= 2 &&
    isValidGeorgianPhone(data.contact_phone)

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('onboarding.step1')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
        {t('onboarding.step1Subtitle')}
      </Typography>

      {/* Vertical chooser — set once here, then locked for the org. */}
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.25 }}>
        {t('restaurant.choose')}
      </Typography>
      <Stack spacing={1.25} sx={{ mb: 3 }}>
        {VERTICAL_OPTIONS.map(opt => {
          const selected = data.vertical === opt.key
          return (
            <Box
              key={opt.key}
              data-testid={`vertical-${opt.key}`}
              onClick={() => { if (!opt.disabled) update({ vertical: opt.key }) }}
              sx={{
                p: 1.75, borderRadius: 2,
                cursor: opt.disabled ? 'default' : 'pointer',
                border: '2px solid',
                borderColor: selected ? 'primary.main' : 'divider',
                bgcolor: selected ? 'secondary.main' : 'background.paper',
                opacity: opt.disabled ? 0.55 : 1,
                transition: 'all 0.15s ease',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 700 }}>
                  {t(`restaurant.${opt.key}`)}
                </Typography>
                {opt.disabled && <Chip size="small" label={t('restaurant.comingSoon')} />}
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t(`restaurant.${opt.key}Desc`)}
              </Typography>
            </Box>
          )
        })}
      </Stack>

      <TextField
        fullWidth
        label={t('onboarding.businessName')}
        value={data.name}
        onChange={e => update({ name: e.target.value })}
        error={nameTooShort}
        helperText={nameTooShort ? t('validation.minLength', { min: 2 }) : ' '}
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.orgName, 'data-testid': 'biz-name' } }}
      />

      <TextField
        fullWidth
        label={t('onboarding.businessDescription')}
        value={data.description}
        onChange={e => update({ description: e.target.value })}
        multiline
        rows={2}
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.description, 'data-testid': 'biz-description' } }}
      />

      <TextField
        fullWidth
        label={t('onboarding.contactPhone')}
        value={data.contact_phone}
        onChange={e => update({ contact_phone: e.target.value })}
        required
        placeholder="555 123 456"
        error={phoneInvalid}
        helperText={phoneInvalid ? t('validation.invalidPhone') : ' '}
        slotProps={{ htmlInput: { inputMode: 'tel' as const, 'data-testid': 'biz-phone' } }}
        sx={{ mb: 4 }}
      />

      <Button
        fullWidth
        variant="contained"
        size="large"
        disabled={!canProceed}
        onClick={goNext}
        data-testid="biz-next"
      >
        {t('common.next')}
      </Button>
    </Box>
  )
}
