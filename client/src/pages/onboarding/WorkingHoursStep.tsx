import { useState } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import {
  Box, Button, Typography, Switch, FormControlLabel,
  TextField, Stack, Alert, CircularProgress,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
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
    setHours(h => ({ ...h, [day]: { ...h[day], open: !h[day].open } }))
  }

  function setTime(day: string, field: 'start' | 'end', value: string) {
    setHours(h => ({ ...h, [day]: { ...h[day], [field]: value } }))
  }

  async function handleFinish() {
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      // 1. Create organisation — if slug conflicts, append a short random suffix
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
        // Unique slug conflict — retry with suffix
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

      // 2. Add owner to org_members
      const { error: memberErr } = await supabase
        .from('org_members')
        .insert({ org_id: orgId, user_id: user.id, role: 'owner', joined_at: new Date().toISOString() })

      if (memberErr) throw new Error(memberErr.message)

      // 3. Create services
      if (data.services.length > 0) {
        const { error: svcErr } = await supabase
          .from('services')
          .insert(
            data.services.map((s, i) => ({
              org_id: orgId,
              name: s.name,
              duration_minutes: s.duration_minutes,
              price: s.price,
              sort_order: i,
            }))
          )
        if (svcErr) throw new Error(svcErr.message)
      }

      // 4. Create working hours template
      const templateRow: Record<string, unknown> = { org_id: orgId }
      for (const day of DAYS) {
        const h = hours[day]
        templateRow[day] = h.open
          ? { open: true, ranges: [{ start: h.start, end: h.end }] }
          : { open: false, ranges: [] }
      }

      const { error: hoursErr } = await supabase
        .from('working_hours_template')
        .insert(templateRow)

      if (hoursErr) throw new Error(hoursErr.message)

      // 5. Reload OrgContext and redirect to dashboard
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

      <Stack spacing={2} sx={{ mb: 4 }}>
        {DAYS.map(day => (
          <Box
            key={day}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 1.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: hours[day].open ? 'primary.main' : 'divider',
              bgcolor: hours[day].open ? 'secondary.main' : 'transparent',
            }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={hours[day].open}
                  onChange={() => toggleDay(day)}
                  color="primary"
                />
              }
              label={
                <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 90 }}>
                  {DAY_LABELS[day]}
                </Typography>
              }
              sx={{ mr: 0, flex: 1 }}
            />
            {hours[day].open && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  type="time"
                  value={hours[day].start}
                  onChange={e => setTime(day, 'start', e.target.value)}
                  sx={{ width: 110 }}
                />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>—</Typography>
                <TextField
                  size="small"
                  type="time"
                  value={hours[day].end}
                  onChange={e => setTime(day, 'end', e.target.value)}
                  sx={{ width: 110 }}
                />
              </Stack>
            )}
          </Box>
        ))}
      </Stack>

      <Stack direction="row" spacing={2}>
        <Button fullWidth variant="outlined" onClick={goBack} disabled={loading}>
          {t('common.back')}
        </Button>
        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={handleFinish}
          disabled={loading}
        >
          {loading
            ? <CircularProgress size={20} color="inherit" />
            : t('onboarding.finish')
          }
        </Button>
      </Stack>
    </Box>
  )
}
