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
import { isValidUrl, isNonNegativeNumber, MAX_PRICE, FIELD_LIMITS } from '@/lib/validation'
import ServiceImagesEditor from '@/components/ServiceImagesEditor'
import { serviceImageFileError, MAX_IMAGES_PER_SERVICE, MAX_SERVICE_IMAGE_MB } from '@/lib/serviceImages'
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
interface DraftImage {
  key: string
  file: File
  url: string  // local blob: preview
}

interface DraftService {
  name: string
  duration_minutes: string
  price: string
  location_type: ServiceLocationType
  meeting_link: string
  images: DraftImage[]
}

const empty: DraftService = {
  name: '', duration_minutes: '30', price: '0',
  location_type: 'in_person', meeting_link: '', images: [],
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

  const durationTooLong = Number(draft.duration_minutes) > MAX_DURATION_MINUTES
  const nameTooShort = draft.name.trim().length > 0 && draft.name.trim().length < 2
  const priceInvalid = draft.price.trim().length > 0 &&
    (!isNonNegativeNumber(Number(draft.price)) || Number(draft.price) > MAX_PRICE)
  // Online services must carry a valid meeting link; in-person services ignore it.
  const isOnline = draft.location_type === 'online'
  const meetingLinkMissing = isOnline && draft.meeting_link.trim().length === 0
  const meetingLinkInvalid = isOnline && draft.meeting_link.trim().length > 0 && !isValidUrl(draft.meeting_link)
  const draftValid =
    draft.name.trim().length >= 2 &&
    Number(draft.duration_minutes) > 0 &&
    !durationTooLong &&
    !priceInvalid &&
    !meetingLinkMissing &&
    !meetingLinkInvalid
  const isEditing = editingIndex !== null

  function resetForm() {
    setDraft({ ...empty, images: [] })
    setEditingIndex(null)
  }

  function addImages(files: File[]) {
    const room = MAX_IMAGES_PER_SERVICE - draft.images.length
    if (files.length > room) toast.error(t('settings.serviceImagesMax', { max: MAX_IMAGES_PER_SERVICE }))
    const next: DraftImage[] = []
    for (const file of files.slice(0, Math.max(0, room))) {
      const err = serviceImageFileError(file)
      if (err) { toast.error(err === 'fileTooLarge' ? t('validation.fileTooLarge', { max: MAX_SERVICE_IMAGE_MB }) : t('validation.invalidImage')); continue }
      next.push({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) })
    }
    if (next.length) setDraft(d => ({ ...d, images: [...d.images, ...next] }))
  }

  function removeImage(key: string) {
    setDraft(d => {
      const gone = d.images.find(i => i.key === key)
      if (gone) URL.revokeObjectURL(gone.url)
      return { ...d, images: d.images.filter(i => i.key !== key) }
    })
  }

  function saveService() {
    // Report the specific problem instead of a silently disabled Add button.
    if (draft.name.trim().length < 2) { toast.error(t('validation.minLength', { min: 2 })); return }
    if (!(Number(draft.duration_minutes) > 0)) { toast.error(t('validation.required')); return }
    if (durationTooLong) { toast.error(t('validation.durationTooLong')); return }
    if (priceInvalid) { toast.error(t('validation.numberTooLarge')); return }
    if (meetingLinkMissing) { toast.error(t('validation.meetingLinkRequired')); return }
    if (meetingLinkInvalid) { toast.error(t('validation.invalidUrl')); return }
    if (!draftValid) return
    const svc = {
      name: draft.name.trim(),
      duration_minutes: Number(draft.duration_minutes),
      price: Number(draft.price) || 0,
      location_type: draft.location_type,
      // A meeting link only applies to online services (DB enforces this too).
      meeting_link: draft.location_type === 'online' ? (draft.meeting_link.trim() || null) : null,
      imageFiles: draft.images.map(i => i.file),
      imagePreviews: draft.images.map(i => i.url),
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
      meeting_link: svc.meeting_link ?? '',
      // Re-hydrate staged images so editing a row keeps its gallery. Files and
      // their existing preview URLs are reused (no re-encode).
      images: svc.imageFiles.map((file, i) => ({ key: `${index}-${i}`, file, url: svc.imagePreviews[i] })),
    })
    setEditingIndex(index)
  }

  function removeService(index: number) {
    update({ services: data.services.filter((_, i) => i !== index) })
    // If the row being edited is removed (or shifts), drop edit mode to avoid
    // editing the wrong service.
    if (editingIndex !== null && index <= editingIndex) resetForm()
  }

  // A service the user has started entering (needs at least a name to matter).
  const hasPendingDraft = draft.name.trim().length > 0 || isEditing
  // "Next" must not throw away a service the user typed but didn't add. If the
  // form holds a valid service, add it first; if it's half-finished, keep them
  // here and say why rather than silently dropping it.
  function handleNext() {
    if (hasPendingDraft) {
      if (!draftValid) { setDraftError(true); return }
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
            title="სერვისები ჯერ არ დაგიმატებიათ"
            caption="დაამატეთ პირველი სერვისი ქვემოთ"
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
                {svc.imagePreviews.length > 0 && (
                  <SkeletonImage
                    src={svc.imagePreviews[0]}
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
                    {svc.duration_minutes} წთ · <Box component="span" sx={{ color: HONEY, fontWeight: 700 }}>{svc.price} ₾</Box>
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
              error={durationTooLong}
              helperText={durationTooLong ? t('validation.durationTooLong') : undefined}
            />
            <TextField
              fullWidth
              label={t('onboarding.price')}
              value={draft.price}
              onChange={e => setDraft(d => ({ ...d, price: onlyDecimal(e.target.value) }))}
              error={priceInvalid}
              helperText={priceInvalid ? t('validation.numberTooLarge') : undefined}
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
          {draft.location_type === 'online' && (
            <TextField
              fullWidth
              label={t('settings.meetingLink')}
              value={draft.meeting_link}
              onChange={e => setDraft(d => ({ ...d, meeting_link: e.target.value }))}
              placeholder="https://"
              required
              error={meetingLinkMissing || meetingLinkInvalid}
              helperText={
                meetingLinkMissing ? t('validation.meetingLinkRequired')
                : meetingLinkInvalid ? t('validation.invalidUrl')
                : t('settings.meetingLinkHelp')
              }
              slotProps={{ htmlInput: { inputMode: 'url', maxLength: FIELD_LIMITS.meetingLink } }}
              sx={{ mb: 2 }}
            />
          )}
          <Box sx={{ mb: 2 }}>
            <ServiceImagesEditor
              images={draft.images.map(i => ({ key: i.key, url: i.url }))}
              onAdd={addImages}
              onRemove={removeImage}
              data-testid="onb-service-images"
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
