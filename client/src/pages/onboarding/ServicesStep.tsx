import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Box, Button, Typography, TextField,
  Card, CardContent, Stack, Divider,
  Chip, ToggleButtonGroup, ToggleButton, Alert,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { DesignServicesOutlined as DesignServicesOutlinedIcon } from '@/components/icons'
import { Add as AddIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { ActionIconButton, EmptyState, SkeletonImage, useToast } from '@/components/ui'
import { HONEY } from '@/theme/theme'
import { isValidServicePrice, MAX_PRICE, MIN_PRICE, FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import ServiceThumbnailPicker from '@/components/ServiceThumbnailPicker'
import { serviceImageFileError, isLowResolution, MAX_SERVICE_IMAGE_MB, RECOMMENDED_SERVICE_IMAGE_WIDTH } from '@/lib/serviceImages'
import StepHeader from './StepHeader'
import type { OnboardingData, ServiceLocationType } from './OnboardingLayout'

interface OutletCtx {
  goNext: () => void
  goBack: () => void
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

// Numeric fields are held as strings while editing so the inputs can be
// cleared/partially typed; they're coerced to numbers in saveService().
interface DraftService {
  name: string
  duration_minutes: string
  price: string
  location_type: ServiceLocationType
  // Staged thumbnail: the File plus its local blob: preview.
  imageFile: File | null
  imagePreview: string | null
}

// Every field starts empty: a prefilled duration/price is a value the owner
// never chose, and a prefilled ₾0 saves a free service silently (MIN_PRICE is 0).
const empty: DraftService = {
  name: '', duration_minutes: '', price: '',
  location_type: 'in_person', imageFile: null, imagePreview: null,
}

// An appointment may last at most 24 hours. Mirrors the DB constraint
// services_duration_max (migration 009).
const MAX_DURATION_MINUTES = 1440

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function ServicesStep() {
  const { t } = useTranslation()
  const toast = useToast()
  const { goNext, goBack, data, update } = useOutletContext<OutletCtx>()
  const [draft, setDraft] = useState<DraftService>({ ...empty })
  // null = the form is adding a new service; a number = editing that index.
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  // Set when the user hits "Next" with an in-progress service that isn't valid
  // yet — so we can explain why we didn't move on (instead of silently dropping it).
  const [draftError, setDraftError] = useState(false)
  // Set on the first Add/Next attempt for the current draft: from then on empty
  // required fields are flagged inline too. Reset with the draft.
  const [submitted, setSubmitted] = useState(false)

  const durationTooLong = Number(draft.duration_minutes) > MAX_DURATION_MINUTES
  const durationMissing = submitted && !(Number(draft.duration_minutes) > 0)
  const nameTooShort = (submitted || draft.name.trim().length > 0) && draft.name.trim().length < 2
  // Price is required: an empty field is rejected explicitly, because Number('')
  // is 0 and a ₾0 service is legal (see MIN_PRICE) — so "left blank" would
  // otherwise save silently as free.
  const priceValid = draft.price.trim().length > 0 && isValidServicePrice(Number(draft.price))
  const priceInvalid = (submitted || draft.price.trim().length > 0) && !priceValid
  const draftValid =
    draft.name.trim().length >= 2 &&
    Number(draft.duration_minutes) > 0 &&
    !durationTooLong &&
    priceValid
  const isEditing = editingIndex !== null

  function resetForm() {
    setDraft({ ...empty })
    setEditingIndex(null)
    setSubmitted(false)
  }

  async function pickImage(file: File) {
    const err = serviceImageFileError(file)
    if (err) {
      toast.error(err === 'fileTooLarge' ? t('validation.fileTooLarge', { max: MAX_SERVICE_IMAGE_MB }) : t('validation.invalidImage'))
      return
    }
    setDraft(d => ({ ...d, imageFile: file, imagePreview: URL.createObjectURL(file) }))
    // Kept, but flagged: a small photo is stretched across the booking card.
    if (await isLowResolution(file)) {
      toast.error(t('validation.imageLowResolution', { width: RECOMMENDED_SERVICE_IMAGE_WIDTH }))
    }
  }

  function removeImage() {
    // The preview may be shared with an already-saved row (startEdit reuses the
    // same blob: URL), so it is revoked when the row itself is dropped, not here.
    setDraft(d => ({ ...d, imageFile: null, imagePreview: null }))
  }

  function saveService() {
    // Flag the specific problems inline (instead of a silently disabled Add
    // button) and bring the first offending field into view + focus it.
    setSubmitted(true)
    if (!draftValid) { focusFirstInvalidFieldAfterRender(); return }
    const svc = {
      // Reuse the row's key when editing so the specialists step keeps its
      // assignment; a new row gets a fresh one.
      key: isEditing ? data.services[editingIndex!].key : crypto.randomUUID(),
      name: draft.name.trim(),
      duration_minutes: Number(draft.duration_minutes),
      price: Number(draft.price),
      location_type: draft.location_type,
      imageFile: draft.imageFile,
      imagePreview: draft.imagePreview,
    }
    if (isEditing) {
      update({ services: data.services.map((s, i) => (i === editingIndex ? svc : s)) })
    } else {
      update({ services: [...data.services, svc] })
    }
    resetForm()
  }

  function startEdit(index: number) {
    const svc = data.services[index]
    setDraft({
      name: svc.name,
      duration_minutes: String(svc.duration_minutes),
      price: String(svc.price),
      location_type: svc.location_type,
      // Re-hydrate the staged photo so editing a row keeps it. The File and its
      // existing preview URL are reused (no re-encode).
      imageFile: svc.imageFile,
      imagePreview: svc.imagePreview,
    })
    setEditingIndex(index)
  }

  function removeService(index: number) {
    update({ services: data.services.filter((_, i) => i !== index) })
    // If the row being edited is removed (or shifts), drop edit mode to avoid
    // editing the wrong service.
    if (editingIndex !== null && index <= editingIndex) resetForm()
  }

  // A service the user has started entering. Every field starts empty now, so
  // any one of them holding a value (or a staged photo) means there's a draft
  // worth keeping — a pristine form means the owner is done adding services.
  const hasPendingDraft =
    isEditing ||
    draft.name.trim().length > 0 ||
    draft.duration_minutes.trim().length > 0 ||
    draft.price.trim().length > 0 ||
    draft.imageFile !== null
  // "Next" must not throw away a service the user typed but didn't add. If the
  // form holds a valid service, add it first; if it's half-finished, keep them
  // here and say why rather than silently dropping it.
  function handleNext() {
    if (hasPendingDraft) {
      if (!draftValid) {
        setDraftError(true)
        // Also flag the specific fields and pull the first one into view.
        setSubmitted(true)
        focusFirstInvalidFieldAfterRender()
        return
      }
      saveService()
    } else if (data.services.length === 0) {
      // At least one service is required — say so rather than disable Next.
      toast.error(t('onboarding.serviceRequired'))
      return
    }
    goNext()
  }

  return (
    <Box>
      <StepHeader
        icon={<DesignServicesOutlinedIcon />}
        title={t('onboarding.step2')}
        subtitle={t('onboarding.step2Subtitle')}
      />

      {/* Existing services */}
      {data.services.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          <EmptyState
            icon={<DesignServicesOutlinedIcon />}
            title={t('onboarding.noServicesTitle')}
            caption={t('onboarding.noServicesCaption')}
            py={4}
          />
        </Card>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          {data.services.map((svc, i) => (
            <Box key={i}>
              {i > 0 && <Divider />}
              <Box
                data-testid="onb-service-row"
                sx={{
                  px: 2, py: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  bgcolor: editingIndex === i ? 'action.selected' : 'transparent',
                }}
              >
                {svc.imagePreview && (
                  <SkeletonImage
                    src={svc.imagePreview}
                    alt=""
                    data-testid="onb-service-thumb"
                    sx={{ width: 40, height: 40, borderRadius: 1.5, flexShrink: 0, border: '1px solid', borderColor: 'divider' }}
                  />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>{svc.name}</Typography>
                    {svc.location_type === 'online' && (
                      <Chip label={t('settings.locationOnline')} size="small" color="primary" variant="outlined" />
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {svc.duration_minutes} {t('common.minutesShort')} · <Box component="span" sx={{ color: HONEY, fontWeight: 700 }}>{svc.price} ₾</Box>
                  </Typography>
                </Box>
                <ActionIconButton aria-label={t('common.edit')} data-testid="onb-service-edit" onClick={() => startEdit(i)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="onb-service-delete" onClick={() => removeService(i)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))}
        </Card>
      )}

      {/* Add / edit service form */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 4 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            {isEditing ? t('common.edit') : t('onboarding.addService')}
          </Typography>
          <TextField
            fullWidth
            required
            label={t('onboarding.serviceName')}
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            error={nameTooShort}
            helperText={nameTooShort ? t('validation.minLength', { min: 2 }) : undefined}
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.serviceName, 'data-testid': 'onb-service-name' } }}
          />
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              required
              label={t('onboarding.duration')}
              value={draft.duration_minutes}
              onChange={e => setDraft(d => ({ ...d, duration_minutes: onlyInt(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'onb-service-duration' } }}
              error={durationTooLong || durationMissing}
              helperText={
                durationTooLong ? t('validation.durationTooLong')
                : durationMissing ? t('validation.required')
                : undefined
              }
            />
            <TextField
              fullWidth
              required
              label={t('onboarding.price')}
              value={draft.price}
              onChange={e => setDraft(d => ({ ...d, price: onlyDecimal(e.target.value) }))}
              error={priceInvalid}
              helperText={
                !priceInvalid ? undefined
                : draft.price.trim().length === 0 ? t('validation.required')
                : Number(draft.price) > MAX_PRICE ? t('validation.priceTooLarge', { max: MAX_PRICE })
                : t('validation.priceTooLow', { min: MIN_PRICE })
              }
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'onb-service-price' } }}
            />
          </Stack>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              {t('settings.location')}
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={draft.location_type}
              onChange={(_, v: ServiceLocationType | null) => {
                if (v) setDraft(d => ({ ...d, location_type: v }))
              }}
            >
              <ToggleButton value="in_person">{t('settings.locationInPerson')}</ToggleButton>
              <ToggleButton value="online">{t('settings.locationOnline')}</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box sx={{ mb: 2 }}>
            <ServiceThumbnailPicker
              url={draft.imagePreview}
              onPick={pickImage}
              onRemove={removeImage}
              data-testid="onb-service-image"
            />
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={isEditing ? undefined : <AddIcon />}
              onClick={saveService}
              data-testid="onb-service-save"
            >
              {isEditing ? t('common.save') : t('onboarding.addService')}
            </Button>
            {isEditing && (
              <Button variant="text" onClick={resetForm}>
                {t('common.cancel')}
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      {draftError && !draftValid && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setDraftError(false)} data-testid="onb-service-draft-warning">
          {t('onboarding.finishServiceFirst')}
        </Alert>
      )}

      <Stack direction="row" spacing={2}>
        <Button fullWidth variant="outlined" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={handleNext}
          data-testid="onb-services-next"
        >
          {t('common.next')}
        </Button>
      </Stack>
    </Box>
  )
}
