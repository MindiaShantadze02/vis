import { useEffect, useState } from 'react'
import {
  Box, Card, Typography, TextField, Button, Chip, Stack, CircularProgress,
} from '@mui/material'
import { Add as AddIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, useToast } from '@/components/ui'
import { isValidGeorgianPhone, displayGeorgianPhone } from '@/lib/validation'

interface SuperadminRow {
  user_id: string
  /** Bare 9-digit national number; formatted for display, never stored formatted. */
  phone: string
  /** Often null — most accounts sign in with a phone and never set one. */
  email: string | null
  created_at: string
}

const ERRORS: Record<string, string> = {
  invalid_phone: 'ნომერი არასწორია',
  user_not_found: 'ამ ნომრით მომხმარებელი ვერ მოიძებნა',
  last_superadmin: 'ბოლო სუპერ-ადმინის წაშლა შეუძლებელია',
  not_authorized: 'წვდომა აკრძალულია',
}

export default function SuperadminsPage() {
  const { user } = useAuth()
  const toast = useToast()

  const [rows, setRows] = useState<SuperadminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [toRemove, setToRemove] = useState<SuperadminRow | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.rpc('list_superadmins')
    setRows((data ?? []) as SuperadminRow[])
    setLoading(false)
  }

  async function add() {
    const value = phone.trim()
    // Validate on click rather than disabling the button (house convention), and
    // let the server re-check: normalize_ge_phone is the authority, this is just
    // a faster answer for the obvious cases.
    if (!isValidGeorgianPhone(value)) { toast.error(ERRORS.invalid_phone); return }
    setAdding(true)
    const { data, error } = await supabase.rpc('add_superadmin', { p_phone: value })
    setAdding(false)
    if (error) { toast.error(error.message); return }
    const res = data as { ok: boolean; error?: string }
    if (!res.ok) { toast.error(ERRORS[res.error ?? ''] ?? res.error ?? 'შეცდომა'); return }
    toast.success('სუპერ-ადმინი დაემატა')
    setPhone('')
    load()
  }

  async function remove() {
    if (!toRemove) return
    setRemoving(true)
    const { data, error } = await supabase.rpc('remove_superadmin', { p_user_id: toRemove.user_id })
    setRemoving(false)
    if (error) { toast.error(error.message); setToRemove(null); return }
    const res = data as { ok: boolean; error?: string }
    if (!res.ok) { toast.error(ERRORS[res.error ?? ''] ?? res.error ?? 'შეცდომა'); setToRemove(null); return }
    toast.success('სუპერ-ადმინი წაიშალა')
    setToRemove(null)
    load()
  }

  return (
    <Box sx={{ maxWidth: 720 }}>
      <PageHeader title="სუპერ-ადმინები" subtitle="პლატფორმის ადმინისტრატორების მართვა" />

      {/* Add by phone — the app's sign-in identifier. */}
      <Card sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>ახალი სუპერ-ადმინი</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth required size="small" type="tel"
              label="ტელეფონის ნომერი"
              placeholder="+995 5XX XX XX XX"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              slotProps={{ htmlInput: { inputMode: 'tel', 'data-testid': 'sa-admin-phone' } }}
            />
            <Button
              variant="contained"
              startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
              onClick={add}
              disabled={adding}
              sx={{ whiteSpace: 'nowrap' }}
            >
              დამატება
            </Button>
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
            მომხმარებელს უკვე უნდა ჰქონდეს vis-ის ანგარიში ამ ნომრით — სუპერ-ადმინობა
            არსებულ ანგარიშს ენიჭება, ახალს არ ქმნის.
          </Typography>
        </Box>
      </Card>

      {/* Roster */}
      <Card>
        {loading
          ? <LoadingState />
          : rows.length === 0
          ? <EmptyState title="სუპერ-ადმინები არ არის" />
          : rows.map((r, i) => (
            <Box
              key={r.user_id}
              sx={{
                display: 'flex', alignItems: 'center', gap: 2,
                px: 3, py: 2,
                borderBottom: i < rows.length - 1 ? '1px solid' : 'none', borderColor: 'divider',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {displayGeorgianPhone(r.phone)}
                  </Typography>
                  {r.user_id === user?.id && <Chip label="თქვენ" size="small" color="primary" variant="outlined" />}
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {r.email ? `${r.email} · ` : ''}დაემატა {format(new Date(r.created_at), 'dd MMM yyyy')}
                </Typography>
              </Box>
              <ActionIconButton tone="danger" aria-label="წაშლა" onClick={() => setToRemove(r)}>
                <DeleteOutlinedIcon fontSize="small" />
              </ActionIconButton>
            </Box>
          ))
        }
      </Card>

      <ConfirmDialog
        open={!!toRemove}
        title="სუპერ-ადმინის წაშლა"
        message={toRemove ? `წავშალოთ ${displayGeorgianPhone(toRemove.phone)} სუპერ-ადმინების სიიდან?` : ''}
        confirmLabel="წაშლა"
        loading={removing}
        onConfirm={remove}
        onClose={() => setToRemove(null)}
      />
    </Box>
  )
}
