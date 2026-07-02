import { useEffect, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  Box, Button, Typography, Switch, FormControlLabel,
  TextField, Stack, Alert, CircularProgress, Tooltip,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { Close as CloseIcon } from '@/components/icons'
import { WorkOutlineOutlined as WorkOutlineOutlinedIcon } from '@/components/icons'
import { CoffeeOutlined as CoffeeOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import {
  isEndAfterStart, timeToMinutes, minutesToTime, clampTime,
  dayScheduleIssue,
  type TimeRange, type DaySchedule,
} from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { ActionIconButton } from '@/components/ui'
import { persistOnboarding } from '@/lib/onboarding'
import { surface } from '@/theme/theme'
import type { OnboardingData } from './OnboardingLayout'

interface OutletCtx {
  goBack: () => void
  data: OnboardingData
  update: (patch: Partial<OnboardingData>) => void
}

const DAY_LABELS: Record<string, string> = {
  monday:    'ორშაბათი',
  tuesday:   'სამშაბათი',
  wednesday: 'ოთხშაბათი',
  thursday:  'ხუთშაბათი',
  friday:    'პარასკევი',
  saturday:  'შაბათი',
  sunday:    'კვირა',
}

const DAYS = Object.keys(DAY_LABELS)

export default function WorkingHoursStep() {
  const { t } = useTranslation()
  const { goBack, data, update } = useOutletContext<OutletCtx>()
  const { user } = useAuth()
  const { refresh } = useOrg()
  const navigate = useNavigate()

  const [hours, setHours] = useState<Record<string, DaySchedule>>(() => {
    const init: Record<string, DaySchedule> = {}
    for (const day of DAYS) {
      init[day] = data.workingHours[day] ?? { open: false, openTime: '09:00', closeTime: '18:00', breaks: [] }
    }
    return init
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persist edits up to the shared onboarding state so they survive navigating
  // back to an earlier step and returning (this step remounts on step change).
  useEffect(() => {
    update({ workingHours: hours })
  }, [hours])

  function toggleDay(day: string) {
    setHours(h => ({ ...h, [day]: { ...h[day], open: !h[day].open } }))
  }

  function setDayTime(day: string, field: 'openTime' | 'closeTime', value: string) {
    setHours(h => ({ ...h, [day]: { ...h[day], [field]: value } }))
  }

  // Adds an editable break, defaulting to a 1h slot inside the working window:
  // after the last break if one exists, otherwise centred on the day.
  function addBreak(day: string) {
    setHours(h => {
      const s = h[day]
      const openM = timeToMinutes(s.openTime)
      const closeM = timeToMinutes(s.closeTime)
      const base = s.breaks.length
        ? timeToMinutes(s.breaks[s.breaks.length - 1].end) + 60
        : openM + Math.floor((closeM - openM) / 2) - 30
      let bs = Math.max(openM, Math.min(base, closeM - 60))
      let be = Math.min(bs + 60, closeM)
      if (be <= bs) { bs = Math.max(openM, closeM - 60); be = closeM }
      const newBreak: TimeRange = { start: minutesToTime(bs), end: minutesToTime(be) }
      return { ...h, [day]: { ...s, breaks: [...s.breaks, newBreak] } }
    })
  }

  // Break times are clamped to the day's working window so they can never be
  // selected outside working hours.
  function setBreakField(day: string, idx: number, field: 'start' | 'end', value: string) {
    setHours(h => {
      const s = h[day]
      const clamped = clampTime(value, s.openTime, s.closeTime)
      return {
        ...h,
        [day]: {
          ...s,
          breaks: s.breaks.map((b, i) => i === idx ? { ...b, [field]: clamped } : b),
        },
      }
    })
  }

  function removeBreak(day: string, idx: number) {
    setHours(h => ({
      ...h,
      [day]: { ...h[day], breaks: h[day].breaks.filter((_, i) => i !== idx) },
    }))
  }

  function validateHours(): string | null {
    for (const day of DAYS) {
      const s = hours[day]
      if (!s.open) continue
      const issue = dayScheduleIssue(s.openTime, s.closeTime, s.breaks)
      if (issue) return t(`validation.${issue}`)
    }
    return null
  }

  async function handleFinish() {
    if (!user) return

    const validationError = validateHours()
    if (validationError) { setError(validationError); return }

    setLoading(true)
    setError(null)

    try {
      // Persist edits to shared state so persistOnboarding sees the latest hours
      // even if the effect hasn't flushed yet.
      await persistOnboarding({ ...data, workingHours: hours }, user.id)
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
        {t('onboarding.step3')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4 }}>
        {t('onboarding.workingHours')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="hours-error">{error}</Alert>}

      <Stack spacing={1.5} sx={{ mb: 4 }}>
        {DAYS.map(day => {
          const cfg = hours[day]
          const windowValid = isEndAfterStart(cfg.openTime, cfg.closeTime)
          return (
            <Box
              key={day}
              sx={{
                p: 1.5,
                borderRadius: 2,
                border: '1px solid',
                // Calm, neutral rows (matches the dashboard Working Hours settings):
                // no citrus border/fill flooding every open day — the accent lives
                // only on the toggle and the green working-window rail.
                borderColor: 'divider',
                bgcolor: cfg.open ? surface.subtle : 'transparent',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <FormControlLabel
                  control={<Switch checked={cfg.open} onChange={() => toggleDay(day)} color="primary" data-testid={`hours-toggle-${day}`} />}
                  label={
                    <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 90 }}>
                      {DAY_LABELS[day]}
                    </Typography>
                  }
                  sx={{ mr: 0, flex: 1 }}
                />
                {!cfg.open && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('onboarding.closed')}
                  </Typography>
                )}
              </Box>

              {cfg.open && (
                <Box sx={{ mt: 1.5, pl: 1 }}>
                  {/* Working window */}
                  <Box
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1, mb: 1.5,
                      pl: 1, borderLeft: '3px solid', borderLeftColor: 'success.main',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 88, color: 'success.dark' }}>
                      <WorkOutlineOutlinedIcon sx={{ fontSize: 16 }} />
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>სამუშაო</Typography>
                    </Box>
                    <TextField
                      size="small" type="time" value={cfg.openTime}
                      onChange={e => setDayTime(day, 'openTime', e.target.value)}
                      sx={{ width: 110 }}
                      slotProps={{ htmlInput: { 'data-testid': `hours-${day}-open` } }}
                    />
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                    <TextField
                      size="small" type="time" value={cfg.closeTime}
                      onChange={e => setDayTime(day, 'closeTime', e.target.value)}
                      error={!windowValid}
                      helperText={!windowValid ? t('validation.endBeforeStart') : undefined}
                      sx={{ width: 110 }}
                      slotProps={{ htmlInput: { 'data-testid': `hours-${day}-close` } }}
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
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 88, color: 'text.secondary' }}>
                          <CoffeeOutlinedIcon sx={{ fontSize: 16 }} />
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>შესვენება</Typography>
                        </Box>
                        <TextField
                          size="small" type="time" value={b.start}
                          onChange={e => setBreakField(day, bi, 'start', e.target.value)}
                          error={breakInvalid}
                          slotProps={{ htmlInput: { min: cfg.openTime, max: cfg.closeTime } }}
                          sx={{ width: 110 }}
                        />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                        <TextField
                          size="small" type="time" value={b.end}
                          onChange={e => setBreakField(day, bi, 'end', e.target.value)}
                          error={breakInvalid}
                          helperText={breakInvalid ? t(`validation.${breakIssue}`) : undefined}
                          slotProps={{ htmlInput: { min: cfg.openTime, max: cfg.closeTime } }}
                          sx={{ width: 110 }}
                        />
                        <Tooltip title="ამოშლა">
                          <ActionIconButton tone="danger" compact aria-label="ამოშლა" onClick={() => removeBreak(day, bi)}>
                            <CloseIcon sx={{ fontSize: 16 }} />
                          </ActionIconButton>
                        </Tooltip>
                      </Box>
                    )
                  })}

                  <Button
                    size="small"
                    startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                    onClick={() => addBreak(day)}
                    sx={{ color: 'text.secondary', fontSize: 12, mt: 0.25 }}
                  >
                    შესვენების დამატება
                  </Button>
                </Box>
              )}
            </Box>
          )
        })}
      </Stack>

      <Stack direction="row" spacing={2}>
        <Button fullWidth variant="outlined" onClick={goBack} disabled={loading} data-testid="hours-back">
          {t('common.back')}
        </Button>
        <Button fullWidth variant="contained" size="large" onClick={handleFinish} disabled={loading} data-testid="hours-finish">
          {loading ? <CircularProgress size={20} color="inherit" /> : t('onboarding.finish')}
        </Button>
      </Stack>
    </Box>
  )
}
