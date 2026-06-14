import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, TextField,
  Switch, Stack, Divider, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, IconButton,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import CloseIcon from '@mui/icons-material/Close'
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import { format, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import {
  isEndAfterStart, timeToMinutes, minutesToTime, clampTime,
  rangesToSchedule, scheduleToRanges, dayScheduleIssue,
  type TimeRange, type DaySchedule,
} from '@/lib/validation'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, ConfirmDialog, useToast } from '@/components/ui'

type WeekTemplate = {
  monday: DaySchedule; tuesday: DaySchedule; wednesday: DaySchedule; thursday: DaySchedule;
  friday: DaySchedule; saturday: DaySchedule; sunday: DaySchedule;
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

const openDay = (): DaySchedule => ({ open: true, openTime: '09:00', closeTime: '18:00', breaks: [] })
const closedDay = (): DaySchedule => ({ open: false, openTime: '09:00', closeTime: '18:00', breaks: [] })

const DEFAULT_TEMPLATE: WeekTemplate = {
  monday: openDay(), tuesday: openDay(), wednesday: openDay(),
  thursday: openDay(), friday: openDay(), saturday: closedDay(), sunday: closedDay(),
}

export default function WorkingHoursSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [templateId, setTemplateId] = useState<string | null>(null)
  const [template, setTemplate] = useState<WeekTemplate>(DEFAULT_TEMPLATE)
  const [overrides, setOverrides] = useState<Override[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrideToDelete, setOverrideToDelete] = useState<Override | null>(null)

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
      const next = {} as WeekTemplate
      for (const day of DAY_KEYS) {
        const stored = (days as Record<string, { open: boolean; ranges: TimeRange[] }>)[day]
        next[day] = rangesToSchedule(stored?.open ?? false, stored?.ranges ?? [])
      }
      setTemplate(next)
    }
    setOverrides((ovRes.data ?? []) as Override[])
    setLoading(false)
  }

  function setDayOpen(day: keyof WeekTemplate, open: boolean) {
    setTemplate(prev => ({ ...prev, [day]: { ...prev[day], open } }))
  }

  function setDayTime(day: keyof WeekTemplate, field: 'openTime' | 'closeTime', val: string) {
    setTemplate(prev => ({ ...prev, [day]: { ...prev[day], [field]: val } }))
  }

  // Adds an editable break, defaulting to a 1h slot inside the working window:
  // after the last break if one exists, otherwise centred on the day.
  function addBreak(day: keyof WeekTemplate) {
    setTemplate(prev => {
      const s = prev[day]
      const openM = timeToMinutes(s.openTime)
      const closeM = timeToMinutes(s.closeTime)
      const base = s.breaks.length
        ? timeToMinutes(s.breaks[s.breaks.length - 1].end) + 60
        : openM + Math.floor((closeM - openM) / 2) - 30
      let bs = Math.max(openM, Math.min(base, closeM - 60))
      let be = Math.min(bs + 60, closeM)
      if (be <= bs) { bs = Math.max(openM, closeM - 60); be = closeM }
      const newBreak: TimeRange = { start: minutesToTime(bs), end: minutesToTime(be) }
      return { ...prev, [day]: { ...s, breaks: [...s.breaks, newBreak] } }
    })
  }

  // Break times are clamped to the day's working window so they can never be
  // selected outside working hours.
  function setBreakField(day: keyof WeekTemplate, idx: number, field: 'start' | 'end', val: string) {
    setTemplate(prev => {
      const s = prev[day]
      const clamped = clampTime(val, s.openTime, s.closeTime)
      return {
        ...prev,
        [day]: {
          ...s,
          breaks: s.breaks.map((b, i) => i === idx ? { ...b, [field]: clamped } : b),
        },
      }
    })
  }

  function removeBreak(day: keyof WeekTemplate, idx: number) {
    setTemplate(prev => ({
      ...prev,
      [day]: { ...prev[day], breaks: prev[day].breaks.filter((_, i) => i !== idx) },
    }))
  }

  function validateTemplate(): string | null {
    for (const day of DAY_KEYS) {
      const s = template[day]
      if (!s.open) continue
      const issue = dayScheduleIssue(s.openTime, s.closeTime, s.breaks)
      if (issue) return t(`validation.${issue}`)
    }
    return null
  }

  async function handleSave() {
    if (!org) return

    const validationError = validateTemplate()
    if (validationError) { setError(validationError); return }

    setSaving(true)
    setError(null)

    const daysPayload: Record<string, { open: boolean; ranges: TimeRange[] }> = {}
    for (const day of DAY_KEYS) {
      const s = template[day]
      daysPayload[day] = {
        open: s.open,
        ranges: s.open ? scheduleToRanges(s.openTime, s.closeTime, s.breaks) : [],
      }
    }
    const payload = { ...daysPayload, org_id: org.id, updated_at: new Date().toISOString() }

    let err
    if (templateId) {
      ;({ error: err } = await supabase.from('working_hours_template').update(payload).eq('id', templateId))
    } else {
      ;({ error: err } = await supabase.from('working_hours_template').insert(payload))
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    toast.success(t('common.saved'))
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
    toast.success(t('common.deleted'))
  }

  if (loading) return <LoadingState />

  return (
    <Box sx={{ maxWidth: 680 }}>
      <PageHeader title={t('settings.workingHours')} />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Weekly template */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            ყოველკვირეული გრაფიკი
          </Typography>
          <Stack spacing={2}>
            {DAY_KEYS.map((day, di) => {
              const cfg = template[day]
              const windowValid = isEndAfterStart(cfg.openTime, cfg.closeTime)
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

                  {cfg.open && (
                    <Box sx={{ pl: { xs: 0, sm: '118px' }, mt: 1.5 }}>
                      {/* Working window */}
                      <Box
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1, mb: 1.5,
                          pl: 1, borderLeft: '3px solid', borderLeftColor: 'success.main',
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 92, color: 'success.dark' }}>
                          <WorkOutlineOutlinedIcon sx={{ fontSize: 16 }} />
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>სამუშაო</Typography>
                        </Box>
                        <TextField
                          type="time" size="small" value={cfg.openTime}
                          onChange={e => setDayTime(day, 'openTime', e.target.value)}
                          sx={{ width: 115 }}
                        />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>
                        <TextField
                          type="time" size="small" value={cfg.closeTime}
                          onChange={e => setDayTime(day, 'closeTime', e.target.value)}
                          error={!windowValid}
                          sx={{ width: 115 }}
                        />
                      </Box>

                      {/* Breaks — editable, constrained to the working window */}
                      {cfg.breaks.map((b, bi) => {
                        const breakInvalid = !isEndAfterStart(b.start, b.end)
                          || timeToMinutes(b.start) < timeToMinutes(cfg.openTime)
                          || timeToMinutes(b.end) > timeToMinutes(cfg.closeTime)
                        return (
                          <Box
                            key={bi}
                            sx={{
                              display: 'flex', alignItems: 'center', gap: 1, mb: 1,
                              pl: 1, borderLeft: '3px solid', borderLeftColor: 'grey.300',
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 92, color: 'text.secondary' }}>
                              <CoffeeOutlinedIcon sx={{ fontSize: 16 }} />
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>შესვენება</Typography>
                            </Box>
                            <TextField
                              type="time" size="small" value={b.start}
                              onChange={e => setBreakField(day, bi, 'start', e.target.value)}
                              error={breakInvalid}
                              slotProps={{ htmlInput: { min: cfg.openTime, max: cfg.closeTime } }}
                              sx={{ width: 115 }}
                            />
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>
                            <TextField
                              type="time" size="small" value={b.end}
                              onChange={e => setBreakField(day, bi, 'end', e.target.value)}
                              error={breakInvalid}
                              slotProps={{ htmlInput: { min: cfg.openTime, max: cfg.closeTime } }}
                              sx={{ width: 115 }}
                            />
                            <IconButton size="small" aria-label={t('common.delete')} onClick={() => removeBreak(day, bi)}>
                              <CloseIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Box>
                        )
                      })}

                      <Button
                        size="small"
                        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                        onClick={() => addBreak(day)}
                        sx={{ color: 'text.secondary', fontSize: 12 }}
                      >
                        შესვენების დამატება
                      </Button>
                    </Box>
                  )}
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
                <IconButton size="small" color="error" aria-label={t('common.delete')} onClick={() => setOverrideToDelete(ov)}>
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

      {/* Confirm override deletion */}
      <ConfirmDialog
        open={!!overrideToDelete}
        title={t('common.confirmDeleteTitle')}
        message={t('common.confirmDeleteMessage')}
        confirmLabel={t('common.delete')}
        onClose={() => setOverrideToDelete(null)}
        onConfirm={() => {
          if (overrideToDelete) deleteOverride(overrideToDelete.id)
          setOverrideToDelete(null)
        }}
      />
    </Box>
  )
}
