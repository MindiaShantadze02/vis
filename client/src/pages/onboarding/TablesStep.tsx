import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Box, Button, Typography, TextField,
  Card, CardContent, Stack, Divider,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { EditOutlined as EditOutlinedIcon } from '@/components/icons'
import { TableRestaurantOutlined as TableRestaurantOutlinedIcon } from '@/components/icons'
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
// / TablesSettings) so inputs can be cleared/partially typed.
interface DraftTable {
  name: string
  capacity: string
}

const empty: DraftTable = { name: '', capacity: '2' }

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')

export default function TablesStep() {
  const { t } = useTranslation()
  const { goNext, goBack, data, update } = useOutletContext<OutletCtx>()
  const [draft, setDraft] = useState<DraftTable>({ ...empty })
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const nameTooShort = draft.name.trim().length === 0
  const capacityInvalid = !(Number(draft.capacity) >= 1)
  const draftValid = !nameTooShort && !capacityInvalid
  const isEditing = editingIndex !== null

  const turnInvalid = !(Number(data.turnMinutes) > 0)

  function resetForm() {
    setDraft({ ...empty })
    setEditingIndex(null)
  }

  function saveTable() {
    if (!draftValid) return
    const table = { name: draft.name.trim(), capacity: Number(draft.capacity), is_active: true }
    if (isEditing) {
      update({ tables: data.tables.map((tb, i) => (i === editingIndex ? table : tb)) })
    } else {
      update({ tables: [...data.tables, table] })
    }
    resetForm()
  }

  function startEdit(index: number) {
    const tb = data.tables[index]
    setDraft({ name: tb.name, capacity: String(tb.capacity) })
    setEditingIndex(index)
  }

  function removeTable(index: number) {
    update({ tables: data.tables.filter((_, i) => i !== index) })
    if (editingIndex !== null && index <= editingIndex) resetForm()
  }

  const canProceed = data.tables.length > 0 && !turnInvalid

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t('restaurant.tables')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
        {t('restaurant.noTablesCaption')}
      </Typography>

      {/* Turn time — how long a reservation holds a table. */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 3, p: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{t('restaurant.turnTime')}</Typography>
        <TextField
          size="small"
          value={String(data.turnMinutes)}
          onChange={e => update({ turnMinutes: Number(onlyInt(e.target.value)) })}
          error={turnInvalid}
          helperText={t('restaurant.turnTimeHelp')}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'onb-turn-minutes' } }}
          sx={{ width: 160 }}
        />
      </Card>

      {/* Existing tables */}
      {data.tables.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          <EmptyState
            icon={<TableRestaurantOutlinedIcon />}
            title={t('restaurant.noTables')}
            caption={t('restaurant.noTablesCaption')}
            py={4}
          />
        </Card>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          {data.tables.map((tb, i) => (
            <Box key={i}>
              {i > 0 && <Divider />}
              <Box
                data-testid="onb-table-row"
                sx={{
                  px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1,
                  bgcolor: editingIndex === i ? 'action.selected' : 'transparent',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>{tb.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {tb.capacity} {t('restaurant.seats')}
                  </Typography>
                </Box>
                <ActionIconButton aria-label={t('common.edit')} data-testid="onb-table-edit" onClick={() => startEdit(i)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="onb-table-delete" onClick={() => removeTable(i)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))}
        </Card>
      )}

      {/* Add / edit table form */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 4 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            {isEditing ? t('restaurant.editTable') : t('restaurant.newTable')}
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              fullWidth required size="small"
              label={t('restaurant.tableName')}
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: 60, 'data-testid': 'onb-table-name' } }}
            />
            <TextField
              fullWidth required size="small"
              label={t('restaurant.seats')}
              value={draft.capacity}
              onChange={e => setDraft(d => ({ ...d, capacity: onlyInt(e.target.value) }))}
              error={capacityInvalid}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'onb-table-capacity' } }}
            />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              variant="contained"
              startIcon={isEditing ? undefined : <AddIcon />}
              onClick={saveTable}
              disabled={!draftValid}
              data-testid="onb-table-save"
            >
              {isEditing ? t('common.save') : t('restaurant.newTable')}
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
          data-testid="onb-tables-next"
        >
          {t('common.next')}
        </Button>
      </Stack>
    </Box>
  )
}
