import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, TextField,
  Switch, FormControlLabel, Stack, Alert, CircularProgress,
  Divider, Accordion, AccordionSummary, AccordionDetails,
  InputAdornment, IconButton,
} from '@mui/material'
import { ExpandMore as ExpandMoreIcon } from '@/components/icons'
import { VisibilityOutlined as VisibilityOutlinedIcon } from '@/components/icons'
import { VisibilityOffOutlined as VisibilityOffOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, useToast } from '@/components/ui'
import { FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'

interface PaymentConfig {
  bog?: { merchantId?: string; apiKey?: string; enabled?: boolean }
  tbc?: { merchantId?: string; apiKey?: string; enabled?: boolean }
}

export default function PaymentSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [config, setConfig] = useState<PaymentConfig>({
    bog: { merchantId: '', apiKey: '', enabled: false },
    tbc: { merchantId: '', apiKey: '', enabled: false },
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBogKey, setShowBogKey] = useState(false)
  const [showTbcKey, setShowTbcKey] = useState(false)

  // Cancellation / deposit-refund policy (migration 089). Deposits themselves
  // are configured per service (ServicesSettings); this policy governs whether a
  // cancel refunds the deposit and is consumed by self-service cancel (Phase 3).
  const [cancelWindow, setCancelWindow] = useState('24')
  const [depositRefundable, setDepositRefundable] = useState(true)
  const cancelWindowInvalid = !(Number(cancelWindow) >= 0) || !Number.isInteger(Number(cancelWindow))
  // Accordions are controlled so we can auto-expand a provider when it's
  // enabled — otherwise its required credential fields stay hidden behind a
  // collapsed panel and the disabled Save button has no visible explanation.
  const [bogExpanded, setBogExpanded] = useState(false)
  const [tbcExpanded, setTbcExpanded] = useState(false)

  useEffect(() => {
    if (org) {
      const pc = (org as unknown as Record<string, PaymentConfig>).payment_config
      if (pc) {
        setConfig({
          bog: { merchantId: '', apiKey: '', enabled: false, ...(pc.bog ?? {}) },
          tbc: { merchantId: '', apiKey: '', enabled: false, ...(pc.tbc ?? {}) },
        })
        if (pc.bog?.enabled) setBogExpanded(true)
        if (pc.tbc?.enabled) setTbcExpanded(true)
      }
      setCancelWindow(String(org.cancellation_window_hours ?? 24))
      setDepositRefundable(org.deposit_refundable ?? true)
    }
  }, [org])

  function setBog(field: string, val: string | boolean) {
    setConfig(c => ({ ...c, bog: { ...c.bog, [field]: val } }))
  }
  function setTbc(field: string, val: string | boolean) {
    setConfig(c => ({ ...c, tbc: { ...c.tbc, [field]: val } }))
  }

  // Enabling a provider reveals its credential fields; the user can still
  // collapse the panel afterwards if they wish.
  function toggleBogEnabled(enabled: boolean) {
    setBog('enabled', enabled)
    if (enabled) setBogExpanded(true)
  }
  function toggleTbcEnabled(enabled: boolean) {
    setTbc('enabled', enabled)
    if (enabled) setTbcExpanded(true)
  }

  // When a provider is enabled, its credentials are required.
  const bogEnabled = config.bog?.enabled ?? false
  const tbcEnabled = config.tbc?.enabled ?? false
  const bogMerchantMissing = bogEnabled && !(config.bog?.merchantId ?? '').trim()
  const bogKeyMissing = bogEnabled && !(config.bog?.apiKey ?? '').trim()
  const tbcMerchantMissing = tbcEnabled && !(config.tbc?.merchantId ?? '').trim()
  const tbcKeyMissing = tbcEnabled && !(config.tbc?.apiKey ?? '').trim()
  const credentialsMissing =
    bogMerchantMissing || bogKeyMissing || tbcMerchantMissing || tbcKeyMissing

  async function handleSave() {
    if (!org) return
    // The missing credential fields already carry inline errors — just pull
    // the first one into view (it may be inside a collapsed panel, so expand).
    if (credentialsMissing) {
      if (bogMerchantMissing || bogKeyMissing) setBogExpanded(true)
      if (tbcMerchantMissing || tbcKeyMissing) setTbcExpanded(true)
      focusFirstInvalidFieldAfterRender()
      return
    }
    if (cancelWindowInvalid) {
      focusFirstInvalidFieldAfterRender()
      return
    }
    setSaving(true)
    setError(null)

    const { error: err } = await supabase
      .from('organisations')
      .update({
        payment_config: config,
        cancellation_window_hours: Number(cancelWindow),
        deposit_refundable: depositRefundable,
      })
      .eq('id', org.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    toast.success(t('common.saved'))
  }

  return (
    <Box>
      <PageHeader title={t('settings.payment')} />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Alert severity="info" sx={{ mb: 3 }}>
        {t('settings.paymentInfo')}
      </Alert>

      <Stack spacing={2}>
        {/* Cancellation / deposit-refund policy. Deposits are set per service
            (Services settings); this governs what a cancellation refunds. */}
        <Card>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>{t('settings.cancellationTitle')}</Typography>
            <TextField
              value={cancelWindow}
              onChange={e => setCancelWindow(e.target.value.replace(/[^0-9]/g, ''))}
              size="small"
              label={t('settings.cancellationWindowHours')}
              error={cancelWindowInvalid}
              helperText={cancelWindowInvalid ? t('settings.cancellationWindowInvalid') : t('settings.cancellationWindowHelp')}
              slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'org-cancel-window' } }}
              sx={{ maxWidth: 240 }}
            />
            <FormControlLabel
              sx={{ mt: 1.5, display: 'block' }}
              control={
                <Switch
                  checked={depositRefundable}
                  onChange={e => setDepositRefundable(e.target.checked)}
                  data-testid="org-deposit-refundable"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('settings.depositRefundable')}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('settings.depositRefundableHelp')}</Typography>
                </Box>
              }
            />
          </CardContent>
        </Card>

        {/* BOG Pay */}
        <Accordion expanded={bogExpanded} onChange={(_, exp) => setBogExpanded(exp)}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('settings.bogTitle')}
              </Typography>
              <Switch
                checked={config.bog?.enabled ?? false}
                onChange={e => toggleBogEnabled(e.target.checked)}
                onClick={e => e.stopPropagation()}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t('settings.bogComingSoon')}
              </Alert>
              <TextField
                required
                label={t('settings.merchantId')}
                value={config.bog?.merchantId ?? ''}
                onChange={e => setBog('merchantId', e.target.value)}
                fullWidth
                size="small"
                error={bogMerchantMissing}
                helperText={bogMerchantMissing ? t('validation.requiredWhenEnabled') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.paymentField } }}
              />
              <TextField
                required
                label={t('settings.apiKey')}
                type={showBogKey ? 'text' : 'password'}
                value={config.bog?.apiKey ?? ''}
                onChange={e => setBog('apiKey', e.target.value)}
                fullWidth
                size="small"
                error={bogKeyMissing}
                helperText={bogKeyMissing ? t('validation.requiredWhenEnabled') : undefined}
                slotProps={{
                  htmlInput: { maxLength: FIELD_LIMITS.paymentField },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" aria-label={showBogKey ? 'hide' : 'show'} onClick={() => setShowBogKey(s => !s)} edge="end">
                          {showBogKey ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Stack>
          </AccordionDetails>
        </Accordion>

        {/* TBC Pay */}
        <Accordion expanded={tbcExpanded} onChange={(_, exp) => setTbcExpanded(exp)}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('settings.tbcTitle')}
              </Typography>
              <Switch
                checked={config.tbc?.enabled ?? false}
                onChange={e => toggleTbcEnabled(e.target.checked)}
                onClick={e => e.stopPropagation()}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <Alert severity="warning" sx={{ mb: 1 }}>
                {t('settings.tbcComingSoon')}
              </Alert>
              <TextField
                required
                label={t('settings.clientId')}
                value={config.tbc?.merchantId ?? ''}
                onChange={e => setTbc('merchantId', e.target.value)}
                fullWidth
                size="small"
                error={tbcMerchantMissing}
                helperText={tbcMerchantMissing ? t('validation.requiredWhenEnabled') : undefined}
                slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.paymentField } }}
              />
              <TextField
                required
                label={t('settings.clientKey')}
                type={showTbcKey ? 'text' : 'password'}
                value={config.tbc?.apiKey ?? ''}
                onChange={e => setTbc('apiKey', e.target.value)}
                fullWidth
                size="small"
                error={tbcKeyMissing}
                helperText={tbcKeyMissing ? t('validation.requiredWhenEnabled') : undefined}
                slotProps={{
                  htmlInput: { maxLength: FIELD_LIMITS.paymentField },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" aria-label={showTbcKey ? 'hide' : 'show'} onClick={() => setShowTbcKey(s => !s)} edge="end">
                          {showTbcKey ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
        </Button>
      </Box>
    </Box>
  )
}
