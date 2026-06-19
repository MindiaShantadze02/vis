import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, Button, TextField,
  Switch, FormControlLabel, Stack, Alert, CircularProgress,
  Divider, Accordion, AccordionSummary, AccordionDetails,
  InputAdornment, IconButton,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, useToast } from '@/components/ui'
import { FIELD_LIMITS } from '@/lib/validation'
import { LAYOUT } from '@/theme/theme'

interface PaymentConfig {
  bog?: { merchantId?: string; apiKey?: string; enabled?: boolean }
  tbc?: { merchantId?: string; apiKey?: string; enabled?: boolean }
  inPerson?: { enabled?: boolean }
}

export default function PaymentSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()

  const [config, setConfig] = useState<PaymentConfig>({
    bog: { merchantId: '', apiKey: '', enabled: false },
    tbc: { merchantId: '', apiKey: '', enabled: false },
    inPerson: { enabled: true },
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBogKey, setShowBogKey] = useState(false)
  const [showTbcKey, setShowTbcKey] = useState(false)

  useEffect(() => {
    if (org) {
      const pc = (org as unknown as Record<string, PaymentConfig>).payment_config
      if (pc) {
        setConfig({
          bog: { merchantId: '', apiKey: '', enabled: false, ...(pc.bog ?? {}) },
          tbc: { merchantId: '', apiKey: '', enabled: false, ...(pc.tbc ?? {}) },
          inPerson: { enabled: true, ...(pc.inPerson ?? {}) },
        })
      }
    }
  }, [org])

  function setBog(field: string, val: string | boolean) {
    setConfig(c => ({ ...c, bog: { ...c.bog, [field]: val } }))
  }
  function setTbc(field: string, val: string | boolean) {
    setConfig(c => ({ ...c, tbc: { ...c.tbc, [field]: val } }))
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
    if (credentialsMissing) { setError(t('validation.requiredWhenEnabled')); return }
    setSaving(true)
    setError(null)

    const { error: err } = await supabase
      .from('organisations')
      .update({ payment_config: config })
      .eq('id', org.id)

    setSaving(false)
    if (err) { setError(err.message); return }
    toast.success(t('common.saved'))
  }

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader title={t('settings.payment')} />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Alert severity="info" sx={{ mb: 3 }}>
        {t('settings.paymentInfo')}
      </Alert>

      <Stack spacing={2}>
        {/* In-person */}
        <Card>
          <CardContent sx={{ p: 3 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={config.inPerson?.enabled ?? true}
                  onChange={e => setConfig(c => ({ ...c, inPerson: { enabled: e.target.checked } }))}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('settings.inPersonPayment')}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('settings.inPersonPaymentHelp')}
                  </Typography>
                </Box>
              }
            />
          </CardContent>
        </Card>

        {/* BOG Pay */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('settings.bogTitle')}
              </Typography>
              <Switch
                checked={config.bog?.enabled ?? false}
                onChange={e => setBog('enabled', e.target.checked)}
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
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('settings.tbcTitle')}
              </Typography>
              <Switch
                checked={config.tbc?.enabled ?? false}
                onChange={e => setTbc('enabled', e.target.checked)}
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
        <Button variant="contained" onClick={handleSave} disabled={saving || credentialsMissing}>
          {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
        </Button>
      </Box>
    </Box>
  )
}
