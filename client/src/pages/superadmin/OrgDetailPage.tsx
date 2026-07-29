import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Card, CardContent, Typography, Button, Chip, Divider, Stack,
  Select, MenuItem, FormControl, InputLabel,
} from '@mui/material'
import { ArrowBackIosNew as ArrowBackIosNewIcon } from '@/components/icons'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { PageHeader, LoadingState, ConfirmDialog, EmptyState, useToast } from '@/components/ui'
import { parseBillingStatus, type BillingStatus, type BillingState } from '@/lib/billing'
import OrgSetupPanel from './OrgSetupPanel'

interface Org {
  id: string
  name: string
  slug: string
  billing_status: BillingState
  created_at: string
  contact_phone: string | null
}

// Billing status → Georgian label + chip colour.
const STATUS_LABELS: Record<BillingState, { label: string; color: 'warning' | 'success' | 'error' }> = {
  active: { label: 'აქტიური', color: 'success' },
  past_due: { label: 'ვადაგადაცილებული', color: 'warning' },
  suspended: { label: 'შეჩერებული', color: 'error' },
}
const STATUS_KEYS: BillingState[] = ['active', 'past_due', 'suspended']

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [org, setOrg] = useState<Org | null>(null)
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingStatus, setPendingStatus] = useState<BillingState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    const [orgRes, billingRes] = await Promise.all([
      supabase.from('organisations').select('id, name, slug, billing_status, created_at, contact_phone').eq('id', id).maybeSingle(),
      supabase.rpc('get_org_billing_status', { p_org_id: id }),
    ])
    setOrg((orgRes.data ?? null) as Org | null)
    setBilling(parseBillingStatus(billingRes.data))
    setLoading(false)
  }

  async function changeBillingStatus() {
    if (!org || !pendingStatus) return
    setSaving(true)
    // Superadmin override (the guard permits is_superadmin). Charge/dunning
    // normally drives this; here it's a manual reset (e.g. lift a suspension).
    const { error } = await supabase
      .from('organisations')
      .update({ billing_status: pendingStatus })
      .eq('id', org.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('სტატუსი შეიცვალა')
    setPendingStatus(null)
    load()
  }

  if (loading) return <LoadingState />
  if (!org) {
    return (
      <Box>
        <PageHeader title="ორგანიზაცია" />
        <EmptyState title="ორგანიზაცია ვერ მოიძებნა" />
      </Box>
    )
  }

  const s = STATUS_LABELS[org.billing_status] ?? STATUS_LABELS.active

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Button
        startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
        onClick={() => navigate('/superadmin/orgs')}
        size="small"
        sx={{ mb: 2, color: 'text.secondary' }}
      >
        ორგანიზაციები
      </Button>

      <PageHeader title={org.name} subtitle={`/${org.slug}`} />

      {/* Info + running bill */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={1.5}>
            <Row label="სტატუსი" value={
              <Chip label={s.label} size="small" color={s.color} sx={{ fontWeight: 700 }} />
            } />
            <Row label="ჯავშნები ამ პერიოდში" value={
              <Typography variant="body2">{billing?.appointmentCount ?? 0} · ₾{billing?.runningAmount ?? 0}</Typography>
            } />
            {(billing?.rolledForward ?? 0) > 0 && (
              <Row label="გადმოტანილი ნაშთი" value={
                <Typography variant="body2">₾{billing?.rolledForward}</Typography>
              } />
            )}
            {billing?.periodEnd && (
              <Row label="პერიოდი ახლდება" value={
                <Typography variant="body2">{new Date(billing.periodEnd).toLocaleDateString('ka-GE')}</Typography>
              } />
            )}
            <Row label="რეგისტრაცია" value={
              <Typography variant="body2">{format(new Date(org.created_at), 'dd MMM yyyy')}</Typography>
            } />
            {org.contact_phone && (
              <Row label="ტელეფონი" value={<Typography variant="body2">{org.contact_phone}</Typography>} />
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Change billing status */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>ბილინგის სტატუსი</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            ხელით შეცვლა — მაგ. გადახდის შემდეგ შეჩერების მოხსნა.
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>სტატუსი</InputLabel>
            <Select
              label="სტატუსი"
              value={org.billing_status}
              onChange={e => {
                const next = e.target.value as BillingState
                if (next !== org.billing_status) setPendingStatus(next)
              }}
            >
              {STATUS_KEYS.map(key => (
                <MenuItem key={key} value={key}>{STATUS_LABELS[key].label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      {/* Concierge onboarding: configure the account on the owner's behalf. */}
      <OrgSetupPanel orgId={org.id} />

      <ConfirmDialog
        open={!!pendingStatus}
        title="სტატუსის შეცვლა"
        message={pendingStatus ? `შეიცვალოს ბილინგის სტატუსი „${STATUS_LABELS[pendingStatus].label}“-ზე?` : ''}
        confirmLabel="შეცვლა"
        destructive={false}
        loading={saving}
        onConfirm={changeBillingStatus}
        onClose={() => setPendingStatus(null)}
      />
    </Box>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      {value}
    </Box>
  )
}
