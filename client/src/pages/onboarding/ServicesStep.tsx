import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Box, Button, Typography, TextField,
  Card, CardContent, Stack, Divider,
  Chip, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DesignServicesOutlinedIcon from '@mui/icons-material/DesignServicesOutlined'
import AddIcon from '@mui/icons-material/Add'
import { useTranslation } from 'react-i18next'
import { ActionIconButton, EmptyState } from '@/components/ui'
import { isValidUrl, isNonNegativeNumber, MAX_PRICE, FIELD_LIMITS } from '@/lib/validation'
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
  meeting_link: string
}

const empty: DraftService = {
  name: '', duration_minutes: '30', price: '0',
  location_type: 'in_person', meeting_link: '',
}

// An appointment may last at most 24 hours. Mirrors the DB constraint
// services_duration_max (migration 009).
const MAX_DURATION_MINUTES = 1440

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function ServicesStep() {
  const { t } = useTranslation()
  const { goNext, goBack, data, update } = useOutletContext<OutletCtx>()
  const [draft, setDraft] = useState<DraftService>({ ...empty })
  // null = the form is adding a new service; a number = editing that index.
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

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
    setDraft({ ...empty })
    setEditingIndex(null)
  }

  function saveService() {
    if (!draftValid) return
    const svc = {
      name: draft.name.trim(),
      duration_minutes: Number(draft.duration_minutes),
      price: Number(draft.price) || 0,
      location_type: draft.location_type,
      // A meeting link only applies to online services (DB enforces this too).
      meeting_link: draft.location_type === 'online' ? (draft.meeting_link.trim() || null) : null,
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
    })
    setEditingIndex(index)
  }

  function removeService(index: number) {
    update({ services: data.services.filter((_, i) => i !== index) })
    // If the row being edited is removed (or shifts), drop edit mode to avoid
    // editing the wrong service.
    if (editingIndex !== null && index <= editingIndex) resetForm()
  }

  const canProceed = data.services.length > 0

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('onboarding.step2')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
        დაამატეთ მინიმუმ ერთი სერვისი
      </Typography>

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
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>{svc.name}</Typography>
                    {svc.location_type === 'online' && (
                      <Chip label={t('settings.locationOnline')} size="small" color="primary" variant="outlined" />
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {svc.duration_minutes} წთ · {svc.price} ₾
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
            size="small"
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
              size="small"
              label={t('onboarding.duration')}
              value={draft.duration_minutes}
              onChange={e => setDraft(d => ({ ...d, duration_minutes: onlyInt(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'onb-service-duration' } }}
              error={durationTooLong}
              helperText={durationTooLong ? t('validation.durationTooLong') : undefined}
            />
            <TextField
              fullWidth
              size="small"
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
              size="small"
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
              size="small"
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
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={isEditing ? undefined : <AddIcon />}
              onClick={saveService}
              disabled={!draftValid}
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

      <Stack direction="row" spacing={2}>
        <Button fullWidth variant="outlined" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button
          fullWidth
          variant="contained"
          size="large"
          disabled={!canProceed}
          onClick={goNext}
          data-testid="onb-services-next"
        >
          {t('common.next')}
        </Button>
      </Stack>
    </Box>
  )
}
