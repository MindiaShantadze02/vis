import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, TextField,
  Switch, Stack, Divider, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Chip,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { Close as CloseIcon } from '@/components/icons'
import { WorkOutlineOutlined as WorkOutlineOutlinedIcon } from '@/components/icons'
import { CoffeeOutlined as CoffeeOutlinedIcon } from '@/components/icons'
import { format, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import {
  isEndAfterStart, timeToMinutes, minutesToTime, clampTime,
  rangesToSchedule, scheduleToRanges, dayScheduleIssue, FIELD_LIMITS,
  type TimeRange, type DaySchedule,
} from '@/lib/validation'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, LoadingState, ConfirmDialog, ActionIconButton, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'
import { dateLocale } from '@/lib/dateLocale'

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
  // Max days in advance a customer may book. Empty string = no limit.
  const [maxAdvanceDays, setMaxAdvanceDays] = useState<string>('')
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
      setMaxAdvanceDays(tplRes.data.max_advance_days != null ? String(tplRes.data.max_advance_days) : '')
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

    // Advance-booking window: blank = no limit, otherwise a positive whole
    // number (capped at 730 — two years is well beyond any real use).
    const trimmedMax = maxAdvanceDays.trim()
    let maxAdvance: number | null = null
    if (trimmedMax !== '') {
      maxAdvance = Number(trimmedMax)
      if (!Number.isInteger(maxAdvance) || maxAdvance < 1 || maxAdvance > 730) {
        setError(t('settings.maxAdvanceDaysInvalid'))
        return
      }
    }

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
    const payload = { ...daysPayload, max_advance_days: maxAdvance, org_id: org.id, updated_at: new Date().toISOString() }

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
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader title={t('settings.workingHours')} />

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="wh-error">{error}</Alert>}

      {/* Weekly template */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            {t('settings.weeklySchedule')}
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
                      {t(`days.${day}`)}
                    </Typography>
                    <Switch
                      checked={cfg.open}
                      onChange={e => setDayOpen(day, e.target.checked)}
                      data-testid={`wh-toggle-${day}`}
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
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('settings.working')}</Typography>
                        </Box>
                        <TextField
                          type="time" size="small" value={cfg.openTime}
                          onChange={e => setDayTime(day, 'openTime', e.target.value)}
                          sx={{ width: 115 }}
                          slotProps={{ htmlInput: { 'data-testid': `wh-${day}-open` } }}
                        />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>
                        <TextField
                          type="time" size="small" value={cfg.closeTime}
                          onChange={e => setDayTime(day, 'closeTime', e.target.value)}
                          error={!windowValid}
                          helperText={!windowValid ? t('validation.endBeforeStart') : undefined}
                          sx={{ width: 115 }}
                          slotProps={{ htmlInput: { 'data-testid': `wh-${day}-close` } }}
                        />
                      </Box>

                      {/* Breaks — editable, constrained to the working window */}
                      {cfg.breaks.map((b, bi) => {
                        const breakEndsBeforeStart = !isEndAfterStart(b.start, b.end)
                        const breakOutsideHours =
                          timeToMinutes(b.start) < timeToMinutes(cfg.openTime)
                          || timeToMinutes(b.end) > timeToMinutes(cfg.closeTime)
                        const breakInvalid = breakEndsBeforeStart || breakOutsideHours
                        const breakIssue = breakEndsBeforeStart ? 'endBeforeStart' : 'breakOutsideHours'
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
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>{t('settings.break')}</Typography>
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
                              helperText={breakInvalid ? t(`validation.${breakIssue}`) : undefined}
                              slotProps={{ htmlInput: { min: cfg.openTime, max: cfg.closeTime } }}
                              sx={{ width: 115 }}
                            />
                            <ActionIconButton tone="danger" compact aria-label={t('common.delete')} onClick={() => removeBreak(day, bi)}>
                              <CloseIcon sx={{ fontSize: 16 }} />
                            </ActionIconButton>
                          </Box>
                        )
                      })}

                      <Button
                        size="small"
                        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                        onClick={() => addBreak(day)}
                        sx={{ color: 'text.secondary', fontSize: 12 }}
                      >
                        {t('settings.addBreak')}
                      </Button>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Stack>

          <Divider sx={{ my: 3 }} />

          {/* Advance-booking window */}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('settings.maxAdvanceDays')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('settings.maxAdvanceDaysHelp')}
          </Typography>
          <TextField
            type="number"
            size="small"
            value={maxAdvanceDays}
            onChange={e => setMaxAdvanceDays(e.target.value)}
            placeholder={t('settings.noLimit')}
            slotProps={{ htmlInput: { min: 1, max: 730, 'data-testid': 'wh-max-advance' } }}
            sx={{ width: 200 }}
          />

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="wh-save">
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
              {t('settings.overrides')}
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setOverrideOpen(true)} data-testid="wh-override-add">
              {t('common.add')}
            </Button>
          </Box>

          {overrides.length === 0
            ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('settings.noOverrides')}
              </Typography>
            )
            : overrides.map(ov => (
              <Box
                key={ov.id}
                data-testid="wh-override-row"
                sx={{
                  display: 'flex', alignItems: 'center', gap: 2,
                  py: 1.5, borderBottom: '1px solid', borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {format(parseISO(ov.date), 'dd MMM yyyy', { locale: dateLocale() })}
                  </Typography>
                  {ov.note && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{ov.note}</Typography>
                  )}
                </Box>
                <Chip
                  label={ov.is_closed ? t('settings.closedLabel') : t('settings.specialHours')}
                  size="small"
                  color={ov.is_closed ? 'error' : 'info'}
                  variant="outlined"
                />
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="wh-override-delete" onClick={() => setOverrideToDelete(ov)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            ))
          }
        </CardContent>
      </Card>

      {/* Add override dialog */}
      <Dialog open={overrideOpen} onClose={() => setOverrideOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.addOverride')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('common.date')}
              type="date"
              value={ovDate}
              onChange={e => setOvDate(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: format(new Date(), 'yyyy-MM-dd'), 'data-testid': 'wh-ov-date' } }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Switch checked={ovClosed} onChange={e => setOvClosed(e.target.checked)} />
              <Typography variant="body2">
                {ovClosed ? t('settings.overrideClosed') : t('settings.overrideOpen')}
              </Typography>
            </Box>
            <TextField
              label={t('settings.noteOptional')}
              value={ovNote}
              onChange={e => setOvNote(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.note } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOverrideOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={addOverride}
            disabled={ovSaving || !ovDate}
            data-testid="wh-ov-save"
          >
            {ovSaving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
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
