import type { ReactNode } from 'react'
import { Box, Typography, Stack, Select, MenuItem, FormControl, InputLabel } from '@mui/material'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { StatusChip } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'
import type { Appointment, StaffRef } from '@/types/appointment'

interface AppointmentDetailsProps {
  appt: Appointment
  /** Members offerable for this appointment's service; empty hides the picker. */
  assignableMembers: StaffRef[]
  onReassign: (staffId: string | null) => void
  /** Appends the booking duration to the date line (the calendar wants it). */
  showDuration?: boolean
  /** Page-specific extras (review link, meeting link, refund choice…). */
  children?: ReactNode
}

/**
 * The read-only body of an appointment detail drawer: service, when, phone,
 * status, staff picker, notes and payment. Shared by the overview list and the
 * calendar, which previously kept two drifting copies of the same markup.
 */
export default function AppointmentDetails({
  appt,
  assignableMembers,
  onReassign,
  showDuration = false,
  children,
}: AppointmentDetailsProps) {
  const { t } = useTranslation()

  const paymentLabel = appt.payment_method === 'online'
    ? t('settings.locationOnline')
    : t('settings.locationInPerson')
  const paymentState = appt.payment_status === 'refunded'
    ? t('dashboard.refunded')
    : appt.payment_status === 'paid' ? t('calendar.paid') : t('calendar.unpaid')

  return (
    <Stack spacing={1.5}>
      <Field label={t('calendar.service')}>
        {appt.services?.name} — {appt.services?.price} ₾
      </Field>

      <Field label={t('calendar.dateTime')}>
        {format(new Date(appt.scheduled_at), 'd MMMM yyyy, HH:mm', { locale: dateLocale() })}
        {showDuration && <>{' · '}{appt.duration_minutes} {t('common.minutesShort')}</>}
      </Field>

      <Field label={t('calendar.phone')}>{appt.customers?.phone_number}</Field>

      <Box>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('calendar.status')}</Typography>
        <Box sx={{ mt: 0.25 }}><StatusChip status={appt.status} /></Box>
      </Box>

      {assignableMembers.length > 0 && (
        <FormControl fullWidth size="small">
          <InputLabel>{t('dashboard.staff')}</InputLabel>
          <Select
            value={appt.staff_id ?? ''}
            label={t('dashboard.staff')}
            data-testid="appt-staff-select"
            onChange={e => onReassign(e.target.value === '' ? null : e.target.value)}
          >
            <MenuItem value=""><em>{t('dashboard.unassigned')}</em></MenuItem>
            {assignableMembers.map(m => (
              <MenuItem key={m.id} value={m.id}>{m.display_name || '—'}</MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {appt.notes && <Field label={t('calendar.note')}>{appt.notes}</Field>}

      <Field label={t('calendar.payment')}>{paymentLabel} · {paymentState}</Field>

      {children}
    </Stack>
  )
}

/** Caption above a value — the drawer's one repeating row shape. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body2">{children}</Typography>
    </Box>
  )
}
