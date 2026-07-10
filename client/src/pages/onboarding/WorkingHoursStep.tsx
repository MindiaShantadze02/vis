import { useEffect, useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  Box, Button, Typography, Switch, FormControlLabel,
  TextField, Stack, Alert, CircularProgress, Tooltip, Card, Divider,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { Close as CloseIcon } from '@/components/icons'
import { ContentCopyOutlined as ContentCopyOutlinedIcon } from '@/components/icons'
import { WorkOutlineOutlined as WorkOutlineOutlinedIcon } from '@/components/icons'
import { CoffeeOutlined as CoffeeOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import {
  isEndAfterStart, timeToMinutes, minutesToTime, clampTime,
  dayScheduleIssue, scheduleToRanges, formatGeorgianPhone,
  type TimeRange, type DaySchedule,
} from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { ActionIconButton } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { slugify } from '@/lib/slug'
import { uploadServiceImage } from '@/lib/serviceImages'
import StepHeader from './StepHeader'
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

  // Copy this day's window + breaks to every other *open* day — hours are
  // usually uniform, so one edit shouldn't have to be repeated five times.
  function applyToAllOpenDays(source: string) {
    setHours(h => {
      const src = h[source]
      const next = { ...h }
      for (const d of DAYS) {
        if (d !== source && next[d].open) {
          next[d] = { ...next[d], openTime: src.openTime, closeTime: src.closeTime, breaks: src.breaks.map(b => ({ ...b })) }
        }
      }
      return next
    })
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
      // Prefer the slug derived during the profile step; re-derive from the name
      // as a fallback (both transliterate Georgian → Latin).
      const slug = data.slug || slugify(data.name) || `org-${suffix}`
      const orgRow = {
        name: data.name,
        description: data.description || null,
        slug,
        contact_phone: data.contact_phone.trim() ? formatGeorgianPhone(data.contact_phone) : null,
        owner_id: user.id,
        // Tier and trial_ends_at come from the column defaults: every new org
        // starts a 30-day Starter-level trial (no free tier since 072).
      }

      let attempt = await supabase.from('organisations').insert(orgRow).select('id').single()
      // Slug collision — retry once with a random suffix.
      if (attempt.error?.code === '23505') {
        attempt = await supabase
          .from('organisations')
          .insert({ ...orgRow, slug: `${slug}-${suffix}` })
          .select('id')
          .single()
      }
      if (attempt.error) throw new Error(attempt.error.message)
      const orgId = attempt.data!.id

      const { error: memberErr } = await supabase
        .from('org_members')
        .insert({ org_id: orgId, user_id: user.id, role: 'owner', joined_at: new Date().toISOString() })
      if (memberErr) throw new Error(memberErr.message)

      if (data.services.length > 0) {
        // RETURNING preserves insert order, so created[i] pairs with services[i]
        // — used to attach each service's staged gallery images below.
        const { data: createdSvcs, error: svcErr } = await supabase.from('services').insert(
          data.services.map((s, i) => ({
            org_id: orgId, name: s.name, duration_minutes: s.duration_minutes, price: s.price, sort_order: i,
            location_type: s.location_type, meeting_link: s.meeting_link,
          })),
        ).select('id')
        if (svcErr) throw new Error(svcErr.message)

        // Service gallery images — uploaded after the insert (the storage path
        // needs each service's id). Best-effort: a failed image upload shouldn't
        // block finishing; images can be re-added in Services settings.
        await Promise.all((createdSvcs ?? []).flatMap((row, i) =>
          (data.services[i]?.imageFiles ?? []).map(async (file, j) => {
            const url = await uploadServiceImage(orgId, row.id, file)
            if (url) await supabase.from('service_images').insert({ org_id: orgId, service_id: row.id, url, sort_order: j })
          }),
        ))
      }

      // Specialists (account-less staff profiles). Photos are uploaded after the
      // insert — the storage path is keyed by the member row's id. RETURNING
      // preserves insert order, so created[i] pairs with specialists[i].
      if (data.specialists.length > 0) {
        const { data: created, error: staffErr } = await supabase
          .from('org_members')
          .insert(data.specialists.map((sp, i) => ({
            org_id: orgId, user_id: null, role: 'staff', is_bookable: sp.is_bookable,
            display_name: sp.name, title: sp.title || null, sort_order: i,
          })))
          .select('id')
        if (staffErr) throw new Error(staffErr.message)
        // Best-effort: a failed photo upload shouldn't block finishing — the
        // photo can be re-added any time in Team settings.
        await Promise.all((created ?? []).map(async (row, i) => {
          const file = data.specialists[i]?.photoFile
          if (!file) return
          const ext = file.name.split('.').pop()
          const path = `${orgId}/${row.id}.${ext}`
          const { error: upErr } = await supabase.storage.from('member-photos').upload(path, file, { upsert: true })
          if (upErr) return
          const { data: pub } = supabase.storage.from('member-photos').getPublicUrl(path)
          await supabase.from('org_members').update({ avatar_url: `${pub.publicUrl}?v=${Date.now()}` }).eq('id', row.id)
        }))
      }

      // Logo — staged on step 1; best-effort for the same reason as photos.
      if (data.logoFile) {
        const ext = data.logoFile.name.split('.').pop()
        const path = `${orgId}/logo.${ext}`
        const { error: logoErr } = await supabase.storage.from('logos').upload(path, data.logoFile, { upsert: true })
        if (!logoErr) {
          const { data: pub } = supabase.storage.from('logos').getPublicUrl(path)
          await supabase.from('organisations').update({ logo_url: `${pub.publicUrl}?v=${Date.now()}` }).eq('id', orgId)
        }
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
      <StepHeader
        icon={<WorkOutlineOutlinedIcon />}
        title={t('onboarding.step3')}
        subtitle={t('onboarding.step3Subtitle')}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="hours-error">{error}</Alert>}

      {/* One calm container with the days separated by dividers (matches the
          dashboard Working Hours settings) rather than a stack of bordered
          cards. The accent lives only on the toggle + the green working rail. */}
      <Card variant="outlined" sx={{ borderRadius: 3, mb: 4, overflow: 'hidden' }}>
        {DAYS.map((day, di) => {
          const cfg = hours[day]
          const windowValid = isEndAfterStart(cfg.openTime, cfg.closeTime)
          return (
            <Box key={day}>
              {di > 0 && <Divider />}
              <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <FormControlLabel
                  control={<Switch checked={cfg.open} onChange={() => toggleDay(day)} color="primary" data-testid={`hours-toggle-${day}`} />}
                  label={
                    <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 90 }}>
                      {DAY_LABELS[day]}
                    </Typography>
                  }
                  // Kill the label's default -11px left margin so the row
                  // respects the card padding instead of hugging the border.
                  sx={{ ml: 0, mr: 0 }}
                />
                {!cfg.open && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('onboarding.closed')}
                  </Typography>
                )}
              </Box>

              {cfg.open && (
                <Box sx={{ mt: 1.5, pl: 1.5 }}>
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
                  <Button
                    size="small"
                    startIcon={<ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />}
                    onClick={() => applyToAllOpenDays(day)}
                    sx={{ color: 'text.secondary', fontSize: 12, mt: 0.25, ml: 1 }}
                    data-testid={`hours-apply-all-${day}`}
                  >
                    {t('onboarding.applyToAllDays')}
                  </Button>
                </Box>
              )}
              </Box>
            </Box>
          )
        })}
      </Card>

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
