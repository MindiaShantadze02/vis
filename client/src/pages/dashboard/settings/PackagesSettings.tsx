import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack, Divider, Alert,
  CircularProgress, Chip, FormControl, InputLabel, Select, MenuItem, FormHelperText,
} from '@mui/material'
import {
  Add as AddIcon,
  EditOutlined as EditOutlinedIcon,
  DeleteOutlined as DeleteOutlinedIcon,
  ConfirmationNumberOutlined as PackageIcon,
} from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import {
  PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton,
  FormErrorAlert, useToast, SideDrawer,
} from '@/components/ui'
import {
  isNonNegativeNumber, MAX_PRICE, FIELD_LIMITS,
  isValidGeorgianPhone, isValidPersonName, formatGeorgianPhone,
} from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import { packageRemaining } from '@/lib/packages'

// A catalogue package (packages table). service_id null = redeemable against
// any service; validity_days null = never expires.
interface Package {
  id: string
  service_id: string | null
  name: string
  session_count: number
  price: number
  validity_days: number | null
  active: boolean
}

interface ServiceOption { id: string; name: string }

// A sold package (get_org_customer_packages RPC row) — flat shape with the
// customer's name joined in, since customers_select can't see an unbooked one.
interface SoldPackage {
  id: string
  customer_id: string
  sessions_total: number
  sessions_used: number
  expires_at: string | null
  payment_status: 'pending' | 'paid' | 'failed'
  first_name: string
  last_name: string | null
  package_name: string
  service_id: string | null
}

// Numeric fields held as strings while editing (clearable/partial), coerced on save.
interface PackageForm {
  name: string
  service_id: string        // '' = any service
  session_count: string
  price: string
  validity_days: string     // '' = no expiry
}

const EMPTY: PackageForm = { name: '', service_id: '', session_count: '8', price: '', validity_days: '' }

