import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Box, Button, Typography, TextField,
  Card, CardContent, Stack, Divider,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { HotelOutlined as HotelOutlinedIcon } from '@/components/icons'
import { Add as AddIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { ActionIconButton, EmptyState } from '@/components/ui'
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
}

const empty: DraftRoom = { name: '', capacity: '2', nightlyPrice: '0', totalRooms: '1' }

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function RoomsStep() {
  const { t } = useTranslation()
  const { goNext, goBack, data, update } = useOutletContext<OutletCtx>()
  const [draft, setDraft] = useState<DraftRoom>({ ...empty })
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const nameTooShort = draft.name.trim().length === 0
  const capacityInvalid = !(Number(draft.capacity) >= 1)
  const totalRoomsInvalid = !(Number(draft.totalRooms) >= 1)
  const draftValid = !nameTooShort && !capacityInvalid && !totalRoomsInvalid
  const isEditing = editingIndex !== null

  function resetForm() {
    setDraft({ ...empty })
    setEditingIndex(null)
  }

  function saveRoom() {
    if (!draftValid) return
    const room = {
      name: draft.name.trim(),
      capacity: Number(draft.capacity),
      nightly_price: Number(draft.nightlyPrice) || 0,
      total_rooms: Number(draft.totalRooms),
      is_active: true,
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
    })
    setEditingIndex(index)
  }

  function removeRoom(index: number) {
    update({ rooms: data.rooms.filter((_, i) => i !== index) })
    if (editingIndex !== null && index <= editingIndex) resetForm()
  }

  const canProceed = data.rooms.length > 0

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('hotel.rooms')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
        {t('hotel.noRoomsCaption')}
      </Typography>

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
                  px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1,
                  bgcolor: editingIndex === i ? 'action.selected' : 'transparent',
                }}
              >
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
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'onb-room-price' } }}
          />
          <Stack direction="row" spacing={1}>
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
        <Button fullWidth variant="outlined" onClick={goBack}>
          {t('common.back')}
        </Button>
        <Button
          fullWidth variant="contained" size="large"
          disabled={!canProceed}
          onClick={goNext}
          data-testid="onb-rooms-next"
        >
          {t('common.next')}
        </Button>
      </Stack>
    </Box>
  )
}
