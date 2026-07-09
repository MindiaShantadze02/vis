import { useEffect, useState } from 'react'
import {
  Box, Card, CardContent, Typography, Button, IconButton, Stack,
} from '@mui/material'
import {
  CheckCircleOutlined as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Close as CloseIcon,
} from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useToast } from '@/components/ui'

interface StepState {
  service: boolean
  hours: boolean
  staff: boolean
}

/**
 * New-org onboarding checklist (record §4.1). The first three steps are
 * derived from data (service / working hours / staff photo-or-profile); the
 * final step — put the booking link in your Instagram bio — is the real goal
 * and persists via organisations.link_share_done_at when the owner copies the
 * link. Dismissible once everything is done (checklist_dismissed_at).
 */
export default function OnboardingChecklist() {
  const { t } = useTranslation()
  const toast = useToast()
  const { org, refresh } = useOrg()
  const [steps, setSteps] = useState<StepState | null>(null)
  // Session-local fallback: the persisting writes are owner-only under RLS.
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!org || org.checklist_dismissed_at) return
    Promise.all([
      supabase.from('services').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      supabase.from('working_hours_template').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      supabase.from('org_members').select('id, avatar_url, role').eq('org_id', org.id),
    ]).then(([svc, hours, members]) => {
      const rows = (members.data ?? []) as { avatar_url: string | null; role: string }[]
      setSteps({
        service: (svc.count ?? 0) > 0,
        hours: (hours.count ?? 0) > 0,
        // A staff profile or any member photo both count — solo masters just
        // add their own photo.
        staff: rows.some(m => m.role === 'staff' || m.avatar_url != null),
      })
    })
  }, [org])

  if (!org || org.checklist_dismissed_at || hidden || !steps) return null

  const linkDone = org.link_share_done_at != null
  const items = [
    { key: 'addService', done: steps.service },
    { key: 'setHours', done: steps.hours },
    { key: 'addStaff', done: steps.staff },
    { key: 'shareLink', done: linkDone },
  ]
  const allDone = items.every(i => i.done)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://vis.ge/book/${org!.slug}`)
      toast.success(t('checklist.copied'))
    } catch {
      /* clipboard denied — the CopyableText below the checklist still works */
    }
    if (!org!.link_share_done_at) {
      const { error } = await supabase
        .from('organisations')
        .update({ link_share_done_at: new Date().toISOString() })
        .eq('id', org!.id)
      if (!error) await refresh()
    }
  }

  async function dismiss() {
    setHidden(true)
    const { error } = await supabase
      .from('organisations')
      .update({ checklist_dismissed_at: new Date().toISOString() })
      .eq('id', org!.id)
    if (!error) await refresh()
  }

  return (
    <Card sx={{ mb: 4, maxWidth: 480 }} data-testid="onboarding-checklist">
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {t('checklist.title')} · {items.filter(i => i.done).length}/{items.length}
          </Typography>
          {/* Dismissible once complete — before that the card is the guide. */}
          {allDone && (
            <IconButton size="small" onClick={dismiss} data-testid="checklist-dismiss" aria-label={t('checklist.dismiss')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
        <Stack spacing={1}>
          {items.map(item => (
            <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {item.done
                ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
                : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
              <Typography
                variant="body2"
                sx={{ flex: 1, color: item.done ? 'text.secondary' : 'text.primary' }}
              >
                {t(`checklist.${item.key}`)}
              </Typography>
              {item.key === 'shareLink' && !linkDone && (
                <Button size="small" variant="outlined" onClick={copyLink} data-testid="checklist-copy-link">
                  {t('checklist.copyLink')}
                </Button>
              )}
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}
