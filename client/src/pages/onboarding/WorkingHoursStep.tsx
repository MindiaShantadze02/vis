import { useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  Box, Button, Typography, Switch, FormControlLabel,
  TextField, Stack, Alert, CircularProgress, IconButton, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined'
import CoffeeOutlinedIcon from '@mui/icons-material/CoffeeOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import {
  isEndAfterStart, timeToMinutes, minutesToTime, clampTime,
  rangesToSchedule, scheduleToRanges, dayScheduleIssue,
  type TimeRange, type DaySchedule,
} from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { slugify } from '@/lib/slug'
import type { OnboardingData } from './OnboardingLayout'

interface OutletCtx {
  goBack: () => void
  data: OnboardingData
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
  const { goBack, data } = useOutletContext<OutletCtx>()
  const { user } = useAuth()
  const { refresh } = useOrg()
  const navigate = useNavigate()

  const [hours, setHours] = useState<Record<string, DaySchedule>>(() => {
    const init: Record<string, DaySchedule> = {}
    for (const day of DAYS) {
      const d = data.workingHours[day]
      init[day] = rangesToSchedule(d?.open ?? false, d?.ranges ?? [])
    }
    return init
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      // Guard against creating a duplicate org: if this user already belongs to
      // one, just go to the dashboard instead of inserting another.
      const { data: existing } = await supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()
      if (existing) {
        await refresh()
        navigate('/dashboard')
        return
      }

      const suffix = Math.random().toString(36).slice(2, 6)
      // Prefer the slug derived during the profile step; re-derive from the
      // name as a fallback (both now transliterate Georgian → Latin).
      const slug = data.slug || slugify(data.name) || `org-${suffix}`

      let orgId: string
      let attempt = await supabase
        .from('organisations')
        .insert({
          name: data.name,
          description: data.description || null,
          slug,
          contact_phone: data.contact_phone || null,
          owner_id: user.id,
          subscription_tier: 'free',
        })
        .select('id')
        .single()

      if (attempt.error?.code === '23505') {
        attempt = await supabase
          .from('organisations')
          .insert({
            name: data.name,
            description: data.description || null,
            slug: `${slug}-${suffix}`,
            contact_phone: data.contact_phone || null,
            owner_id: user.id,
            subscription_tier: 'free',
          })
          .select('id')
          .single()
      }

      if (attempt.error) throw new Error(attempt.error.message)
      orgId = attempt.data!.id

      const { error: memberErr } = await supabase
        .from('org_members')
        .insert({ org_id: orgId, user_id: user.id, role: 'owner', joined_at: new Date().toISOString() })
      if (memberErr) throw new Error(memberErr.message)

      if (data.services.length > 0) {
        const { error: svcErr } = await supabase
          .from('services')
          .insert(data.services.map((s, i) => ({
            org_id: orgId, name: s.name, duration_minutes: s.duration_minutes, price: s.price, sort_order: i,
          })))
        if (svcErr) throw new Error(svcErr.message)
      }

      const templateRow: Record<string, unknown> = { org_id: orgId }
      for (const day of DAYS) {
        const s = hours[day]
        templateRow[day] = {
          open: s.open,
          ranges: s.open ? scheduleToRanges(s.openTime, s.closeTime, s.breaks) : [],
        }
      }

      const { error: hoursErr } = await supabase.from('working_hours_template').insert(templateRow)
      if (hoursErr) throw new Error(hoursErr.message)

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

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

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
                borderColor: cfg.open ? 'primary.main' : 'divider',
                bgcolor: cfg.open ? 'secondary.main' : 'transparent',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <FormControlLabel
                  control={<Switch checked={cfg.open} onChange={() => toggleDay(day)} color="primary" />}
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
                    />
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                    <TextField
                      size="small" type="time" value={cfg.closeTime}
                      onChange={e => setDayTime(day, 'closeTime', e.target.value)}
                      error={!windowValid}
                      sx={{ width: 110 }}
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
                          slotProps={{ htmlInput: { min: cfg.openTime, max: cfg.closeTime } }}
                          sx={{ width: 110 }}
                        />
                        <Tooltip title="ამოშლა">
                          <IconButton size="small" aria-label="ამოშლა" onClick={() => removeBreak(day, bi)}>
                            <CloseIcon sx={{ fontSize: 16 }} />
                          </IconButton>
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
        <Button fullWidth variant="outlined" onClick={goBack} disabled={loading}>
          {t('common.back')}
        </Button>
        <Button fullWidth variant="contained" size="large" onClick={handleFinish} disabled={loading}>
          {loading ? <CircularProgress size={20} color="inherit" /> : t('onboarding.finish')}
        </Button>
      </Stack>
    </Box>
  )
}
