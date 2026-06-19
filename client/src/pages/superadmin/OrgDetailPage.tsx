import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box, Card, CardContent, Typography, Button, Chip, Divider, Stack,
  Select, MenuItem, FormControl, InputLabel, useTheme,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { PageHeader, LoadingState, ConfirmDialog, EmptyState, useToast } from '@/components/ui'
import { TIERS, TIER_KEYS, tierInfo, tierColor, type Tier } from '@/lib/tiers'

interface Org {
  id: string
  name: string
  slug: string
  subscription_tier: string
  subscription_expires_at: string | null
  created_at: string
  contact_phone: string | null
}

interface Usage { used: number; appt_limit: number | null; period_end: string | null }

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const theme = useTheme()
  const toast = useToast()

  const [org, setOrg] = useState<Org | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingTier, setPendingTier] = useState<Tier | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    const [orgRes, usageRes] = await Promise.all([
      supabase.from('organisations').select('id, name, slug, subscription_tier, subscription_expires_at, created_at, contact_phone').eq('id', id).maybeSingle(),
      supabase.rpc('org_usage_info', { p_org_id: id }).maybeSingle(),
    ])
    setOrg((orgRes.data ?? null) as Org | null)
    const u = usageRes.data as { used?: number; appt_limit?: number | null; period_end?: string | null } | null
    setUsage(u ? { used: u.used ?? 0, appt_limit: u.appt_limit ?? null, period_end: u.period_end ?? null } : null)
    setLoading(false)
  }

  async function changeTier() {
    if (!org || !pendingTier) return
    setSaving(true)
    const { error } = await supabase
      .from('organisations')
      .update({ subscription_tier: pendingTier })
      .eq('id', org.id)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('გეგმა შეიცვალა')
    setPendingTier(null)
    load() // usage_anchor was reset by the trigger — refresh the period
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

  const info = tierInfo(org.subscription_tier)

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

      {/* Info + usage */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={1.5}>
            <Row label="გეგმა" value={
              <Chip label={info.label} size="small" sx={{ bgcolor: tierColor(theme, info.colorKey), color: 'white', fontWeight: 700 }} />
            } />
            <Row label="ჯავშნები ამ პერიოდში" value={
              <Typography variant="body2">{usage?.used ?? 0} / {usage?.appt_limit ?? '∞'}</Typography>
            } />
            {usage?.period_end && (
              <Row label="პერიოდი ახლდება" value={
                <Typography variant="body2">{new Date(usage.period_end).toLocaleDateString('ka-GE')}</Typography>
              } />
            )}
            <Row label="რეგისტრაცია" value={
              <Typography variant="body2">{format(new Date(org.created_at), 'dd MMM yyyy')}</Typography>
            } />
            {org.contact_phone && (
              <Row label="ტელეფონი" value={<Typography variant="body2">{org.contact_phone}</Typography>} />
            )}
            {org.subscription_expires_at && (
              <Row label="გეგმის ვადა" value={
                <Typography variant="body2">{new Date(org.subscription_expires_at).toLocaleDateString('ka-GE')}</Typography>
              } />
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Change tier */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>გეგმის შეცვლა</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            გეგმის შეცვლა გადათვლის ბილინგის პერიოდს (გამოყენება იწყება ნულიდან).
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>გეგმა</InputLabel>
            <Select
              label="გეგმა"
              value={org.subscription_tier}
              onChange={e => {
                const next = e.target.value as Tier
                if (next !== org.subscription_tier) setPendingTier(next)
              }}
            >
              {TIER_KEYS.map(key => {
                const ti = TIERS.find(t => t.key === key)!
                return <MenuItem key={key} value={key}>{ti.label} — {ti.price}</MenuItem>
              })}
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!pendingTier}
        title="გეგმის შეცვლა"
        message={pendingTier ? `დარწმუნებული ხართ, რომ გსურთ გეგმის შეცვლა „${tierInfo(pendingTier).label}“-ზე? ბილინგის პერიოდი გადაითვლება.` : ''}
        confirmLabel="შეცვლა"
        destructive={false}
        loading={saving}
        onConfirm={changeTier}
        onClose={() => setPendingTier(null)}
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