export default function PackagesSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [packages, setPackages] = useState<Package[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])
  const [sold, setSold] = useState<SoldPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Create/edit drawer
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Package | null>(null)

  // Sell drawer
  const [selling, setSelling] = useState<Package | null>(null)
  const [sellFirst, setSellFirst] = useState('')
  const [sellLast, setSellLast] = useState('')
  const [sellPhone, setSellPhone] = useState('')
  const [sellSubmitted, setSellSubmitted] = useState(false)
  const [sellBusy, setSellBusy] = useState(false)

  useEffect(() => {
    if (org) load()
  }, [org])

  async function load() {
    if (!org) return
    setLoading(true)
    const [pkgRes, svcRes, soldRes] = await Promise.all([
      supabase.from('packages').select('*').eq('org_id', org.id).order('created_at', { ascending: false }),
      supabase.from('services').select('id, name').eq('org_id', org.id).eq('is_active', true).order('sort_order'),
      supabase.rpc('get_org_customer_packages', { p_org_id: org.id }),
    ])
    setPackages((pkgRes.data ?? []) as Package[])
    setServices((svcRes.data ?? []) as ServiceOption[])
    setSold(Array.isArray(soldRes.data) ? (soldRes.data as SoldPackage[]) : [])
    setLoading(false)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setError(null)
    setSubmitted(false)
    setOpen(true)
  }

  function openEdit(p: Package) {
    setEditing(p)
    setForm({
      name: p.name,
      service_id: p.service_id ?? '',
      session_count: String(p.session_count),
      price: String(p.price),
      validity_days: p.validity_days != null ? String(p.validity_days) : '',
    })
    setError(null)
    setSubmitted(false)
    setOpen(true)
  }

  const nameInvalid = submitted && form.name.trim().length < 2
  const countNum = Number(form.session_count)
  const countInvalid = submitted && !(Number.isInteger(countNum) && countNum >= 1 && countNum <= 200)
  const priceInvalid = submitted &&
    (form.price.trim() === '' || !isNonNegativeNumber(Number(form.price)) || Number(form.price) > MAX_PRICE)
  const validityInvalid = submitted && form.validity_days.trim() !== '' &&
    !(Number.isInteger(Number(form.validity_days)) && Number(form.validity_days) >= 1)

  async function handleSave() {
    if (!org) return
    setSubmitted(true)
    const invalid =
      form.name.trim().length < 2 ||
      !(Number.isInteger(countNum) && countNum >= 1 && countNum <= 200) ||
      form.price.trim() === '' || !isNonNegativeNumber(Number(form.price)) || Number(form.price) > MAX_PRICE ||
      (form.validity_days.trim() !== '' && !(Number.isInteger(Number(form.validity_days)) && Number(form.validity_days) >= 1))
    if (invalid) {
      focusFirstInvalidFieldAfterRender(document.querySelector('[data-testid="package-form"]') ?? document)
      return
    }
    setSaving(true)
    setError(null)
    const row = {
      org_id: org.id,
      name: form.name.trim(),
      service_id: form.service_id || null,
      session_count: countNum,
      price: Number(form.price),
      validity_days: form.validity_days.trim() === '' ? null : Number(form.validity_days),
    }
    const res = editing
      ? await supabase.from('packages').update(row).eq('id', editing.id)
      : await supabase.from('packages').insert(row)
    setSaving(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    toast.success(t('common.saved'))
    setOpen(false)
    load()
  }

  async function handleDelete(p: Package) {
    await supabase.from('packages').delete().eq('id', p.id)
    setConfirmDelete(null)
    toast.success(t('common.deleted'))
    load()
  }

  async function toggleActive(p: Package) {
    await supabase.from('packages').update({ active: !p.active }).eq('id', p.id)
    load()
  }

  function openSell(p: Package) {
    setSelling(p)
    setSellFirst('')
    setSellLast('')
    setSellPhone('')
    setSellSubmitted(false)
  }

  const sellFirstInvalid = sellSubmitted && (sellFirst.trim().length < 2 || !isValidPersonName(sellFirst))
  const sellLastInvalid = sellLast.trim().length > 0 && !isValidPersonName(sellLast)
  const sellPhoneInvalid = sellSubmitted && !isValidGeorgianPhone(sellPhone)

  // Sell = create a PENDING customer_packages row via create-payment (server
  // prices it from the packages row) and redirect to the mock checkout, exactly
  // like buying credit. The webhook flips it to paid on success.
  async function handleSell() {
    if (!org || !selling) return
    setSellSubmitted(true)
    if (sellFirst.trim().length < 2 || !isValidPersonName(sellFirst) ||
        sellLastInvalid || !isValidGeorgianPhone(sellPhone)) {
      focusFirstInvalidFieldAfterRender(document.querySelector('[data-testid="sell-package-form"]') ?? document)
      return
    }
    setSellBusy(true)
    const { data, error: fnErr } = await supabase.functions.invoke('create-payment', {
      body: {
        purpose: 'package',
        org_id: org.id,
        package_id: selling.id,
        first_name: sellFirst.trim(),
        last_name: sellLast.trim() || null,
        phone: formatGeorgianPhone(sellPhone),
        idempotency_key: crypto.randomUUID(),
        returnBaseUrl: window.location.origin,
      },
    })
    if (fnErr || !data?.checkoutUrl) {
      setSellBusy(false)
      setError(t('packages.sellFailed'))
      return
    }
    window.location.assign(data.checkoutUrl)
  }

  const serviceName = (id: string | null) =>
    id == null ? t('packages.anyService') : (services.find(s => s.id === id)?.name ?? '—')

  return (
    <Box>
      <PageHeader
        title={t('settings.packages')}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="packages-add">
            {t('packages.addPackage')}
          </Button>
        }
      />

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t('packages.intro')}
      </Typography>

      {error && !open && !selling && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Catalogue */}
      <Card>
        {loading
          ? <LoadingState />
          : packages.length === 0
          ? (
            <EmptyState
              icon={<PackageIcon />}
              title={t('packages.noPackages')}
              caption={t('packages.noPackagesCaption')}
            />
          )
          : packages.map((p, i) => (
            <Box key={p.id}>
              {i > 0 && <Divider />}
              <Box
                data-testid="package-row"
                sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 2, opacity: p.active ? 1 : 0.55 }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="package-name">{p.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('packages.sessionsCount', { count: p.session_count })} · {p.price} ₾ · {serviceName(p.service_id)}
                    {p.validity_days != null && ` · ${t('packages.validForDays', { count: p.validity_days })}`}
                  </Typography>
                </Box>
                <Button
                  size="small" variant="outlined" data-testid="package-sell"
                  disabled={!p.active || Number(p.price) <= 0}
                  onClick={() => openSell(p)}
                >
                  {t('packages.sell')}
                </Button>
                <ActionIconButton aria-label={t('common.edit')} data-testid="package-edit" onClick={() => openEdit(p)}>
                  <EditOutlinedIcon fontSize="small" />
                </ActionIconButton>
                <ActionIconButton tone="danger" aria-label={t('common.delete')} data-testid="package-delete" onClick={() => setConfirmDelete(p)}>
                  <DeleteOutlinedIcon fontSize="small" />
                </ActionIconButton>
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Sold packages */}
      {sold.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 4, mb: 1.5, fontWeight: 700 }}>
            {t('packages.soldTitle')}
          </Typography>
          <Card>
            {sold.map((s, i) => {
              const remaining = packageRemaining({ sessionsTotal: s.sessions_total, sessionsUsed: s.sessions_used })
              return (
                <Box key={s.id}>
                  {i > 0 && <Divider />}
                  <Box data-testid="sold-package-row" sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {s.first_name} {s.last_name ?? ''}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.package_name}</Typography>
                    </Box>
                    {s.payment_status !== 'paid' && (
                      <Chip
                        size="small"
                        color={s.payment_status === 'pending' ? 'warning' : 'default'}
                        label={t(`packages.status_${s.payment_status}`)}
                      />
                    )}
                    <Chip
                      size="small"
                      color={remaining > 0 && s.payment_status === 'paid' ? 'primary' : 'default'}
                      variant="outlined"
                      data-testid="sold-package-remaining"
                      label={t('packages.remainingOf', { remaining, total: s.sessions_total })}
                    />
                  </Box>
                </Box>
              )
            })}
          </Card>
        </>
      )}

      {/* Create / edit drawer */}
      <SideDrawer
        open={open}
        onClose={() => setOpen(false)}
        disableClose={saving}
        title={editing ? t('packages.editPackage') : t('packages.newPackage')}
        width={520}
        data-testid="package-form"
        actions={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={handleSave} data-testid="package-save" disabled={saving}>
              {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
            </Button>
          </>
        }
      >
        <Box>
          <FormErrorAlert message={open ? error : null} data-testid="package-dialog-error" />
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('packages.name')} value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              fullWidth required size="small"
              error={nameInvalid}
              helperText={nameInvalid ? t('validation.minLength', { min: 2 }) : undefined}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.serviceName ?? 80, 'data-testid': 'package-form-name' } }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>{t('packages.service')}</InputLabel>
              <Select
                value={form.service_id}
                label={t('packages.service')}
                data-testid="package-form-service"
                onChange={e => setForm({ ...form, service_id: e.target.value })}
              >
                <MenuItem value=""><em>{t('packages.anyService')}</em></MenuItem>
                {services.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
              </Select>
              <FormHelperText>{t('packages.serviceHelp')}</FormHelperText>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label={t('packages.sessionCount')} value={form.session_count}
                onChange={e => setForm({ ...form, session_count: e.target.value.replace(/[^0-9]/g, '') })}
                fullWidth required size="small"
                error={countInvalid}
                helperText={countInvalid ? t('packages.sessionCountHelp') : undefined}
                slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'package-form-count' } }}
              />
              <TextField
                label={`${t('packages.price')} (₾)`} value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })}
                fullWidth required size="small"
                error={priceInvalid}
                helperText={priceInvalid ? t('packages.priceHelp') : undefined}
                slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'package-form-price' } }}
              />
            </Stack>
            <TextField
              label={t('packages.validityDays')} value={form.validity_days}
              onChange={e => setForm({ ...form, validity_days: e.target.value.replace(/[^0-9]/g, '') })}
              fullWidth size="small"
              error={validityInvalid}
              helperText={validityInvalid ? t('packages.validityHelp') : t('packages.validityOptional')}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'package-form-validity' } }}
            />
          </Stack>
        </Box>
      </SideDrawer>

      {/* Sell drawer */}
      <SideDrawer
        open={!!selling}
        onClose={() => setSelling(null)}
        disableClose={sellBusy}
        title={t('packages.sellTitle', { name: selling?.name ?? '' })}
        width={480}
        data-testid="sell-package-form"
        actions={
          <>
            <Button onClick={() => setSelling(null)}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={handleSell} data-testid="sell-confirm" disabled={sellBusy}>
              {sellBusy ? <CircularProgress size={20} color="inherit" /> : t('packages.sellConfirm', { price: selling?.price ?? 0 })}
            </Button>
          </>
        }
      >
        <Box>
          <FormErrorAlert message={selling ? error : null} data-testid="sell-dialog-error" />
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('packages.sellHint')}
          </Typography>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label={t('calendar.name')} value={sellFirst}
                onChange={e => setSellFirst(e.target.value)}
                fullWidth required size="small"
                error={sellFirstInvalid}
                helperText={sellFirstInvalid ? t('validation.lettersOnly') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'sell-first-name' } }}
              />
              <TextField
                label={t('calendar.lastName')} value={sellLast}
                onChange={e => setSellLast(e.target.value)}
                fullWidth size="small"
                error={sellLastInvalid}
                helperText={sellLastInvalid ? t('validation.lettersOnly') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName } }}
              />
            </Stack>
            <TextField
              label={t('calendar.phone')} value={sellPhone}
              onChange={e => setSellPhone(e.target.value)}
              fullWidth required size="small" placeholder="599 123 456"
              error={sellPhoneInvalid}
              helperText={sellPhoneInvalid ? t('validation.invalidPhone') : ' '}
              slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'sell-phone' } }}
            />
          </Stack>
        </Box>
      </SideDrawer>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('packages.deleteTitle')}
        message={confirmDelete ? t('packages.deleteMessage', { name: confirmDelete.name }) : undefined}
        confirmLabel={t('common.delete')}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
      />
    </Box>
  )
}
