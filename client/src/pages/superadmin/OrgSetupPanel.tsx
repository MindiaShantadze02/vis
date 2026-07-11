import { useEffect, useState } from 'react'
import {
  Box, Card, CardContent, Typography, TextField, Button, IconButton,
  Stack, Divider, Switch, FormControlLabel, CircularProgress,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useToast, EmptyState } from '@/components/ui'
import { FIELD_LIMITS } from '@/lib/validation'

/**
 * Superadmin "configure on the owner's behalf" panel (concierge onboarding):
 * address, services, specialists and weekly hours for one org, editable with
 * the superadmin RLS policies from migration 078. Deliberately leaner than the
 * owner-facing settings pages — this is a back-office tool for typing in what
 * a business described in its setup request, not a replacement for them.
 * Georgian-only, like the rest of the superadmin console.
 */

interface ServiceRow { id: string; name: string; duration_minutes: number; price: number | string }
interface StaffRow { id: string; display_name: string | null; title: string | null; is_bookable: boolean }

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const DAY_LABELS: Record<string, string> = {
  monday: 'ორშაბათი', tuesday: 'სამშაბათი', wednesday: 'ოთხშაბათი', thursday: 'ხუთშაბათი',
  friday: 'პარასკევი', saturday: 'შაბათი', sunday: 'კვირა',
}
interface DayState { open: boolean; start: string; end: string }
type WeekState = Record<string, DayState>

const DEFAULT_DAY: DayState = { open: false, start: '10:00', end: '19:00' }

