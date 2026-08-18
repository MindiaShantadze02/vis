import { useEffect, useState } from 'react'
import {
  Box, Typography, Card, CardContent, TextField, Button, Link, CircularProgress,
  Checkbox, FormControlLabel,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { displayGeorgianPhone, PASSWORD_MIN } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import { PageHeader, useToast, SideDrawer, FormErrorAlert } from '@/components/ui'

const RESEND_COOLDOWN_SECONDS = 60

/**
 * Map reset-password's error codes onto copy. Everything else (including
 * 'no_account', which cannot happen for a signed-in user) folds into the
 * generic wrong-or-expired message. Mirrors ForgotPasswordPage.
 */
function passwordCodeErrorKey(code: string): string {
  switch (code) {
    case 'too_many_attempts': return 'auth.otpTooMany'
    case 'expired':           return 'auth.otpExpired'
    case 'weak_password':     return 'validation.passwordTooShortReset'
    default:                  return 'auth.resetCodeInvalid'
  }
}

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

  // Change password — two steps, gated on an SMS code to the account's own
  // phone. A live session alone is no longer enough: an unlocked laptop, a
  // borrowed device or a stolen session token could otherwise be used to take
  // the account over silently, and a password change is the one action that
  // locks the real owner out.
  //
  // Reuses the recovery pair (request-password-reset → reset-password) rather
  // than a new endpoint: the same hashed challenge, 5-attempt budget summed
  // across live challenges, 60s resend cooldown and SMS-pumping caps all apply
  // unchanged. The phone always comes from the SESSION, never from an input, so
  // the code can only ever go to the account's own number.
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [pwStep, setPwStep] = useState<'form' | 'code'>('form')
  const [pwCode, setPwCode] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  // Set on the first submit attempt: from then on empty fields are flagged
  // inline too (before that, only typed-but-invalid values are).
  const [submitted, setSubmitted] = useState(false)

  const passwordTooShort = (submitted || newPassword.length > 0) && newPassword.length < PASSWORD_MIN
  const passwordMismatch = (submitted || confirmNewPassword.length > 0) && newPassword !== confirmNewPassword
  const codeValid = /^\d{6}$/.test(pwCode)
  const codeInvalid = submitted && !codeValid

  // Tick the resend cooldown down (mirrors ForgotPasswordPage).
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  function resetPasswordForm() {
    setNewPassword('')
    setConfirmNewPassword('')
    setPwCode('')
    setPwError(null)
    setSubmitted(false)
    setPwStep('form')
  }

  /** Step 1: validate the new password, then text a code to the account phone. */
  async function sendPasswordCode(isResend = false) {
    // Validated on click with inline field errors — the button never blocks
    // silently; the first invalid field is pulled into view.
    setSubmitted(true)
    if (newPassword.length < PASSWORD_MIN || newPassword !== confirmNewPassword) {
      focusFirstInvalidFieldAfterRender()
      return
    }
    setPwError(null)
    setChangingPassword(true)
    // Always resolves ok — the function is deliberately neutral about whether a
    // phone has an account. Ours does, since we are signed in as it.
    await supabase.functions.invoke('request-password-reset', {
      body: { phone: user?.phone ?? '' },
    })
    setChangingPassword(false)
    setResendIn(RESEND_COOLDOWN_SECONDS)
    if (!isResend) {
      // Fresh step, fresh field — don't pre-flag the code as missing.
      setSubmitted(false)
      setPwStep('code')
    }
  }

  /** Step 2: hand the code + new password to the same function recovery uses. */
  async function submitPasswordChange() {
    setSubmitted(true)
    if (!codeValid) { focusFirstInvalidFieldAfterRender(); return }
    setPwError(null)
    setChangingPassword(true)
    const { data, error: fnErr } = await supabase.functions.invoke('reset-password', {
      body: { phone: user?.phone ?? '', code: pwCode, newPassword },
    })
    setChangingPassword(false)
    if (fnErr || !data?.ok) {
      setPwError(t(passwordCodeErrorKey(data?.error ?? '')))
      return
    }
    resetPasswordForm()
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

          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('settings.changePassword')}
          </Typography>
          {/* Only on step 1 — once the code is out, the line below it says so
              and this would just repeat a promise already kept. */}
          {pwStep === 'form' && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              {t('settings.changePasswordHint')}
            </Typography>
          )}

          <FormErrorAlert message={pwError} data-testid="account-password-error" />

          {pwStep === 'form' ? (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mb: 1.5 }}>
                <TextField
                  size="small"
                  type="password"
                  label={t('settings.newPassword')}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  error={passwordTooShort}
                  helperText={passwordTooShort ? t('validation.passwordTooShortReset') : t('validation.passwordHint')}
                  slotProps={{ htmlInput: { autoComplete: 'new-password', 'data-testid': 'account-new-password' } }}
                />
                <TextField
                  size="small"
                  type="password"
                  label={t('auth.confirmPassword')}
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  error={passwordMismatch}
                  helperText={passwordMismatch ? t('validation.passwordMismatch') : ' '}
                  slotProps={{ htmlInput: { autoComplete: 'new-password', 'data-testid': 'account-confirm-password' } }}
                />
              </Box>
              <Button
                variant="outlined"
                size="small"
                onClick={() => sendPasswordCode()}
                disabled={changingPassword}
                data-testid="account-change-password"
              >
                {changingPassword ? <CircularProgress size={18} color="inherit" /> : t('settings.sendPasswordCode')}
              </Button>
            </>
          ) : (
            <>
              {/* Step 2 — the code went to the account's own phone, which is
                  printed above, so there is nothing to type but the code. */}
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }} data-testid="account-code-sent">
                {t('settings.passwordCodeSent', { phone: displayGeorgianPhone(user?.phone) })}
              </Typography>
              <TextField
                size="small"
                label={t('auth.codeLabel')}
                value={pwCode}
                onChange={e => setPwCode(e.target.value.replace(/\D/g, ''))}
                error={codeInvalid}
                helperText={codeInvalid ? t('auth.otpEnterCode') : ' '}
                sx={{ maxWidth: 200, mb: 1.5, display: 'block' }}
                slotProps={{ htmlInput: { inputMode: 'numeric' as const, maxLength: 6, 'data-testid': 'account-password-code' } }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={submitPasswordChange}
                  disabled={changingPassword}
                  data-testid="account-confirm-password-change"
                >
                  {changingPassword ? <CircularProgress size={18} color="inherit" /> : t('settings.changePassword')}
                </Button>
                <Button size="small" onClick={resetPasswordForm} disabled={changingPassword}>
                  {t('common.cancel')}
                </Button>
                <Button
                  size="small"
                  onClick={() => sendPasswordCode(true)}
                  disabled={changingPassword || resendIn > 0}
                  data-testid="account-resend-code"
                >
                  {resendIn > 0 ? t('auth.resendCodeCooldown', { s: resendIn }) : t('auth.otpResend')}
                </Button>
              </Box>
            </>
          )}
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
      <SideDrawer
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        disableClose={deleting}
        title={t('settings.deleteAccountTitle')}
        actions={
          <>
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
          </>
        }
      >
        <Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('settings.deleteAccountMessage')}
          </Typography>
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
        </Box>
      </SideDrawer>
    </Box>
  )
}
