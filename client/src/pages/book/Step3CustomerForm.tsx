import { useState } from 'react'
import {
  Box, Typography, Button, TextField, Stack,
  Alert, CircularProgress, ToggleButtonGroup, ToggleButton,
  Divider,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import { format, parseISO } from 'date-fns'
import { ka } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'
import type { BookingOrg, BookingState } from './BookingLayout'

interface Props {
  org: BookingOrg
  booking: BookingState
  onChange: (p: Partial<BookingState>) => void
  onBack: () => void
  onDone: (appointmentId: string) => void
}

export default function Step3CustomerForm({ org, booking, onChange, onBack, onDone }: Props) {
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
      // Generate IDs client-side to avoid needing SELECT after INSERT
      const customerId = crypto.randomUUID()
      const appointmentId = crypto.randomUUID()

      const { error: custErr } = await supabase
        .from('customers')
        .insert({
          id: customerId,
          first_name: booking.firstName.trim(),
          last_name: booking.lastName.trim() || null,
          phone_number: booking.phone.trim(),
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

  const canBook =
    booking.firstName.trim().length >= 2 &&
    booking.phone.trim().length >= 6

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

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5}>
          <TextField
            label="სახელი"
            value={booking.firstName}
            onChange={e => onChange({ firstName: e.target.value })}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="გვარი"
            value={booking.lastName}
            onChange={e => onChange({ lastName: e.target.value })}
            fullWidth
          />
        </Stack>

        <TextField
          label="ტელეფონი"
          value={booking.phone}
          onChange={e => onChange({ phone: e.target.value })}
          fullWidth
          required
          placeholder="599 123 456"
          slotProps={{ htmlInput: { inputMode: 'tel' as const } }}
        />

        <TextField
          label="შენიშვნა (არასავალდებულო)"
          value={booking.notes}
          onChange={e => onChange({ notes: e.target.value })}
          fullWidth
          multiline
          rows={2}
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
                <ToggleButton value="in_person">
                  <StorefrontOutlinedIcon sx={{ mr: 1, fontSize: 18 }} />
                  ადგილზე
                </ToggleButton>
              )}
              {onlineEnabled && (
                <ToggleButton value="online">
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
