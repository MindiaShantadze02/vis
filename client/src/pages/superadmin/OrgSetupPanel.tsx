import { useEffect, useState } from 'react'
import {
  Box, Card, CardContent, Typography, TextField, Button, IconButton,
  Stack, Divider, Switch, FormControlLabel, CircularProgress,
} from '@mui/material'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useToast, EmptyState } from '@/components/ui'
import { FIELD_LIMITS } from '@/lib/validation'
import {
  BOOKING_THEME_LIST, DEFAULT_BOOKING_THEME, getBookingTheme, isCustomBookingColor,
} from '@/theme/bookingThemes'
import { surface } from '@/theme/theme'

/**
 * Superadmin "configure on the owner's behalf" panel (concierge onboarding):
 * business info, booking-page settings, address, services, specialists and
 * weekly hours for one org, editable with the superadmin RLS policies (the
 * organisations UPDATE policy already allows superadmins; migration 078 added
 * the services / staff / hours ones). Deliberately leaner than the owner-facing
 * settings pages — a back-office tool for typing in what a business described
 * in its setup request. Photos/logo are NOT set here (owners add media after
 * handoff). Georgian-only, like the rest of the superadmin console.
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

  // ── Business info (name / description / address) ───────────
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)

  // ── Booking-page settings ──────────────────────────────────
  const [bookingTheme, setBookingTheme] = useState<string>(DEFAULT_BOOKING_THEME)
  const [reviewsEnabled, setReviewsEnabled] = useState(true)
  const [requireApproval, setRequireApproval] = useState(true)
  const [savingBooking, setSavingBooking] = useState(false)

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
        supabase.from('organisations').select('name, description, address, booking_theme, reviews_enabled, require_approval').eq('id', orgId).maybeSingle(),
        supabase.from('services').select('id, name, duration_minutes, price').eq('org_id', orgId).eq('is_active', true).order('sort_order'),
        supabase.from('org_members').select('id, display_name, title, is_bookable').eq('org_id', orgId).eq('role', 'staff').order('sort_order'),
        supabase.from('working_hours_template').select('*').eq('org_id', orgId).maybeSingle(),
      ])
      const org = orgRes.data as {
        name?: string; description?: string | null; address?: string | null
        booking_theme?: string | null; reviews_enabled?: boolean; require_approval?: boolean
      } | null
      setName(org?.name ?? '')
      setDescription(org?.description ?? '')
      setAddress(org?.address ?? '')
      setBookingTheme(getBookingTheme(org?.booking_theme ?? null).key)
      setReviewsEnabled(org?.reviews_enabled ?? true)
      setRequireApproval(org?.require_approval ?? true)
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

  async function saveInfo() {
    if (name.trim().length < 2) { toast.error('ბიზნესის სახელი მინიმუმ 2 სიმბოლო'); return }
    setSavingInfo(true)
    const { error } = await supabase.from('organisations')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        address: address.trim() || null,
      }).eq('id', orgId)
    setSavingInfo(false)
    if (error) { toast.error(error.message); return }
    toast.success('შენახულია')
  }

  async function saveBooking() {
    setSavingBooking(true)
    const { error } = await supabase.from('organisations')
      .update({
        booking_theme: bookingTheme,
        reviews_enabled: reviewsEnabled,
        require_approval: requireApproval,
      }).eq('id', orgId)
    setSavingBooking(false)
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

      {/* Business info — name / description / address */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>ბიზნესის ინფო</Typography>
          <Stack spacing={2}>
            <TextField
              size="small" fullWidth label="ბიზნესის სახელი"
              value={name} onChange={e => setName(e.target.value)}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.orgName, 'data-testid': 'sa-org-name' } }}
            />
            <TextField
              size="small" fullWidth multiline rows={2} label="აღწერა"
              value={description} onChange={e => setDescription(e.target.value)}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.description, 'data-testid': 'sa-org-description' } }}
            />
            <TextField
              size="small" fullWidth label="მისამართი" placeholder="ქ. თბილისი, …"
              helperText="ჩანს ჯავშნის გვერდზე და ემატება დადასტურების SMS-ს."
              value={address} onChange={e => setAddress(e.target.value)}
              slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.address, 'data-testid': 'sa-org-address' } }}
            />
          </Stack>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={saveInfo} disabled={savingInfo} data-testid="sa-org-info-save">
              {savingInfo ? <CircularProgress size={18} color="inherit" /> : 'შენახვა'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Booking page — theme + reviews + approval mode */}
      <Card>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>ჯავშნის გვერდი</Typography>

          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>ფერი</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {BOOKING_THEME_LIST.map(th => {
              const selected = th.key === bookingTheme
              return (
                <Box
                  key={th.key}
                  onClick={() => setBookingTheme(th.key)}
                  role="button"
                  aria-pressed={selected}
                  data-testid="sa-booking-theme"
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.75,
                    px: 1.25, py: 0.75, borderRadius: 2, cursor: 'pointer',
                    border: '2px solid', borderColor: selected ? 'primary.main' : 'divider',
                    bgcolor: selected ? surface.hover : 'transparent',
                  }}
                >
                  <Box sx={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: th.deep !== th.primary
                      ? `linear-gradient(135deg, ${th.primary} 0 58%, ${th.deep} 58% 100%)`
                      : th.primary,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                  }} />
                  <Typography variant="caption" sx={{ fontWeight: selected ? 700 : 500 }}>{th.label}</Typography>
                </Box>
              )
            })}
            <Box
              component="label"
              role="button"
              aria-pressed={isCustomBookingColor(bookingTheme)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.25, py: 0.75, borderRadius: 2, cursor: 'pointer',
                border: '2px solid', borderColor: isCustomBookingColor(bookingTheme) ? 'primary.main' : 'divider',
              }}
            >
              <Box sx={{
                width: 18, height: 18, borderRadius: '50%',
                background: isCustomBookingColor(bookingTheme) ? bookingTheme : 'conic-gradient(from 0deg, #FF6B35, #F6B042, #0E9F6E, #5B4BE0, #C4572F, #FF6B35)',
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
              }} />
              <Typography variant="caption">
                {isCustomBookingColor(bookingTheme) ? bookingTheme.toUpperCase() : 'სხვა'}
              </Typography>
              <input
                type="color"
                value={isCustomBookingColor(bookingTheme) ? bookingTheme : '#B76E79'}
                onChange={e => setBookingTheme(e.target.value)}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                data-testid="sa-booking-custom-color"
              />
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />

          <FormControlLabel
            sx={{ ml: 0, display: 'flex' }}
            control={<Switch checked={reviewsEnabled} onChange={e => setReviewsEnabled(e.target.checked)} data-testid="sa-reviews-toggle" />}
            label={<Typography variant="body2">შეფასებები ჩართულია</Typography>}
          />
          <FormControlLabel
            sx={{ ml: 0, display: 'flex' }}
            control={<Switch checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} data-testid="sa-require-approval-toggle" />}
            label={
              <Box>
                <Typography variant="body2">ჯავშნის დადასტურება საჭიროა</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  გამორთვისას ჯავშნები ავტომატურად დასტურდება
                </Typography>
              </Box>
            }
          />

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={saveBooking} disabled={savingBooking} data-testid="sa-booking-save">
              {savingBooking ? <CircularProgress size={18} color="inherit" /> : 'შენახვა'}
            </Button>
          </Box>
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
