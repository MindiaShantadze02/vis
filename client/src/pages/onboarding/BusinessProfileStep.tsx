import { useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Box, TextField, Button, Avatar, Typography } from '@mui/material'
import { StorefrontOutlined as StorefrontOutlinedIcon } from '@/components/icons'
import { PhotoCameraOutlined as PhotoCameraOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { slugify } from '@/lib/slug'
import { isValidGeorgianPhone, imageFileError, FIELD_LIMITS } from '@/lib/validation'
import { useToast } from '@/components/ui'
import { surface } from '@/theme/theme'
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
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-derive slug from name silently — not shown to the user
  useEffect(() => {
    if (data.name) update({ slug: slugify(data.name) })
  }, [data.name])

  // Stage the logo file + a local preview; the upload happens at finish, once
  // the org row (whose id keys the storage path) exists.
  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const fileErr = imageFileError(file)
    if (fileErr) {
      toast.error(fileErr === 'fileTooLarge' ? t('validation.fileTooLarge', { max: 2 }) : t('validation.invalidImage'))
      return
    }
    update({ logoFile: file, logoPreview: URL.createObjectURL(file) })
  }

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

      {/* Logo — staged locally, uploaded at finish (mirrors the Business-info
          settings picker). Optional. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 3 }}>
        <Box onClick={() => fileRef.current?.click()} sx={{ position: 'relative', cursor: 'pointer' }}>
          <Avatar
            src={data.logoPreview ?? undefined}
            sx={{ width: 80, height: 80, bgcolor: 'primary.main', fontSize: 28 }}
          >
            {(data.name.trim() || '?').charAt(0).toUpperCase()}
          </Avatar>
          <Box
            sx={{
              position: 'absolute', bottom: 0, right: 0,
              width: 26, height: 26, borderRadius: '50%',
              bgcolor: 'background.paper', border: '2px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              '&:hover': { bgcolor: surface.hover },
            }}
          >
            <PhotoCameraOutlinedIcon sx={{ fontSize: 14 }} />
          </Box>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            data-testid="biz-logo-input"
            onChange={pickLogo}
          />
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('settings.logo')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('settings.logoHint')}</Typography>
        </Box>
      </Box>

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
