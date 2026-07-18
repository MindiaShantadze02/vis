import { useCallback, useEffect, useState } from 'react'
import {
  Box, Typography, Card, Button, TextField, Stack, Alert, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Divider,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { ContentCopyOutlined as ContentCopyOutlinedIcon } from '@/components/icons'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { PageHeader, LoadingState, useToast, SideDrawer } from '@/components/ui'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`

/**
 * Settings → API keys: mint/revoke keys for the public REST API (migration
 * 071 + the `api` edge function). The full key is shown exactly once, at
 * creation — only its sha256 + display prefix are stored.
 */
export default function ApiKeysSettings() {
  const { t, i18n } = useTranslation()
  const toast = useToast()

  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create dialog: name entry → show-once key reveal.
  const [createOpen, setCreateOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  // Set on the first Create attempt: flags the empty name inline.
  const [createSubmitted, setCreateSubmitted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)

  // Revoke confirm dialog
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null)
  const [revoking, setRevoking] = useState(false)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('api_keys')
      .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setKeys((data ?? []) as ApiKeyRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createKey() {
    // Flag the empty name inline and pull it into view instead of toasting.
    setCreateSubmitted(true)
    if (!keyName.trim()) {
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDialog-root') ?? document)
      return
    }
    setCreating(true)
    const { data, error: err } = await supabase.rpc('create_api_key', { p_name: keyName.trim() })
    setCreating(false)
    if (err) {
      const msg = err.message.includes('key_limit_reached')
        ? t('settings.apiKeyLimitReached')
        : err.message
      toast.error(msg)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setNewKey(row.key)
    load()
  }

  async function revokeKey() {
    if (!revokeTarget) return
    setRevoking(true)
    const { error: err } = await supabase.rpc('revoke_api_key', { p_id: revokeTarget.id })
    setRevoking(false)
    setRevokeTarget(null)
    if (err) { toast.error(err.message); return }
    toast.success(t('settings.apiKeyRevoked'))
    load()
  }

  function copyKey() {
    if (!newKey) return
    navigator.clipboard.writeText(newKey)
    toast.success(t('common.copied'))
  }

  function closeCreate() {
    setCreateOpen(false)
    setKeyName('')
    setNewKey(null)
    setCreateSubmitted(false)
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language)

  if (loading) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title={t('settings.apiKeys')}
        subtitle={t('settings.apiKeysSubtitle')}
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
            data-testid="create-api-key"
          >
            {t('settings.createApiKey')}
          </Button>
        }
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        {t('settings.apiKeysHint')}{' '}
        <Box component="code" sx={{ fontSize: 12, wordBreak: 'break-all' }}>{API_BASE}/v1/…</Box>
      </Alert>

      <Card>
        {keys.length === 0 ? (
          <Typography sx={{ p: 3, color: 'text.secondary' }}>
            {t('settings.apiKeysEmpty')}
          </Typography>
        ) : (
          <Stack divider={<Divider />}>
            {keys.map(k => (
              <Box key={k.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>{k.name}</Typography>
                    {k.revoked_at && (
                      <Chip size="small" label={t('settings.apiKeyRevokedChip')} color="default" />
                    )}
                  </Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                    {k.key_prefix}…
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('settings.apiKeyCreated', { date: fmtDate(k.created_at) })}
                    {' · '}
                    {k.last_used_at
                      ? t('settings.apiKeyLastUsed', { date: fmtDate(k.last_used_at) })
                      : t('settings.apiKeyNeverUsed')}
                  </Typography>
                </Box>
                {!k.revoked_at && (
                  <Button color="error" size="small" onClick={() => setRevokeTarget(k)} data-testid="api-key-revoke">
                    {t('settings.revokeApiKey')}
                  </Button>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Card>

      {/* Create drawer — turns into the show-once reveal after minting. */}
      <SideDrawer
        open={createOpen}
        onClose={closeCreate}
        disableClose={creating}
        title={t('settings.createApiKey')}
        actions={
          newKey ? (
            <Button variant="contained" onClick={closeCreate} data-testid="api-key-done">{t('common.done')}</Button>
          ) : (
            <>
              <Button onClick={closeCreate} disabled={creating}>{t('common.cancel')}</Button>
              <Button variant="contained" onClick={createKey} disabled={creating} data-testid="api-key-create-submit">
                {t('common.create')}
              </Button>
            </>
          )
        }
      >
        <Box>
          {newKey ? (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('settings.apiKeyShownOnce')}
              </Alert>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                p: 1.5, borderRadius: 1, bgcolor: 'action.hover',
              }}>
                <Typography sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', flex: 1 }} data-testid="new-api-key">
                  {newKey}
                </Typography>
                <IconButton size="small" onClick={copyKey} aria-label={t('common.copy')}>
                  <ContentCopyOutlinedIcon fontSize="small" />
                </IconButton>
              </Box>
            </>
          ) : (
            <TextField
              autoFocus
              fullWidth
              label={t('settings.apiKeyName')}
              placeholder={t('settings.apiKeyNamePlaceholder')}
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              error={createSubmitted && !keyName.trim()}
              helperText={createSubmitted && !keyName.trim() ? t('validation.required') : undefined}
              slotProps={{ htmlInput: { maxLength: 60, 'data-testid': 'api-key-name' } }}
              sx={{ mt: 1 }}
            />
          )}
        </Box>
      </SideDrawer>

      {/* Revoke confirm */}
      <Dialog open={!!revokeTarget} onClose={revoking ? undefined : () => setRevokeTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('settings.revokeApiKey')}</DialogTitle>
        <DialogContent>
          <Typography>{t('settings.revokeApiKeyMessage', { name: revokeTarget?.name ?? '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={revoking}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" onClick={revokeKey} disabled={revoking} data-testid="api-key-confirm-revoke">
            {t('settings.revokeApiKey')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
