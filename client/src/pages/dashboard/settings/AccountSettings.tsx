import { useState } from 'react'
import {
  Box, Typography, Card, CardContent, TextField, Button, Link, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Checkbox, FormControlLabel,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { PageHeader, useToast } from '@/components/ui'
import { LAYOUT } from '@/theme/theme'

/**
 * Account settings — the danger zone (delete account / organisation). Kept in its
 * own destructive-actions area, separate from business/booking settings.
 */
export default function AccountSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const toast = useToast()
  const navigate = useNavigate()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [soleMember, setSoleMember] = useState(false)
  const [deleteOrgToo, setDeleteOrgToo] = useState(true)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Open the delete dialog, first checking whether the user is the only login
  // member of the org (which surfaces the "delete the organisation too" choice).
  async function openDeleteDialog() {
    if (!org) return
    const { count } = await supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .not('user_id', 'is', null)
    const sole = (count ?? 0) <= 1
    setSoleMember(sole)
    setDeleteOrgToo(sole) // default to removing the org when no one else is left
    setDeleteConfirmText('')
    setDeleteOpen(true)
  }

  async function handleDeleteAccount() {
    if (!org) return
    setDeleting(true)
    const { error: err } = await supabase.functions.invoke('delete-account', {
      body: { orgId: org.id, deleteOrg: soleMember && deleteOrgToo },
    })
    if (err) {
      setDeleting(false)
      setDeleteOpen(false)
      toast.error(t('settings.deleteAccountFailed'))
      return
    }
    await supabase.auth.signOut()
    toast.success(t('settings.accountDeleted'))
    navigate('/login')
  }

  return (
    <Box sx={{ maxWidth: LAYOUT.formPage }}>
      <PageHeader title={t('settings.account')} />

      <Card sx={{ borderColor: 'error.light' }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'error.main', mb: 0.5 }}>
            {t('settings.dangerZone')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('settings.deleteAccountMessage')}
          </Typography>
          <Link
            component="button"
            type="button"
            onClick={openDeleteDialog}
            data-testid="delete-account-btn"
            underline="hover"
            sx={{ color: 'error.main', fontSize: 14, fontWeight: 600 }}
          >
            {t('settings.deleteAccount')}
          </Link>
        </CardContent>
      </Card>

      {/* Delete account confirmation */}
      <Dialog open={deleteOpen} onClose={deleting ? undefined : () => setDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('settings.deleteAccountTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: 'text.secondary' }}>
            {t('settings.deleteAccountMessage')}
          </DialogContentText>
          {soleMember ? (
            <FormControlLabel
              sx={{ mt: 2 }}
              control={
                <Checkbox
                  checked={deleteOrgToo}
                  onChange={e => setDeleteOrgToo(e.target.checked)}
                  data-testid="delete-org-too"
                />
              }
              label={t('settings.deleteOrgToo', { name: org?.name ?? '' })}
            />
          ) : (
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
              {t('settings.deleteAccountKeepOrg')}
            </Typography>
          )}

          {/* Require the user to type the confirmation word — a deliberate
              friction step for an irreversible action. */}
          <Typography variant="body2" sx={{ mt: 3, color: 'text.secondary' }}>
            {t('settings.deleteConfirmPrompt', { word: t('settings.deleteConfirmWord') })}
          </Typography>
          <TextField
            fullWidth
            size="small"
            autoComplete="off"
            sx={{ mt: 1 }}
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            placeholder={t('settings.deleteConfirmWord')}
            disabled={deleting}
            slotProps={{ htmlInput: { 'data-testid': 'delete-confirm-input' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDeleteAccount}
            disabled={
              deleting ||
              deleteConfirmText.trim().toLowerCase() !== t('settings.deleteConfirmWord').toLowerCase()
            }
            variant="contained"
            color="error"
            data-testid="delete-account-confirm"
          >
            {deleting ? <CircularProgress size={20} color="inherit" /> : t('settings.deleteAccount')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
