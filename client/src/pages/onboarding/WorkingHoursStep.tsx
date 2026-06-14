import { useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  Box, Button, Typography, Switch, FormControlLabel,
  TextField, Stack, Alert, CircularProgress, IconButton, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isEndAfterStart, hasOverlap } from '@/lib/validation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
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

  const [hours, setHours] = useState(data.workingHours)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleDay(day: string) {
    setHours(h => ({
      ...h,
      [day]: {
        open: !h[day].open,
        ranges: !h[day].open && h[day].ranges.length === 0
          ? [{ start: '09:00', end: '18:00' }]
          : h[day].ranges,
      },
    }))
  }

  function setRangeField(day: string, idx: number, field: 'start' | 'end', value: string) {
    setHours(h => ({
      ...h,
      [day]: {
        ...h[day],
        ranges: h[day].ranges.map((r, i) => i === idx ? { ...r, [field]: value } : r),
      },
    }))
  }

  function addRange(day: string) {
    setHours(h => {
      const ranges = h[day].ranges
      const lastEnd = ranges.at(-1)?.end ?? '09:00'
      const [hr, m] = lastEnd.split(':').map(Number)
      const newEnd = `${String(Math.min(hr + 4, 22)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      return {
        ...h,
        [day]: { ...h[day], ranges: [...ranges, { start: lastEnd, end: newEnd }] },
      }
    })
  }

  function removeRange(day: string, idx: number) {
    setHours(h => ({
      ...h,
      [day]: { ...h[day], ranges: h[day].ranges.filter((_, i) => i !== idx) },
    }))
  }

  function validateHours(): string | null {
    for (const day of DAYS) {
      const h = hours[day]
      if (!h.open) continue
      for (const r of h.ranges) {
        if (!isEndAfterStart(r.start, r.end)) return t('validation.endBeforeStart')
      }
      if (hasOverlap(h.ranges)) return t('validation.rangeOverlap')
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
      const baseSlug = data.slug || data.name.toLowerCase().replace(/\s+/g, '-').slice(0, 50)
      const suffix = Math.random().toString(36).slice(2, 6)
      const slug = baseSlug || `org-${suffix}`

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
        const h = hours[day]
        templateRow[day] = { open: h.open, ranges: h.open ? h.ranges : [] }
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
        {DAYS.map(day => (
          <Box
            key={day}
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: hours[day].open ? 'primary.main' : 'divider',
              bgcolor: hours[day].open ? 'secondary.main' : 'transparent',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FormControlLabel
                control={<Switch checked={hours[day].open} onChange={() => toggleDay(day)} color="primary" />}
                label={
                  <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 90 }}>
                    {DAY_LABELS[day]}
                  </Typography>
                }
                sx={{ mr: 0, flex: 1 }}
              />
              {!hours[day].open && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('onboarding.closed')}
                </Typography>
              )}
            </Box>

            {hours[day].open && (
              <Box sx={{ mt: 1.5, pl: 1 }}>
                {hours[day].ranges.map((r, ri) => (
                  <Box key={ri} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <TextField
                      size="small" type="time"
                      value={r.start}
                      onChange={e => setRangeField(day, ri, 'start', e.target.value)}
                      sx={{ width: 110 }}
                    />
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                    <TextField
                      size="small" type="time"
                      value={r.end}
                      onChange={e => setRangeField(day, ri, 'end', e.target.value)}
                      error={!isEndAfterStart(r.start, r.end)}
                      sx={{ width: 110 }}
                    />
                    {hours[day].ranges.length > 1 && (
                      <Tooltip title="ამოშლა">
                        <IconButton size="small" onClick={() => removeRange(day, ri)}>
                          <CloseIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                ))}
                <Button
                  size="small"
                  startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                  onClick={() => addRange(day)}
                  sx={{ color: 'text.secondary', fontSize: 12, mt: 0.25 }}
                >
                  შესვენება
                </Button>
              </Box>
            )}
          </Box>
        ))}
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
