import { useCallback, useEffect, useState } from 'react'
import {
  Box, Card, Typography, Chip, Divider, Button, CircularProgress,
} from '@mui/material'
import { EventBusyOutlined as EventBusyOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { dateLocale } from '@/lib/dateLocale'
import { PageHeader, LoadingState, EmptyState, useToast } from '@/components/ui'

interface WaitlistRow {
  id: string
  desired_date: string
  first_name: string
  last_name: string | null
  phone: string
  status: 'active' | 'offered' | 'converted' | 'expired' | 'cancelled'
  created_at: string
  service: { name: string } | { name: string }[] | null
}

const STATUS_COLOR: Record<WaitlistRow['status'], 'default' | 'warning' | 'success' | 'info'> = {
  active: 'info', offered: 'warning', converted: 'success', expired: 'default', cancelled: 'default',
}

/**
 * Owner waitlist view — the customers waiting for a freed slot, grouped by
 * status. "Check for openings" runs the matcher for this org on demand (the
 * cron does it every few minutes anyway).
 */
export default function WaitlistPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()
  const [rows, setRows] = useState<WaitlistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dispatching, setDispatching] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const { data } = await supabase
      .from('waitlist_entries')
      .select('id, desired_date, first_name, last_name, phone, status, created_at, service:services(name)')
      .eq('org_id', org.id)
      .order('desired_date')
    setRows((data ?? []) as WaitlistRow[])
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])

  async function checkOpenings() {
    if (!org) return
    setDispatching(true)
    const { data, error } = await supabase.rpc('dispatch_waitlist_offers', { p_org_id: org.id })
    setDispatching(false)
    if (error) { toast.error(t('validation.saveFailed')); return }
    toast.success(t('waitlist.dispatched', { count: (data as number) ?? 0 }))
    load()
  }

  const svcName = (r: WaitlistRow) => (Array.isArray(r.service) ? r.service[0]?.name : r.service?.name) ?? ''

  return (
    <Box>
      <PageHeader
        title={t('waitlist.ownerTitle')}
        action={
          <Button variant="contained" onClick={checkOpenings} disabled={dispatching || !rows.some(r => r.status === 'active')}>
            {dispatching ? <CircularProgress size={20} color="inherit" /> : t('waitlist.checkOpenings')}
          </Button>
        }
      />

      <Card>
        {loading
          ? <LoadingState />
          : rows.length === 0
          ? <EmptyState icon={<EventBusyOutlinedIcon />} title={t('waitlist.ownerEmpty')} caption={t('waitlist.ownerEmptyCaption')} />
          : rows.map((r, i) => (
            <Box key={r.id}>
              {i > 0 && <Divider />}
              <Box data-testid="waitlist-row" sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {r.first_name}{r.last_name ? ` ${r.last_name}` : ''} · {r.phone}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {svcName(r)} · {format(new Date(`${r.desired_date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale() })}
                  </Typography>
                </Box>
                <Chip label={t(`waitlist.status.${r.status}`)} size="small" color={STATUS_COLOR[r.status]} variant="outlined" />
              </Box>
            </Box>
          ))
        }
      </Card>
    </Box>
  )
}