export default function OrgSetupPanel({ orgId }: { orgId: string }) {
  const toast = useToast()

  // ── Address ────────────────────────────────────────────────
  const [address, setAddress] = useState('')
  const [savingAddress, setSavingAddress] = useState(false)

  // ── Services ───────────────────────────────────────────────
  const [services, setServices] = useState<ServiceRow[]>([])
  const [svcName, setSvcName] = useState('')
  const [svcDuration, setSvcDuration] = useState('60')
  const [svcPrice, setSvcPrice] = useState('')
  const [addingSvc, setAddingSvc] = useState(false)

  // ── Specialists ────────────────────────────────────────────
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [stName, setStName] = useState('')
  const [stTitle, setStTitle] = useState('')
  const [addingStaff, setAddingStaff] = useState(false)

  // ── Working hours ──────────────────────────────────────────
  const [week, setWeek] = useState<WeekState | null>(null)
  const [hasTemplate, setHasTemplate] = useState(false)
  const [savingHours, setSavingHours] = useState(false)

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [orgRes, svcRes, staffRes, hoursRes] = await Promise.all([
        supabase.from('organisations').select('address').eq('id', orgId).maybeSingle(),
        supabase.from('services').select('id, name, duration_minutes, price').eq('org_id', orgId).eq('is_active', true).order('sort_order'),
        supabase.from('org_members').select('id, display_name, title, is_bookable').eq('org_id', orgId).eq('role', 'staff').order('sort_order'),
        supabase.from('working_hours_template').select('*').eq('org_id', orgId).maybeSingle(),
      ])
      setAddress((orgRes.data?.address as string | null) ?? '')
      setServices((svcRes.data ?? []) as ServiceRow[])
      setStaff((staffRes.data ?? []) as StaffRow[])

      const tpl = hoursRes.data as Record<string, { open?: boolean; ranges?: { start: string; end: string }[] }> | null
      setHasTemplate(!!tpl)
      const w: WeekState = {}
      for (const d of DAYS) {
        const day = tpl?.[d]
        const range = day?.ranges?.[0]
        w[d] = day
          ? { open: !!day.open, start: range?.start ?? '10:00', end: range?.end ?? '19:00' }
          : { ...DEFAULT_DAY }
      }
      setWeek(w)
      setLoading(false)
    }
    load()
  }, [orgId])

  async function saveAddress() {
    setSavingAddress(true)
    const { error } = await supabase.from('organisations')
      .update({ address: address.trim() || null }).eq('id', orgId)
    setSavingAddress(false)
    if (error) { toast.error(error.message); return }
    toast.success('შენახულია')
  }

  async function addService() {
    const duration = Number(svcDuration)
    const price = Number(svcPrice || 0)
    if (svcName.trim().length < 2 || !Number.isFinite(duration) || duration <= 0 || duration > 1440 || price < 0) {
      toast.error('შეავსეთ სერვისის ველები სწორად'); return
    }
    setAddingSvc(true)
    const { data, error } = await supabase.from('services')
      .insert({ org_id: orgId, name: svcName.trim(), duration_minutes: duration, price, sort_order: services.length })
      .select('id, name, duration_minutes, price')
      .single()
    setAddingSvc(false)
    if (error) { toast.error(error.message); return }
    setServices(prev => [...prev, data as ServiceRow])
    setSvcName(''); setSvcPrice('')
  }

  async function deleteService(id: string) {
    const { error } = await supabase.from('services').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setServices(prev => prev.filter(s => s.id !== id))
  }

  async function addStaff() {
    if (stName.trim().length < 2) { toast.error('შეიყვანეთ სპეციალისტის სახელი'); return }
    setAddingStaff(true)
    const { data, error } = await supabase.from('org_members')
      .insert({
        org_id: orgId, user_id: null, role: 'staff', is_bookable: true,
        display_name: stName.trim(), title: stTitle.trim() || null, sort_order: staff.length,
      })
      .select('id, display_name, title, is_bookable')
      .single()
    setAddingStaff(false)
    // The per-tier bookable-seat trigger (072) applies to superadmins too — its
    // error surfaces here if the org's tier has no seats left.
    if (error) { toast.error(error.message); return }
    setStaff(prev => [...prev, data as StaffRow])
    setStName(''); setStTitle('')
  }

  async function toggleBookable(row: StaffRow) {
    const { error } = await supabase.from('org_members')
      .update({ is_bookable: !row.is_bookable }).eq('id', row.id)
    if (error) { toast.error(error.message); return }
    setStaff(prev => prev.map(s => (s.id === row.id ? { ...s, is_bookable: !row.is_bookable } : s)))
  }

  async function deleteStaff(id: string) {
    const { error } = await supabase.from('org_members').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setStaff(prev => prev.filter(s => s.id !== id))
  }

  async function saveHours() {
    if (!week) return
    for (const d of DAYS) {
      const s = week[d]
      if (s.open && s.start >= s.end) {
        toast.error(`${DAY_LABELS[d]}: დაწყება უნდა უსწრებდეს დასრულებას`); return
      }
    }
    setSavingHours(true)
    const row: Record<string, unknown> = {}
    for (const d of DAYS) {
      const s = week[d]
      row[d] = { open: s.open, ranges: s.open ? [{ start: s.start, end: s.end }] : [] }
    }
    const { error } = hasTemplate
      ? await supabase.from('working_hours_template').update(row).eq('org_id', orgId)
      : await supabase.from('working_hours_template').insert({ org_id: orgId, ...row })
    setSavingHours(false)
    if (error) { toast.error(error.message); return }
    setHasTemplate(true)
    toast.success('შენახულია')
  }

  if (loading || !week) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
  }

  return (
    <Stack spacing={3} sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        კონფიგურაცია მფლობელის ნაცვლად
      </Typography>

      {/* Address */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>მისამართი</Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField
              size="small" fullWidth placeholder="ქ. თბილისი, …"
              value={address} onChange={e => setAddress(e.target.value)}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.address, 'data-testid': 'sa-org-address' } }}
            />
            <Button variant="outlined" onClick={saveAddress} disabled={savingAddress} data-testid="sa-org-address-save">
              შენახვა
            </Button>
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            ჩანს ჯავშნის გვერდზე და ემატება დადასტურების SMS-ს.
          </Typography>
        </CardContent>
      </Card>

      {/* Services */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>სერვისები</Typography>
          {services.length === 0
            ? <EmptyState title="სერვისები არ არის" />
            : services.map(s => (
              <Box key={s.id} data-testid="sa-service-row" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>{s.name}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{s.duration_minutes} წთ</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 48, textAlign: 'right' }}>{Number(s.price)} ₾</Typography>
                <IconButton size="small" onClick={() => deleteService(s.id)} aria-label="წაშლა" data-testid="sa-service-delete">
                  <DeleteOutlinedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Box>
            ))}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small" label="სახელი" value={svcName} onChange={e => setSvcName(e.target.value)}
              sx={{ flex: 2, minWidth: 160 }}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.serviceName, 'data-testid': 'sa-service-name' } }}
            />
            <TextField
              size="small" label="ხანგრძლივობა (წთ)" value={svcDuration} onChange={e => setSvcDuration(e.target.value)}
              sx={{ width: 150 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'sa-service-duration' } }}
            />
            <TextField
              size="small" label="ფასი (₾)" value={svcPrice} onChange={e => setSvcPrice(e.target.value)}
              sx={{ width: 110 }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'sa-service-price' } }}
            />
            <Button variant="contained" onClick={addService} disabled={addingSvc} data-testid="sa-service-add">
              დამატება
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Specialists */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>სპეციალისტები</Typography>
          {staff.length === 0
            ? <EmptyState title="სპეციალისტები არ არის" />
            : staff.map(m => (
              <Box key={m.id} data-testid="sa-staff-row" sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{m.display_name ?? '—'}</Typography>
                  {m.title && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{m.title}</Typography>}
                </Box>
                <FormControlLabel
                  control={<Switch size="small" checked={m.is_bookable} onChange={() => toggleBookable(m)} />}
                  label={<Typography variant="caption">დაჯავშნადი</Typography>}
                  sx={{ mr: 0 }}
                />
                <IconButton size="small" onClick={() => deleteStaff(m.id)} aria-label="წაშლა" data-testid="sa-staff-delete">
                  <DeleteOutlinedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Box>
            ))}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <TextField
              size="small" label="სახელი" value={stName} onChange={e => setStName(e.target.value)}
              sx={{ flex: 1, minWidth: 160 }}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'sa-staff-name' } }}
            />
            <TextField
              size="small" label="პოზიცია" value={stTitle} onChange={e => setStTitle(e.target.value)}
              sx={{ flex: 1, minWidth: 140 }}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.title, 'data-testid': 'sa-staff-title' } }}
            />
            <Button variant="contained" onClick={addStaff} disabled={addingStaff} data-testid="sa-staff-add">
              დამატება
            </Button>
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            ახალი სპეციალისტი ყველა სერვისზეა ხელმისაწვდომი; დაჯავშნადი ადგილების რაოდენობა გეგმაზეა დამოკიდებული.
          </Typography>
        </CardContent>
      </Card>

      {/* Working hours */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>სამუშაო საათები</Typography>
          <Stack spacing={1}>
            {DAYS.map(d => {
              const s = week[d]
              return (
                <Box key={d} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small" checked={s.open}
                        onChange={() => setWeek(w => w && ({ ...w, [d]: { ...w[d], open: !w[d].open } }))}
                      />
                    }
                    label={<Typography variant="body2" sx={{ minWidth: 88 }}>{DAY_LABELS[d]}</Typography>}
                    sx={{ minWidth: 150, mr: 0 }}
                  />
                  {s.open && (
                    <>
                      <TextField
                        size="small" type="time" value={s.start}
                        onChange={e => setWeek(w => w && ({ ...w, [d]: { ...w[d], start: e.target.value } }))}
                        sx={{ width: 130 }}
                      />
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>—</Typography>
                      <TextField
                        size="small" type="time" value={s.end}
                        onChange={e => setWeek(w => w && ({ ...w, [d]: { ...w[d], end: e.target.value } }))}
                        sx={{ width: 130 }}
                      />
                    </>
                  )}
                </Box>
              )
            })}
          </Stack>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={saveHours} disabled={savingHours} data-testid="sa-hours-save">
              {savingHours ? <CircularProgress size={18} color="inherit" /> : 'საათების შენახვა'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  )
}
