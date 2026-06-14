import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, TextField,
  Switch, Stack, Divider, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, IconButton,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import { format, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'

interface DayConfig {
  open: boolean
  ranges: { start: string; end: string }[]
}

type WeekTemplate = {
  monday: DayConfig; tuesday: DayConfig; wednesday: DayConfig; thursday: DayConfig;
  friday: DayConfig; saturday: DayConfig; sunday: DayConfig;
}

interface Override {
  id: string
  date: string
  is_closed: boolean
  ranges: { start: string; end: string }[] | null
  note: string | null
}

const DAY_KEYS: (keyof WeekTemplate)[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]
const DAY_LABELS: Record<keyof WeekTemplate, string> = {
  monday: 'ორშაბათი', tuesday: 'სამშაბათი', wednesday: 'ოთხშაბათი',
  thursday: 'ხუთშაბათი', friday: 'პარასკევი', saturday: 'შაბათი', sunday: 'კვირა',
}

const DEFAULT_TEMPLATE: WeekTemplate = {
  monday:    { open: true,  ranges: [{ start: '09:00', end: '18:00' }] },
  tuesday:   { open: true,  ranges: [{ start: '09:00', end: '18:00' }] },
  wednesday: { open: true,  ranges: [{ start: '09:00', end: '18:00' }] },
  thursday:  { open: true,  ranges: [{ start: '09:00', end: '18:00' }] },
  friday:    { open: true,  ranges: [{ start: '09:00', end: '18:00' }] },
  saturday:  { open: false, ranges: [] },
  sunday:    { open: false, ranges: [] },
}

export default function WorkingHoursSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()

  const [templateId, setTemplateId] = useState<string | null>(null)
  const [template, setTemplate] = useState<WeekTemplate>(DEFAULT_TEMPLATE)
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Override dialog
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [ovDate, setOvDate] = useState('')
  const [ovClosed, setOvClosed] = useState(true)
  const [ovNote, setOvNote] = useState('')
  const [ovSaving, setOvSaving] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)

    const [tplRes, ovRes] = await Promise.all([
      supabase.from('working_hours_template').select('*').eq('org_id', org.id).single(),
      supabase
        .from('working_hours_overrides')
        .select('*')
        .eq('org_id', org.id)
        .gte('date', format(new Date(), 'yyyy-MM-dd'))
        .order('date'),
    ])

    if (tplRes.data) {
      setTemplateId(tplRes.data.id)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, org_id, updated_at, max_appointments_per_slot, ...days } = tplRes.data
      setTemplate(days as WeekTemplate)
    }
    setOverrides((ovRes.data ?? []) as Override[])
    setLoading(false)
  }

  function setDayOpen(day: keyof WeekTemplate, open: boolean) {
    setTemplate(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        open,
        ranges: open && prev[day].ranges.length === 0
          ? [{ start: '09:00', end: '18:00' }]
          : prev[day].ranges,
      },
    }))
  }

  function setRangeField(day: keyof WeekTemplate, idx: number, field: 'start' | 'end', val: string) {
    setTemplate(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        ranges: prev[day].ranges.map((r, i) => i === idx ? { ...r, [field]: val } : r),
      },
    }))
  }

  async function handleSave() {
    if (!org) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const payload = { ...template, org_id: org.id, updated_at: new Date().toISOString() }

    let err
    if (templateId) {
      ;({ error: err } = await supabase.from('working_hours_template').update(payload).eq('id', templateId))
    } else {
      ;({ error: err } = await supabase.from('working_hours_template').insert(payload))
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
  }

  async function addOverride() {
    if (!org || !ovDate) return
    setOvSaving(true)
    await supabase.from('working_hours_overrides').upsert({
      org_id: org.id,
      date: ovDate,
      is_closed: ovClosed,
      ranges: ovClosed ? null : [{ start: '09:00', end: '18:00' }],
      note: ovNote.trim() || null,
    }, { onConflict: 'org_id,date' })
    setOvSaving(false)
    setOverrideOpen(false)
    setOvDate('')
    setOvNote('')
    setOvClosed(true)
    load()
  }

  async function deleteOverride(id: string) {
    await supabase.from('working_hours_overrides').delete().eq('id', id)
    setOverrides(prev => prev.filter(o => o.id !== id))
  }

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>

  return (
    <Box sx={{ maxWidth: 680 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        {t('settings.workingHours')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>სამუშაო საათები შენახულია</Alert>}

      {/* Weekly template */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            ყოველკვირეული გრაფიკი
          </Typography>
          <Stack spacing={2}>
            {DAY_KEYS.map((day, di) => {
              const cfg = template[day]
              return (
                <Box key={day}>
                  {di > 0 && <Divider sx={{ mb: 2 }} />}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 110 }}>
                      {DAY_LABELS[day]}
                    </Typography>
                    <Switch
                      checked={cfg.open}
                      onChange={e => setDayOpen(day, e.target.checked)}
                      size="small"
                    />
                    {!cfg.open && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t('onboarding.closed')}
                      </Typography>
                    )}
                  </Box>

                  {cfg.open && cfg.ranges.map((r, ri) => (
                    <Box key={ri} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5, pl: '118px' }}>
                      <TextField
                        type="time"
                        size="small"
                        value={r.start}
                        onChange={e => setRangeField(day, ri, 'start', e.target.value)}
                        sx={{ width: 120 }}
                      />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>
                      <TextField
                        type="time"
                        size="small"
                        value={r.end}
                        onChange={e => setRangeField(day, ri, 'end', e.target.value)}
                        sx={{ width: 120 }}
                      />
                    </Box>
                  ))}
                </Box>
              )
            })}
          </Stack>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Per-day overrides */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
              გამონაკლისები (არდადეგები / სპეც. დღეები)
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setOverrideOpen(true)}>
              დამატება
            </Button>
          </Box>

          {overrides.length === 0
            ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                გამონაკლისები არ არის
              </Typography>
            )
            : overrides.map(ov => (
              <Box
                key={ov.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 2,
                  py: 1.5, borderBottom: '1px solid', borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {format(parseISO(ov.date), 'dd MMM yyyy')}
                  </Typography>
                  {ov.note && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{ov.note}</Typography>
                  )}
                </Box>
                <Chip
                  label={ov.is_closed ? 'დახურულია' : 'სპეც. საათები'}
                  size="small"
                  color={ov.is_closed ? 'error' : 'info'}
                  variant="outlined"
                />
                <IconButton size="small" color="error" onClick={() => deleteOverride(ov.id)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Box>
            ))
          }
        </CardContent>
      </Card>

      {/* Add override dialog */}
      <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>გამონაკლის დღის დამატება</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label="თარიღი"
              type="date"
              value={ovDate}
              onChange={e => setOvDate(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Switch checked={ovClosed} onChange={e => setOvClosed(e.target.checked)} />
              <Typography variant="body2">
                {ovClosed ? 'დახურულია (შვებულება / არდადეგი)' : 'გახსნილია განსხვავებული საათებით'}
              </Typography>
            </Box>
            <TextField
              label="შენიშვნა (არასავალდებულო)"
              value={ovNote}
              onChange={e => setOvNote(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOverrideOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={addOverride}
            disabled={ovSaving || !ovDate}
          >
            {ovSaving ? <CircularProgress size={20} color="inherit" /> : 'შენახვა'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
