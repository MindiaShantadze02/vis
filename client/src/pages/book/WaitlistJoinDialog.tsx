import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack, Typography, CircularProgress, Box,
} from '@mui/material'
import { CheckCircleOutlined as CheckCircleOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { dateLocale } from '@/lib/dateLocale'
import { isValidGeorgianPhone, isValidPersonName } from '@/lib/validation'
import { CONSENT_VERSION } from '@/pages/legal/legalContent'

interface Props {
  orgId: string
  serviceId: string
  staffId: string | null
  desiredDate: string // yyyy-MM-dd
  onClose: () => void
}

/**
 * Booking-page "join the waitlist" for a full day. Consent-only (the OTP is at
 * claim time) — collects just a name + phone and calls join_waitlist. If a slot
 * on that day frees, the customer is texted a claim link.
 */
export default function WaitlistJoinDialog({ orgId, serviceId, staffId, desiredDate, onClose }: Props) {
  const { t } = useTranslation()
  const [firstName, setFirstName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const nameInvalid = (submitted || firstName.length > 0) && !isValidPersonName(firstName)
  const phoneInvalid = (submitted || phone.length > 0) && !isValidGeorgianPhone(phone)

  async function submit() {
    setSubmitted(true)
    if (!isValidPersonName(firstName) || !isValidGeorgianPhone(phone)) return
    setBusy(true)
    const { error } = await supabase.rpc('join_waitlist', {
      p_org_id: orgId,
      p_service_id: serviceId,
      p_desired_date: desiredDate,
      p_first_name: firstName.trim(),
      p_phone: phone.trim(),
      p_staff_id: staffId,
      p_consent_version: CONSENT_VERSION,
    })
    setBusy(false)
    if (!error) setDone(true)
  }

  const dateLabel = format(new Date(`${desiredDate}T00:00:00`), 'd MMMM', { locale: dateLocale() })

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth data-testid="waitlist-join-dialog">
      {done ? (
        <DialogContent sx={{ textAlign: 'center', py: 4 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '50%', mx: 'auto', mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (th) => `${th.palette.primary.main}1A`, color: 'primary.main' }}>
            <CheckCircleOutlinedIcon sx={{ fontSize: 30 }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{t('waitlist.joinedTitle')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>{t('waitlist.joinedBody', { date: dateLabel })}</Typography>
          <Button variant="contained" onClick={onClose} data-testid="waitlist-join-done">{t('common.close')}</Button>
        </DialogContent>
      ) : (
        <>
          <DialogTitle sx={{ fontWeight: 700 }}>{t('waitlist.joinTitle')}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
              {t('waitlist.joinBody', { date: dateLabel })}
            </Typography>
            <Stack spacing={2}>
              <TextField
                label={t('booking.firstName')} value={firstName}
                onChange={e => setFirstName(e.target.value)} fullWidth autoFocus
                error={nameInvalid} helperText={nameInvalid ? t('validation.lettersOnly') : undefined}
                slotProps={{ htmlInput: { 'data-testid': 'waitlist-join-name' } }}
              />
              <TextField
                label={t('booking.phone')} value={phone}
                onChange={e => setPhone(e.target.value)} fullWidth
                error={phoneInvalid} helperText={phoneInvalid ? t('validation.invalidPhone') : undefined}
                slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'waitlist-join-phone' } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={submit} disabled={busy} data-testid="waitlist-join-submit">
              {busy ? <CircularProgress size={20} color="inherit" /> : t('waitlist.joinSubmit')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
