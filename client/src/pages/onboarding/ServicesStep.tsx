import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Box, Button, Typography, TextField, IconButton,
  Card, CardContent, Stack,
} from '@mui/material'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import AddIcon from '@mui/icons-material/Add'
import { useTranslation } from 'react-i18next'
import type { OnboardingData } from './OnboardingLayout'

interface OutletCtx {
  goNext: () => void
  goBack: () => void
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

// Numeric fields are held as strings while editing so the inputs can be
// cleared/partially typed; they're coerced to numbers in addService().
interface DraftService {
  name: string
  duration_minutes: string
  price: string
}

const empty: DraftService = { name: '', duration_minutes: '30', price: '0' }

const onlyInt = (v: string) => v.replace(/[^0-9]/g, '')
const onlyDecimal = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')

export default function ServicesStep() {
  const { t } = useTranslation()
  const { goNext, goBack, data, update } = useOutletContext<OutletCtx>()
  const [draft, setDraft] = useState<DraftService>({ ...empty })

  function addService() {
    if (!draft.name.trim() || !(Number(draft.duration_minutes) > 0)) return
    update({
      services: [...data.services, {
        name: draft.name.trim(),
        duration_minutes: Number(draft.duration_minutes),
        price: Number(draft.price) || 0,
      }],
    })
    setDraft({ ...empty })
  }

  function removeService(index: number) {
    update({ services: data.services.filter((_, i) => i !== index) })
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
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {data.services.map((svc, i) => (
          <Card key={i} variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent
              sx={{
                py: 1.5,
                '&:last-child': { pb: 1.5 },
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>{svc.name}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {svc.duration_minutes} წთ · {svc.price} ₾
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => removeService(i)}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </CardContent>
          </Card>
        ))}
      </Stack>

      {/* Add new service form */}
      <Card variant="outlined" sx={{ borderRadius: 2, mb: 4 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>{t('onboarding.addService')}</Typography>
          <TextField
            fullWidth
            size="small"
            label={t('onboarding.serviceName')}
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              fullWidth
              size="small"
              label={t('onboarding.duration')}
              value={draft.duration_minutes}
              onChange={e => setDraft(d => ({ ...d, duration_minutes: onlyInt(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              fullWidth
              size="small"
              label={t('onboarding.price')}
              value={draft.price}
              onChange={e => setDraft(d => ({ ...d, price: onlyDecimal(e.target.value) }))}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          </Stack>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={addService}
            disabled={!draft.name.trim() || !(Number(draft.duration_minutes) > 0)}
          >
            {t('onboarding.addService')}
          </Button>
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
        >
          {t('common.next')}
        </Button>
      </Stack>
    </Box>
  )
}
