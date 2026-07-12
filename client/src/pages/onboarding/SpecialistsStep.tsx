import { useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Box, Button, Typography, TextField, Avatar,
  Card, CardContent, Stack, Divider, Chip, Alert,
  Switch, FormControlLabel,
} from '@mui/material'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { PersonAddOutlined as PersonAddOutlinedIcon } from '@/components/icons'
import { PhotoCameraOutlined as PhotoCameraOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { tierInfo } from '@/lib/tiers'
import { imageFileError, FIELD_LIMITS } from '@/lib/validation'
import { ActionIconButton, EmptyState, useToast } from '@/components/ui'
import { surface } from '@/theme/theme'
import StepHeader from './StepHeader'
import type { OnboardingData, OnboardingSpecialist } from './OnboardingLayout'

interface OutletCtx {
  goNext: () => void
  goBack: () => void
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

// Avatar with a camera badge that stages a photo file — same widget as the
// Team settings dialogs (upload is deferred to finish; the storage path needs
// the member row's id).
function PhotoPicker({ src, initials, onPick }: {
  src: string | null
  initials: string
  onPick: (file: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Box onClick={() => ref.current?.click()} sx={{ position: 'relative', width: 72, cursor: 'pointer' }}>
      <Avatar src={src ?? undefined} sx={{ width: 72, height: 72, bgcolor: 'primary.main', fontSize: 26 }}>
        {initials}
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
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        data-testid="onb-specialist-photo-input"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />
    </Box>
  )
}

export default function SpecialistsStep() {
  const { t } = useTranslation()
  const { goNext, goBack, data, update } = useOutletContext<OutletCtx>()
  const toast = useToast()

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [bookable, setBookable] = useState(true)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  // Set when Next is hit with a half-filled specialist that isn't valid yet —
  // explain why we stayed instead of silently dropping it (mirrors ServicesStep).
  const [draftError, setDraftError] = useState(false)

  // A new org is on the Starter-level trial, so the enforce_staff_limit trigger
  // allows that tier's bookable count. Gate the toggle here instead of failing
  // the whole finish insert later.
  const staffLimit = tierInfo('starter').staffLimit
  const bookableCount = data.specialists.filter(s => s.is_bookable).length
  const bookableLimitHit = staffLimit !== null && bookableCount >= staffLimit
  const effectiveBookable = bookable && !bookableLimitHit

  function pickPhoto(file: File) {
    const fileErr = imageFileError(file)
    if (fileErr) {
      toast.error(fileErr === 'fileTooLarge' ? t('validation.fileTooLarge', { max: 2 }) : t('validation.invalidImage'))
      return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  function resetForm() {
    setName(''); setTitle(''); setBookable(true)
    setPhotoFile(null); setPhotoPreview(null)
  }

  function addSpecialist() {
    // Report the requirement instead of a silently disabled Add button.
    if (name.trim().length < 2) { toast.error(t('validation.minLength', { min: 2 })); return }
    const specialist: OnboardingSpecialist = {
      name: name.trim(),
      title: title.trim(),
      is_bookable: effectiveBookable,
      photoFile,
      photoPreview,
    }
    update({ specialists: [...data.specialists, specialist] })
    setDraftError(false)
    resetForm()
  }

  function removeSpecialist(index: number) {
    update({ specialists: data.specialists.filter((_, i) => i !== index) })
  }

  const draftValid = name.trim().length >= 2
  // Anything typed or picked counts as an in-progress specialist.
  const hasPendingDraft = name.trim().length > 0 || title.trim().length > 0 || photoFile !== null

  // "Next" must not throw away a specialist the user typed but didn't add. A
  // valid draft is added for them; a half-finished one keeps them here with an
  // explanation rather than being silently dropped.
  function handleNext() {
    if (hasPendingDraft) {
      if (!draftValid) { setDraftError(true); return }
      addSpecialist()
    }
    goNext()
  }

  return (
    <Box>
      <StepHeader
        icon={<GroupOutlinedIcon />}
        title={t('onboarding.stepSpecialists')}
        subtitle={t('onboarding.stepSpecialistsSubtitle')}
      />

      {/* Added specialists */}
      {data.specialists.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          <EmptyState
            icon={<GroupOutlinedIcon />}
            title={t('onboarding.noSpecialistsTitle')}
            caption={t('onboarding.noSpecialistsCaption')}
            py={4}
          />
        </Card>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          {data.specialists.map((sp, i) => (
            <Box key={i}>
              {i > 0 && <Divider />}
              <Box
                data-testid="onb-specialist-row"
                sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}
              >
                <Avatar src={sp.photoPreview ?? undefined} sx={{ width: 36, height: 36, bgcolor: 'primary.main', fontSize: 14 }}>
                  {sp.name.slice(0, 2).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{sp.name}</Typography>
                  {sp.title && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{sp.title}</Typography>
                  )}
                </Box>
                {sp.is_bookable
                  ? <Chip label={t('settings.bookable')} size="small" color="success" variant="outlined" />
                  : <Chip label={t('settings.hidden')} size="small" variant="outlined" />}
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="onb-specialist-delete" onClick={() => removeSpecialist(i)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))}
        </Card>
      )}

      {/* Add-specialist form */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 4 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('settings.addProfessional')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
            {t('settings.addProfessionalHelp')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
            {/* Nudged down so the avatar centres on the two text fields. */}
            <Box sx={{ mt: 2 }}>
              <PhotoPicker
                src={photoPreview}
                initials={(name.trim() || '?').slice(0, 2).toUpperCase()}
                onPick={pickPhoto}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <TextField
                fullWidth
                required
                label={t('settings.displayName')}
                value={name}
                onChange={e => setName(e.target.value)}
                sx={{ mb: 2 }}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'onb-specialist-name' } }}
              />
              <TextField
                fullWidth
                label={t('settings.staffTitle')}
                value={title}
                onChange={e => setTitle(e.target.value)}
                sx={{ mb: 1 }}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.title, 'data-testid': 'onb-specialist-title' } }}
              />
              <FormControlLabel
                sx={{ ml: 0 }}
                control={(
                  <Switch
                    checked={effectiveBookable}
                    onChange={e => setBookable(e.target.checked)}
                    disabled={bookableLimitHit}
                    data-testid="onb-specialist-bookable"
                  />
                )}
                label={(
                  <Box>
                    <Typography variant="body2">{t('settings.bookable')}</Typography>
                    {bookableLimitHit && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('settings.staffLimitReached', { limit: staffLimit })}
                      </Typography>
                    )}
                  </Box>
                )}
              />
              {/* Inside the fields column so it reads as this form's action. */}
              <Stack direction="row" spacing={1} sx={{ mt: 2.5 }}>
                <Button
                  variant="contained"
                  startIcon={<PersonAddOutlinedIcon />}
                  onClick={addSpecialist}
                  data-testid="onb-specialist-save"
                >
                  {t('common.add')}
                </Button>
              </Stack>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {draftError && !draftValid && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setDraftError(false)} data-testid="onb-specialist-draft-warning">
          {t('onboarding.finishSpecialistFirst')}
        </Alert>
      )}

      {/* Optional step — Next is always available, with or without specialists. */}
      <Stack direction="row" spacing={2}>
        <Button fullWidth variant="outlined" onClick={goBack} data-testid="onb-specialists-back">
          {t('common.back')}
        </Button>
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={handleNext}
          data-testid="onb-specialists-next"
        >
          {t('common.next')}
        </Button>
      </Stack>
    </Box>
  )
}
