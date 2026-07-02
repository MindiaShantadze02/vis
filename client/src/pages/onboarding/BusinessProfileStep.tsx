import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Box, TextField, Button } from '@mui/material'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { slugify } from '@/lib/slug'
import { isValidGeorgianPhone, FIELD_LIMITS } from '@/lib/validation'
import StepHeader from './StepHeader'
import type { OnboardingData } from './OnboardingLayout'

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
      <StepHeader
        icon={<StorefrontOutlinedIcon />}
        title={t('onboarding.step1')}
        subtitle={t('onboarding.step1Subtitle')}
      />

      <TextField
        fullWidth
        required
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
