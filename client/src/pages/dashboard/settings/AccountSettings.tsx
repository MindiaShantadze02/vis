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
import { useAuth } from '@/contexts/AuthContext'
import { displayGeorgianPhone, PASSWORD_MIN } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import { PageHeader, useToast } from '@/components/ui'

/**
 * Account settings — who you're signed in as, password change, and the danger
 * zone (delete account / organisation) kept last as its own destructive area.
 */
export default function AccountSettings() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  // Change password — no "current password" field: the user is already
  // authenticated, and Supabase updateUser only needs the session.
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  // Set on the first submit attempt: from then on empty fields are flagged
  // inline too (before that, only typed-but-invalid values are).
  const [submitted, setSubmitted] = useState(false)

  const passwordTooShort = (submitted || newPassword.length > 0) && newPassword.length < PASSWORD_MIN
  const passwordMismatch = (submitted || confirmNewPassword.length > 0) && newPassword !== confirmNewPassword

  async function handleChangePassword() {
    // Validated on click with inline field errors — the button never blocks
    // silently; the first invalid field is pulled into view.
    setSubmitted(true)
    if (newPassword.length < PASSWORD_MIN || newPassword !== confirmNewPassword) {
      focusFirstInvalidFieldAfterRender()
      return
    }
    setChangingPassword(true)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)
    if (err) { toast.error(t('settings.passwordChangeFailed')); return }
    setNewPassword('')
    setConfirmNewPassword('')
    setSubmitted(false)
    toast.success(t('settings.passwordChanged'))
  }

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [soleMember, setSoleMember] = useState(false)
  const [deleteOrgToo, setDeleteOrgToo] = useState(true)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteWordError, setDeleteWordError] = useState(false)
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
    // The typed word is the friction step — checked on click with a visible
    // message instead of silently disabling the destructive button.
    if (deleteConfirmText.trim().toLowerCase() !== t('settings.deleteConfirmWord').toLowerCase()) {
      setDeleteWordError(true)
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDialog-root') ?? document)
      return
    }
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
    <Box>
      <PageHeader title={t('settings.account')} />

      {/* Who you're signed in as — the page previously held only the danger
          zone, with no way to see your login phone or change the password. */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('settings.loginInfo')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('settings.loggedInAs')}{' '}
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {displayGeorgianPhone(user?.phone)}
            </Box>
          </Typography>

          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
            {t('settings.changePassword')}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mb: 1.5 }}>
            <TextField
              size="small"
              type="password"
              label={t('settings.newPassword')}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              error={passwordTooShort}
              helperText={passwordTooShort ? t('validation.passwordTooShortReset') : t('validation.passwordHint')}
              slotProps={{ htmlInput: { 'data-testid': 'account-new-password' } }}
            />
            <TextField
              size="small"
              type="password"
              label={t('auth.confirmPassword')}
              value={confirmNewPassword}
              onChange={e => setConfirmNewPassword(e.target.value)}
              error={passwordMismatch}
              helperText={passwordMismatch ? t('validation.passwordMismatch') : ' '}
              slotProps={{ htmlInput: { 'data-testid': 'account-confirm-password' } }}
            />
          </Box>
          <Button
            variant="outlined"
            size="small"
            onClick={handleChangePassword}
            disabled={changingPassword}
            data-testid="account-change-password"
          >
            {changingPassword ? <CircularProgress size={18} color="inherit" /> : t('settings.changePassword')}
          </Button>
        </CardContent>
      </Card>

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
            onChange={e => { setDeleteConfirmText(e.target.value); setDeleteWordError(false) }}
            placeholder={t('settings.deleteConfirmWord')}
            disabled={deleting}
            error={deleteWordError}
            helperText={deleteWordError ? t('settings.deleteConfirmPrompt', { word: t('settings.deleteConfirmWord') }) : undefined}
            slotProps={{ htmlInput: { 'data-testid': 'delete-confirm-input' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDeleteAccount}
            disabled={deleting}
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
