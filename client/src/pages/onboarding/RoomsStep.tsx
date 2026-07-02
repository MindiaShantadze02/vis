import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  Box, Button, Typography, TextField,
  Card, CardContent, Stack, Divider, Alert, CircularProgress,
  type SxProps, type Theme,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { HotelOutlined as HotelOutlinedIcon } from '@/components/icons'
import { Add as AddIcon } from '@/components/icons'
import { PhotoCameraOutlined as PhotoCameraOutlinedIcon } from '@/components/icons'
import { Close as CloseIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { ActionIconButton, EmptyState } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { persistOnboarding } from '@/lib/onboarding'
import { catalogImageFileError, MAX_IMAGES_PER_RESOURCE } from '@/lib/catalogImages'
import { imagesPerRoomForTier } from '@/lib/tiers'
import type { OnboardingData } from './OnboardingLayout'

interface OutletCtx {
  goNext: () => void
  goBack: () => void
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

// Numeric fields held as strings while editing (same convention as ServicesStep
// / RoomsSettings) so inputs can be cleared/partially typed.
interface DraftRoom {
  name: string
  capacity: string
  nightlyPrice: string
  totalRooms: string
  images: File[]
}

const empty: DraftRoom = { name: '', capacity: '2', nightlyPrice: '0', totalRooms: '1', images: [] }

// New orgs start on the free tier, so cap onboarding photos at the free-tier
// per-room limit (the server trigger enforces the same ceiling).
const MAX_PHOTOS = imagesPerRoomForTier('free', MAX_IMAGES_PER_RESOURCE)

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

/** Thumbnail for a locally-picked File; owns its object URL and revokes on unmount. */
function FileThumb({ file, sx }: { file: File; sx?: SxProps<Theme> }) {
  const url = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <Box component="img" src={url} alt="" sx={sx} />
}

export default function RoomsStep() {
  const { t } = useTranslation()
  const { goBack, data, update } = useOutletContext<OutletCtx>()
  const { user } = useAuth()
  const { refresh } = useOrg()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<DraftRoom>({ ...empty })
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const nameTooShort = draft.name.trim().length === 0
  const capacityInvalid = !(Number(draft.capacity) >= 1)
  const totalRoomsInvalid = !(Number(draft.totalRooms) >= 1)
  const draftValid = !nameTooShort && !capacityInvalid && !totalRoomsInvalid
  const isEditing = editingIndex !== null

  function resetForm() {
    setDraft({ ...empty })
    setEditingIndex(null)
    setPhotoError(null)
  }

  function saveRoom() {
    if (!draftValid) return
    const room = {
      name: draft.name.trim(),
      capacity: Number(draft.capacity),
      nightly_price: Number(draft.nightlyPrice) || 0,
      total_rooms: Number(draft.totalRooms),
      is_active: true,
      images: draft.images,
    }
    if (isEditing) {
      update({ rooms: data.rooms.map((r, i) => (i === editingIndex ? room : r)) })
    } else {
      update({ rooms: [...data.rooms, room] })
    }
    resetForm()
  }

  function startEdit(index: number) {
    const r = data.rooms[index]
    setDraft({
      name: r.name,
      capacity: String(r.capacity),
      nightlyPrice: String(r.nightly_price),
      totalRooms: String(r.total_rooms),
      images: r.images ?? [],
    })
    setEditingIndex(index)
    setPhotoError(null)
  }

  function removeRoom(index: number) {
    update({ rooms: data.rooms.filter((_, i) => i !== index) })
    if (editingIndex !== null && index <= editingIndex) resetForm()
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setPhotoError(null)
    const room = MAX_PHOTOS - draft.images.length
    if (room <= 0) { setPhotoError(t('image.maxReached', { max: MAX_PHOTOS })); return }
    const accepted: File[] = []
    for (const file of Array.from(files)) {
      if (accepted.length >= room) { setPhotoError(t('image.maxReached', { max: MAX_PHOTOS })); break }
      const fileErr = catalogImageFileError(file)
      if (fileErr) { setPhotoError(t(`validation.${fileErr}`)); continue }
      accepted.push(file)
    }
    if (accepted.length) setDraft(d => ({ ...d, images: [...d.images, ...accepted] }))
    if (fileRef.current) fileRef.current.value = ''
  }

  function removePhoto(idx: number) {
    setDraft(d => ({ ...d, images: d.images.filter((_, i) => i !== idx) }))
  }

  const canProceed = data.rooms.length > 0

  async function handleFinish() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      await persistOnboarding(data, user.id)
      await refresh()
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLoading(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('hotel.rooms')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
        {t('hotel.noRoomsCaption')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="rooms-error">{error}</Alert>}

      {/* Existing room types */}
      {data.rooms.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          <EmptyState
            icon={<HotelOutlinedIcon />}
            title={t('hotel.noRooms')}
            caption={t('hotel.noRoomsCaption')}
            py={4}
          />
        </Card>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          {data.rooms.map((r, i) => (
            <Box key={i}>
              {i > 0 && <Divider />}
              <Box
                data-testid="onb-room-row"
                sx={{
                  px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.25,
                  bgcolor: editingIndex === i ? 'action.selected' : 'transparent',
                }}
              >
                {r.images?.length ? (
                  <FileThumb
                    file={r.images[0]}
                    sx={{ width: 44, height: 44, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : null}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>{r.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {r.nightly_price} ₾ / {t('hotel.night')} · {r.capacity} {t('hotel.guests')} · {r.total_rooms} {t('hotel.roomsCount')}
                  </Typography>
                </Box>
                <ActionIconButton aria-label={t('common.edit')} data-testid="onb-room-edit" onClick={() => startEdit(i)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="onb-room-delete" onClick={() => removeRoom(i)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))}
        </Card>
      )}

      {/* Add / edit room form */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 4 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            {isEditing ? t('hotel.editRoom') : t('hotel.newRoom')}
          </Typography>
          <TextField
            fullWidth required size="small"
            label={t('hotel.roomName')}
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { maxLength: 60, 'data-testid': 'onb-room-name' } }}
          />
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              fullWidth required size="small"
              label={t('hotel.maxGuests')}
              value={draft.capacity}
              onChange={e => setDraft(d => ({ ...d, capacity: onlyInt(e.target.value) }))}
              error={capacityInvalid}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'onb-room-capacity' } }}
            />
            <TextField
              fullWidth required size="small"
              label={t('hotel.totalRooms')}
              value={draft.totalRooms}
              onChange={e => setDraft(d => ({ ...d, totalRooms: onlyInt(e.target.value) }))}
              error={totalRoomsInvalid}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'onb-room-total' } }}
            />
          </Stack>
          <TextField
            fullWidth size="small"
            label={t('hotel.nightlyPrice')}
            value={draft.nightlyPrice}
            onChange={e => setDraft(d => ({ ...d, nightlyPrice: onlyDecimal(e.target.value) }))}
            sx={{ mb: 2.5 }}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'onb-room-price' } }}
          />

          {/* Photos — held locally and uploaded once the room row exists at finish. */}
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t('image.photos')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {t('image.photosHint', { count: draft.images.length, max: MAX_PHOTOS })}
          </Typography>
          {photoError && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setPhotoError(null)}>{photoError}</Alert>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mb: 1 }}>
            {draft.images.map((file, i) => (
              <Box key={i} sx={{ position: 'relative' }}>
                <Box
                  sx={{
                    width: 84, height: 84, borderRadius: 2, overflow: 'hidden',
                    border: theme => `2px solid ${i === 0 ? theme.palette.primary.main : 'transparent'}`,
                    boxShadow: 1,
                  }}
                >
                  <FileThumb
                    file={file}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </Box>
                <Box
                  role="button"
                  aria-label={t('common.delete')}
                  onClick={() => removePhoto(i)}
                  sx={{
                    position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: '50%',
                    bgcolor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'common.white',
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </Box>
              </Box>
            ))}
            {draft.images.length < MAX_PHOTOS && (
              <Box
                role="button"
                aria-label={t('image.addPhoto')}
                data-testid="onb-room-add-photo"
                onClick={() => fileRef.current?.click()}
                sx={{
                  width: 84, height: 84, borderRadius: 2, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 0.5, cursor: 'pointer',
                  border: theme => `2px dashed ${theme.palette.divider}`, color: 'text.secondary',
                  '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
                }}
              >
                <PhotoCameraOutlinedIcon sx={{ fontSize: 22 }} />
                <Typography variant="caption">{t('image.addPhoto')}</Typography>
              </Box>
            )}
          </Box>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={e => handleFiles(e.target.files)}
          />

          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button
              variant="contained"
              startIcon={isEditing ? undefined : <AddIcon />}
              onClick={saveRoom}
              disabled={!draftValid}
              data-testid="onb-room-save"
            >
              {isEditing ? t('common.save') : t('hotel.newRoom')}
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
        <Button fullWidth variant="outlined" onClick={goBack} disabled={loading}>
          {t('common.back')}
        </Button>
        <Button
          fullWidth variant="contained" size="large"
          disabled={!canProceed || loading}
          onClick={handleFinish}
          data-testid="onb-rooms-next"
        >
          {loading ? <CircularProgress size={20} color="inherit" /> : t('onboarding.finish')}
        </Button>
      </Stack>
    </Box>
  )
}
