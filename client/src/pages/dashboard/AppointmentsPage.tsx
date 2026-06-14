import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, Chip, Button, TextField,
  Select, MenuItem, FormControl, InputLabel,
  Stack, Skeleton, Dialog, DialogTitle, DialogContent,
  DialogActions, CircularProgress,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'

type AppointmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed'

interface Appointment {
  id: string
  scheduled_at: string
  duration_minutes: number
  status: AppointmentStatus
  payment_method: string
  payment_status: string
  notes: string | null
  admin_notes: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  services: { name: string; price: number; duration_minutes: number } | null
}

const STATUS_COLOR: Record<AppointmentStatus, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'error',
  cancelled: 'default',
  completed: 'info',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending:   'მოლოდინში',
  approved:  'დამტკიცებული',
  rejected:  'უარყოფილი',
  cancelled: 'გაუქმებული',
  completed: 'დასრულებული',
}

export default function AppointmentsPage() {
  const { t } = useTranslation()
  const { org } = useOrg()

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Detail dialog
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [adminNote, setAdminNote] = useState('')

  useEffect(() => {
    if (org) loadAppointments()
  }, [org, statusFilter])

  async function loadAppointments() {
    if (!org) return
    setLoading(true)

    let query = supabase
      .from('appointments')
      .select('id, scheduled_at, duration_minutes, status, payment_method, payment_status, notes, admin_notes, customers(first_name, last_name, phone_number), services(name, price, duration_minutes)')
      .eq('org_id', org.id)
      .order('scheduled_at', { ascending: false })
      .limit(100)

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    const { data } = await query
    setAppointments((data ?? []) as unknown as Appointment[])
    setLoading(false)
  }

  async function changeStatus(id: string, status: 'approved' | 'rejected') {
    setActionLoading(id)
    const { error } = await supabase
      .from('appointments')
      .update({ status, admin_notes: adminNote || null, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (!error) {
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
      setSelected(null)
      setAdminNote('')
    }
    setActionLoading(null)
  }

  const filtered = appointments.filter(a => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      a.customers?.first_name.toLowerCase().includes(q) ||
      a.customers?.last_name?.toLowerCase().includes(q) ||
      a.customers?.phone_number.includes(q) ||
      a.services?.name.toLowerCase().includes(q)
    )
  })

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>
        {t('dashboard.appointments')}
      </Typography>

      {/* Filters */}
      <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="ძიება..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> } }}
          sx={{ minWidth: 220 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>სტატუსი</InputLabel>
          <Select
            value={statusFilter}
            label="სტატუსი"
            onChange={e => setStatusFilter(e.target.value as AppointmentStatus | 'all')}
          >
            <MenuItem value="all">ყველა</MenuItem>
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map(s => (
              <MenuItem key={s} value={s}>{STATUS_LABEL[s]}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {/* Table */}
      <Card>
        {/* Header */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 1fr 100px 90px 120px',
            px: 2, py: 1.5,
            bgcolor: 'grey.50',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          {['დრო', 'კლიენტი', 'სერვისი', 'გადახდა', 'ფასი', 'სტატუსი'].map(h => (
            <Typography key={h} variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {h}
            </Typography>
          ))}
        </Box>

        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
            <Box key={i} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton height={24} />
            </Box>
          ))
          : filtered.length === 0
          ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                ჯავშნები ვერ მოიძებნა
              </Typography>
            </Box>
          )
          : filtered.map((appt, i) => (
            <Box
              key={appt.id}
              onClick={() => { setSelected(appt); setAdminNote(appt.admin_notes ?? '') }}
              sx={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr 1fr 100px 90px 120px',
                px: 2, py: 1.5,
                borderBottom: i < filtered.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
                alignItems: 'center',
              }}
            >
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {format(new Date(appt.scheduled_at), 'dd MMM')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {format(new Date(appt.scheduled_at), 'HH:mm')}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2">
                  {appt.customers?.first_name} {appt.customers?.last_name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {appt.customers?.phone_number}
                </Typography>
              </Box>
              <Typography variant="body2">{appt.services?.name}</Typography>
              <Chip
                label={appt.payment_method === 'online' ? 'ონლაინ' : 'ადგილზე'}
                size="small"
                variant="outlined"
              />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {appt.services?.price} ₾
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Chip
                  label={STATUS_LABEL[appt.status]}
                  color={STATUS_COLOR[appt.status]}
                  size="small"
                />
                {appt.status === 'pending' && (
                  <>
                    <Button
                      size="small"
                      color="success"
                      variant="contained"
                      sx={{ minWidth: 0, p: '2px 6px', ml: 0.5 }}
                      onClick={e => { e.stopPropagation(); changeStatus(appt.id, 'approved') }}
                      disabled={actionLoading === appt.id}
                    >
                      {actionLoading === appt.id
                        ? <CircularProgress size={12} color="inherit" />
                        : <CheckIcon sx={{ fontSize: 14 }} />
                      }
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      sx={{ minWidth: 0, p: '2px 6px' }}
                      onClick={e => { e.stopPropagation(); changeStatus(appt.id, 'rejected') }}
                      disabled={actionLoading === appt.id}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </Button>
                  </>
                )}
              </Box>
            </Box>
          ))
        }
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onClose={() => setSelected(null)} maxWidth="xs" fullWidth>
        {selected && (
          <>
            <DialogTitle sx={{ fontWeight: 700 }}>
              {selected.customers?.first_name} {selected.customers?.last_name}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>სერვისი</Typography>
                  <Typography variant="body2">{selected.services?.name} — {selected.services?.price} ₾</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>თარიღი / დრო</Typography>
                  <Typography variant="body2">
                    {format(new Date(selected.scheduled_at), 'dd MMMM yyyy, HH:mm')}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>ტელეფონი</Typography>
                  <Typography variant="body2">{selected.customers?.phone_number}</Typography>
                </Box>
                {selected.notes && (
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>შენიშვნა</Typography>
                    <Typography variant="body2">{selected.notes}</Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>გადახდა</Typography>
                  <Typography variant="body2">
                    {selected.payment_method === 'online' ? 'ონლაინ' : 'ადგილზე'} ·{' '}
                    {selected.payment_status === 'paid' ? '✓ გადახდილია' : 'გადაუხდელი'}
                  </Typography>
                </Box>
                {selected.status === 'pending' && (
                  <TextField
                    fullWidth
                    size="small"
                    label="შიდა შენიშვნა (არასავალდებულო)"
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    multiline
                    rows={2}
                  />
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setSelected(null)}>{t('common.cancel')}</Button>
              {selected.status === 'pending' && (
                <>
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => changeStatus(selected.id, 'rejected')}
                    disabled={!!actionLoading}
                  >
                    {t('dashboard.reject')}
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={() => changeStatus(selected.id, 'approved')}
                    disabled={!!actionLoading}
                  >
                    {t('dashboard.approve')}
                  </Button>
                </>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  )
}
