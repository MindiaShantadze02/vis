import { useState } from 'react'
import {
  Box, Typography, Button, TextField, Stack,
  Alert, CircularProgress, ToggleButtonGroup, ToggleButton,
  Divider,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import { format } from 'date-fns'
import { ka } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { isValidGeorgianPhone, formatGeorgianPhone, isValidPersonName, FIELD_LIMITS } from '@/lib/validation'
import type { BookingOrg, BookingState } from './BookingLayout'

interface Props {
  org: BookingOrg
  booking: BookingState
  onChange: (p: Partial<BookingState>) => void
  onBack: () => void
  onDone: (appointmentId: string) => void
}

export default function Step3CustomerForm({ org, booking, onChange, onBack, onDone }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onlineEnabled = org.payment_config?.bog?.enabled || org.payment_config?.tbc?.enabled
  const inPersonEnabled = org.payment_config?.inPerson?.enabled !== false

  const scheduledAt = booking.date && booking.time
    ? new Date(`${booking.date}T${booking.time}:00`)
    : null

  async function handleBook() {
    if (!booking.service || !scheduledAt) return
    setLoading(true)
    setError(null)

    try {
      // Re-check availability right before inserting: the slot may have filled
      // since it was computed in Step 2 (capacity and per-person freedom).
      const dayStart = `${booking.date}T00:00:00.000Z`
      const dayEnd = `${booking.date}T23:59:59.999Z`
      const { data: existing } = await supabase
        .from('appointments')
        .select('scheduled_at, duration_minutes, service_id, staff_id')
        .eq('org_id', org.id)
        .gte('scheduled_at', dayStart)
        .lte('scheduled_at', dayEnd)
        .not('status', 'in', '(rejected,cancelled)')

      const slotStart = scheduledAt.getTime()
      const slotEnd = slotStart + booking.service.duration_minutes * 60000
      const overlapping = (existing ?? []).filter(a => {
        const aStart = new Date(a.scheduled_at).getTime()
        const aEnd = aStart + a.duration_minutes * 60000
        return slotStart < aEnd && slotEnd > aStart
      })

      // Per-service capacity cap.
      const serviceCount = overlapping.filter(a => a.service_id === booking.service!.id).length
      if (serviceCount >= booking.service.max_per_slot) {
        setError(t('booking.slotTaken')); setLoading(false); return
      }

      // Resolve the assigned person. "Any available" auto-assigns a free member
      // so per-person availability stays correct for subsequent bookings.
      let staffId: string | null = null
      if (booking.assignedStaff.length > 0) {
        const busyIds = new Set(
          overlapping.map(a => a.staff_id).filter((id): id is string => !!id),
        )
        if (booking.staffId) {
          if (busyIds.has(booking.staffId)) { setError(t('booking.slotTaken')); setLoading(false); return }
          staffId = booking.staffId
        } else {
          const free = booking.assignedStaff
            .filter(m => !busyIds.has(m.id))
            .sort((a, b) => a.sort_order - b.sort_order)
          if (free.length === 0) { setError(t('booking.slotTaken')); setLoading(false); return }
          staffId = free[0].id
        }
      }

      // Generate IDs client-side to avoid needing SELECT after INSERT
      const customerId = crypto.randomUUID()
      const appointmentId = crypto.randomUUID()

      const { error: custErr } = await supabase
        .from('customers')
        .insert({
          id: customerId,
          first_name: booking.firstName.trim(),
          last_name: booking.lastName.trim() || null,
          phone_number: formatGeorgianPhone(booking.phone),
        })

      if (custErr) throw new Error(custErr.message)

      // Create appointment
      const { error: apptErr } = await supabase
        .from('appointments')
        .insert({
          id: appointmentId,
          org_id: org.id,
          service_id: booking.service.id,
          customer_id: customerId,
          scheduled_at: scheduledAt.toISOString(),
          duration_minutes: booking.service.duration_minutes,
          staff_id: staffId,
          status: booking.paymentMethod === 'online' ? 'approved' : 'pending',
          payment_method: booking.paymentMethod,
          payment_status: 'unpaid',
          notes: booking.notes.trim() || null,
        })

      if (apptErr) throw new Error(apptErr.message)

      onDone(appointmentId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'დაჯავშნა ვერ მოხერხდა')
      setLoading(false)
    }
  }

  const phoneInvalid = booking.phone.trim().length > 0 && !isValidGeorgianPhone(booking.phone)
  const firstNameTooShort = booking.firstName.trim().length > 0 && booking.firstName.trim().length < 2
  const firstNameInvalid = booking.firstName.trim().length >= 2 && !isValidPersonName(booking.firstName)
  const lastNameInvalid = booking.lastName.trim().length > 0 && !isValidPersonName(booking.lastName)
  const canBook =
    booking.firstName.trim().length >= 2 &&
    isValidPersonName(booking.firstName) &&
    !lastNameInvalid &&
    isValidGeorgianPhone(booking.phone)

  return (
    <Box>
      <Button
        startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
        onClick={onBack}
        size="small"
        sx={{ mb: 2, color: 'text.secondary' }}
      >
        უკან
      </Button>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>თქვენი მონაცემები</Typography>
      {scheduledAt && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          {booking.service?.name} · {format(scheduledAt, 'd MMMM, HH:mm', { locale: ka })}
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} data-testid="book-error">{error}</Alert>}

      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            label="სახელი"
            value={booking.firstName}
            onChange={e => onChange({ firstName: e.target.value })}
            fullWidth
            required
            autoFocus
            error={firstNameTooShort || firstNameInvalid}
            helperText={
              firstNameTooShort ? t('validation.minLength', { min: 2 })
              : firstNameInvalid ? t('validation.lettersOnly')
              : ' '
            }
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'book-first-name' } }}
          />
          <TextField
            label="გვარი"
            value={booking.lastName}
            onChange={e => onChange({ lastName: e.target.value })}
            fullWidth
            error={lastNameInvalid}
            helperText={lastNameInvalid ? t('validation.lettersOnly') : ' '}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.personName, 'data-testid': 'book-last-name' } }}
          />
        </Stack>

        <TextField
          label="ტელეფონი"
          value={booking.phone}
          onChange={e => onChange({ phone: e.target.value })}
          fullWidth
          required
          placeholder="599 123 456"
          error={phoneInvalid}
          helperText={phoneInvalid ? t('validation.invalidPhone') : ' '}
          slotProps={{ htmlInput: { inputMode: 'tel' as const, 'data-testid': 'book-phone' } }}
        />

        <TextField
          label="შენიშვნა (არასავალდებულო)"
          value={booking.notes}
          onChange={e => onChange({ notes: e.target.value })}
          fullWidth
          multiline
          rows={2}
          slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes, 'data-testid': 'book-notes' } }}
        />

        {/* Payment method */}
        {(onlineEnabled || inPersonEnabled) && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>გადახდის მეთოდი</Typography>
            <ToggleButtonGroup
              value={booking.paymentMethod}
              exclusive
              onChange={(_, v) => v && onChange({ paymentMethod: v })}
              fullWidth
            >
              {inPersonEnabled && (
                <ToggleButton value="in_person" data-testid="book-pay-in_person">
                  <StorefrontOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
                  ადგილზე
                </ToggleButton>
              )}
              {onlineEnabled && (
                <ToggleButton value="online" data-testid="book-pay-online">
                  <CreditCardOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
                  ონლაინ
                </ToggleButton>
              )}
            </ToggleButtonGroup>
            {booking.paymentMethod === 'in_person' && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
                ჯავშანი დადასტურებას საჭიროებს · გადახდა ადგილზე
              </Typography>
            )}
            {booking.paymentMethod === 'online' && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
                ჯავშანი დაუყოვნებლივ დადასტურდება · გადახდა ახლა
              </Typography>
            )}
          </Box>
        )}

        <Divider />

        {/* Summary */}
        <Box sx={{ bgcolor: 'grey.50', borderRadius: 2, p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>სერვისი</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{booking.service?.name}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>თარიღი</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {scheduledAt ? format(scheduledAt, 'd MMM, HH:mm', { locale: ka }) : '—'}
            </Typography>
          </Box>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>სულ</Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {booking.service?.price} ₾
            </Typography>
          </Box>
        </Box>

        <Button
          fullWidth
          variant="contained"
          size="large"
          onClick={handleBook}
          disabled={loading || !canBook}
          data-testid="book-submit"
        >
          {loading
            ? <CircularProgress size={22} color="inherit" />
            : booking.paymentMethod === 'online' ? 'გადახდაზე გადასვლა' : 'ჯავშნის გაკეთება'
          }
        </Button>
      </Stack>
    </Box>
  )
}
