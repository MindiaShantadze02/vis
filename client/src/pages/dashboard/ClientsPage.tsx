import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, TextField, Chip, TablePagination, Tabs, Tab, Button, Stack,
  CircularProgress,
} from '@mui/material'
import { Search as SearchIcon } from '@/components/icons'
import { GroupOutlined as GroupOutlinedIcon } from '@/components/icons'
import { DeleteOutlined as DeleteOutlinedIcon } from '@/components/icons'
import { DoNotDisturbAltOutlined as BlockIcon } from '@/components/icons'
import { Add as AddIcon } from '@/components/icons'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/OrgContext'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, LoadingState, EmptyState, ConfirmDialog, ActionIconButton, SideDrawer, useToast } from '@/components/ui'
import { dateLocale } from '@/lib/dateLocale'
import { formatGeorgianPhone, isValidGeorgianPhone, FIELD_LIMITS } from '@/lib/validation'
import { focusFirstInvalidFieldAfterRender } from '@/lib/focusFirstInvalidField'
import { surface } from '@/theme/theme'

/** PostgREST may type a to-one relation as an array; normalize to one object. */
function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}

interface ClientRow {
  customerId: string
  firstName: string
  lastName: string | null
  phone: string
  count: number
  lastVisit: string
  // Any appointment id belonging to the client — the erase RPC is keyed by
  // appointment but anonymizes the shared customer record (all their visits).
  apptId: string
  erased: boolean
}

interface BlockedRow {
  id: string
  phone: string
  reason: string | null
  createdAt: string
}

/**
 * Client management — the org's distinct customers, with a per-client
 * "erase data" action (Art. 16 right to erasure) and a per-client block, plus a
 * second tab holding the org's blocklist.
 *
 * The block is enforced entirely server-side (blocked_customers + the
 * trg_zz_block_blocked_customer trigger, migration 20260819120000). Everything
 * here is presentation: hiding the button would not stop a booking, and showing
 * it does not grant one.
 */
export default function ClientsPage() {
  const { t } = useTranslation()
  const { org } = useOrg()
  const { user } = useAuth()
  const toast = useToast()

  const [tab, setTab] = useState<'clients' | 'blocked'>('clients')

  const [rows, setRows] = useState<ClientRow[]>([])
  const [blocked, setBlocked] = useState<BlockedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [confirmErase, setConfirmErase] = useState<ClientRow | null>(null)
  const [erasing, setErasing] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)

  // Block drawer — opened either from a client row (phone prefilled, read-only)
  // or from the blocklist's "add" button (phone typed by hand, for a number that
  // has never booked or whose client record was erased).
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockPhone, setBlockPhone] = useState('')
  const [blockPhoneLocked, setBlockPhoneLocked] = useState(false)
  const [blockName, setBlockName] = useState<string | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [blockSubmitted, setBlockSubmitted] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [confirmUnblock, setConfirmUnblock] = useState<BlockedRow | null>(null)
  const [unblocking, setUnblocking] = useState(false)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    const [{ data }, { data: blocks }] = await Promise.all([
      supabase
        .from('appointments')
        .select('id, customer_id, scheduled_at, customers(first_name, last_name, phone_number)')
        .eq('org_id', org.id)
        .order('scheduled_at', { ascending: false })
        .limit(5000),
      supabase
        .from('blocked_customers')
        .select('id, phone, reason, created_at')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false }),
    ])

    // Collapse the appointment rows into one entry per customer. Rows arrive
    // newest-first, so the first time we see a customer carries their latest
    // visit and (post-anonymization) their current name/phone.
    const byCustomer = new Map<string, ClientRow>()
    for (const raw of (data ?? [])) {
      const r = raw as Record<string, unknown>
      const customerId = r.customer_id as string | null
      if (!customerId) continue
      const c = pickOne(r.customers as never) as
        { first_name: string; last_name: string | null; phone_number: string } | null
      const existing = byCustomer.get(customerId)
      if (existing) {
        existing.count += 1
      } else {
        const phone = c?.phone_number ?? ''
        byCustomer.set(customerId, {
          customerId,
          firstName: c?.first_name ?? '—',
          lastName: c?.last_name ?? null,
          phone,
          count: 1,
          lastVisit: r.scheduled_at as string,
          apptId: r.id as string,
          erased: phone === '' || c?.first_name === 'erased',
        })
      }
    }
    setRows([...byCustomer.values()])
    setBlocked((blocks ?? []).map(b => ({
      id: b.id as string,
      phone: b.phone as string,
      reason: (b.reason as string | null) ?? null,
      createdAt: b.created_at as string,
    })))
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])

  // Phone → block row, so a client row can show its blocked state and offer
  // unblock without a second query.
  const blockedByPhone = useMemo(
    () => new Map(blocked.map(b => [b.phone, b])),
    [blocked],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      `${r.firstName} ${r.lastName ?? ''}`.toLowerCase().includes(q) ||
      r.phone.toLowerCase().includes(q),
    )
  }, [rows, search])

  const filteredBlocked = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return blocked
    return blocked.filter(b =>
      b.phone.includes(q) || (b.reason ?? '').toLowerCase().includes(q),
    )
  }, [blocked, search])

  // Reset to the first page whenever the filter or the tab changes.
  useEffect(() => { setPage(0) }, [search, tab])
  // Clamp the page if the list shrinks (e.g. after an erase) so we never render
  // an out-of-range, empty page.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filtered.length / rowsPerPage) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [filtered.length, rowsPerPage, page])
  const pageStart = page * rowsPerPage
  const paged = filtered.slice(pageStart, pageStart + rowsPerPage)

  async function eraseClient(row: ClientRow) {
    setErasing(true)
    const { error } = await supabase.rpc('erase_customer_data', { p_appointment_id: row.apptId })
    setErasing(false)
    setConfirmErase(null)
    if (error) { toast.error(error.message); return }
    toast.success(t('dashboard.eraseDone'))
    load()
  }

  function openBlockForClient(row: ClientRow) {
    setBlockPhone(row.phone)
    setBlockPhoneLocked(true)
    setBlockName(`${row.firstName} ${row.lastName ?? ''}`.trim())
    setBlockReason('')
    setBlockSubmitted(false)
    setBlockOpen(true)
  }

  function openBlockManual() {
    setBlockPhone('')
    setBlockPhoneLocked(false)
    setBlockName(null)
    setBlockReason('')
    setBlockSubmitted(false)
    setBlockOpen(true)
  }

  async function saveBlock() {
    if (!org) return
    // Validate on click with an inline field error rather than a disabled button.
    setBlockSubmitted(true)
    if (!isValidGeorgianPhone(blockPhone)) {
      focusFirstInvalidFieldAfterRender(document.querySelector('.MuiDrawer-root') ?? document)
      return
    }
    setBlocking(true)
    const { error } = await supabase.from('blocked_customers').insert({
      org_id: org.id,
      phone: formatGeorgianPhone(blockPhone),
      reason: blockReason.trim() || null,
      blocked_by: user?.id ?? null,
    })
    setBlocking(false)
    if (error) {
      // UNIQUE (org_id, phone) — already on the list, which is the state the
      // owner wanted anyway.
      toast.error(error.code === '23505' ? t('clients.alreadyBlocked') : error.message)
      return
    }
    setBlockOpen(false)
    toast.success(t('clients.blockDone'))
    load()
  }

  async function unblock(row: BlockedRow) {
    setUnblocking(true)
    const { error } = await supabase.from('blocked_customers').delete().eq('id', row.id)
    setUnblocking(false)
    setConfirmUnblock(null)
    if (error) { toast.error(error.message); return }
    toast.success(t('clients.unblockDone'))
    load()
  }

  const blockPhoneInvalid = blockSubmitted && !isValidGeorgianPhone(blockPhone)

  return (
    <Box>
      <PageHeader title={t('clients.title')} />

      {loading ? <LoadingState /> : (
        <>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v as 'clients' | 'blocked')}
            sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Tab label={t('clients.tabClients')} value="clients" data-testid="clients-tab-clients" />
            <Tab
              label={`${t('clients.tabBlocked')}${blocked.length ? ` (${blocked.length})` : ''}`}
              value="blocked"
              data-testid="clients-tab-blocked"
            />
          </Tabs>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder={`${t('common.search')}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              slotProps={{
                input: { startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 20 }} /> },
                htmlInput: { 'data-testid': 'clients-search' },
              }}
              sx={{ width: { xs: '100%', sm: 320 } }}
            />
            {tab === 'blocked' && (
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={openBlockManual}
                data-testid="block-add"
              >
                {t('clients.blockNumber')}
              </Button>
            )}
          </Box>

          {/* ── Clients ─────────────────────────────────────────────────── */}
          {tab === 'clients' && (
            filtered.length === 0 ? (
              <EmptyState icon={<GroupOutlinedIcon />} title={t('clients.empty')} />
            ) : (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
                {paged.map((row, i) => {
                  const block = row.phone ? blockedByPhone.get(row.phone) : undefined
                  return (
                    <Box
                      key={row.customerId}
                      data-testid="client-row"
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75,
                        borderBottom: i < paged.length - 1 ? '1px solid' : 'none',
                        borderColor: 'divider',
                        '&:hover': { bgcolor: surface.hover },
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                            {row.firstName} {row.lastName ?? ''}
                          </Typography>
                          {row.erased && (
                            <Chip size="small" label={t('clients.erased')} sx={{ height: 20, fontSize: 11 }} />
                          )}
                          {block && (
                            <Chip
                              size="small"
                              color="error"
                              variant="outlined"
                              label={t('clients.blocked')}
                              data-testid="client-blocked-chip"
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          )}
                        </Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {row.erased ? '—' : row.phone}
                        </Typography>
                      </Box>

                      <Box sx={{ textAlign: 'right', flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {t('clients.appointments', { n: row.count })}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {t('clients.lastVisit')}: {format(new Date(row.lastVisit), 'd MMM yyyy', { locale: dateLocale() })}
                        </Typography>
                      </Box>

                      {/* Block / unblock. Hidden for an erased client: their phone
                          is gone, so there is nothing left to block. */}
                      {!row.erased && (
                        <ActionIconButton
                          tone={block ? undefined : 'danger'}
                          aria-label={block ? t('clients.unblock') : t('clients.block')}
                          data-testid={block ? 'client-unblock' : 'client-block'}
                          onClick={() => (block ? setConfirmUnblock(block) : openBlockForClient(row))}
                        >
                          <BlockIcon fontSize="small" />
                        </ActionIconButton>
                      )}

                      <ActionIconButton
                        tone="danger"
                        aria-label={t('dashboard.eraseClientData')}
                        data-testid="client-erase"
                        disabled={row.erased}
                        onClick={() => setConfirmErase(row)}
                      >
                        <DeleteOutlinedIcon fontSize="small" />
                      </ActionIconButton>
                    </Box>
                  )
                })}

                <TablePagination
                  component="div"
                  count={filtered.length}
                  page={page}
                  onPageChange={(_, p) => setPage(p)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
                  rowsPerPageOptions={[10, 25, 50]}
                  labelRowsPerPage={t('dashboard.rowsPerPage')}
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
                  sx={{
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', minHeight: 52, gap: 0.5 },
                    '& .MuiTablePagination-actions button': { p: { xs: 1.25, md: 1 } },
                  }}
                />
              </Box>
            )
          )}

          {/* ── Blocked numbers ─────────────────────────────────────────── */}
          {tab === 'blocked' && (
            filteredBlocked.length === 0 ? (
              <EmptyState
                icon={<BlockIcon />}
                title={t('clients.blockedEmpty')}
                caption={t('clients.blockedEmptyHelp')}
              />
            ) : (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
                {filteredBlocked.map((row, i) => (
                  <Box
                    key={row.id}
                    data-testid="blocked-row"
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75,
                      borderBottom: i < filteredBlocked.length - 1 ? '1px solid' : 'none',
                      borderColor: 'divider',
                      '&:hover': { bgcolor: surface.hover },
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {row.phone}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {row.reason || t('clients.noReason')}
                      </Typography>
                    </Box>

                    <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                      {format(new Date(row.createdAt), 'd MMM yyyy', { locale: dateLocale() })}
                    </Typography>

                    <Button
                      size="small"
                      onClick={() => setConfirmUnblock(row)}
                      data-testid="blocked-unblock"
                    >
                      {t('clients.unblock')}
                    </Button>
                  </Box>
                ))}
              </Box>
            )
          )}
        </>
      )}

      {/* Block drawer — phone (locked when opened from a client row) + reason. */}
      <SideDrawer
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        disableClose={blocking}
        title={t('clients.blockTitle')}
        data-testid="block-drawer"
        actions={
          <>
            <Button onClick={() => setBlockOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="contained" color="error" onClick={saveBlock} disabled={blocking} data-testid="block-save">
              {blocking ? <CircularProgress size={20} color="inherit" /> : t('clients.block')}
            </Button>
          </>
        }
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {blockName ? t('clients.blockHelp', { name: blockName }) : t('clients.blockHelpGeneric')}
          </Typography>
          <TextField
            required
            label={t('settings.phone')}
            value={blockPhone}
            onChange={e => setBlockPhone(e.target.value)}
            disabled={blockPhoneLocked}
            fullWidth
            placeholder="555 123 456"
            error={blockPhoneInvalid}
            helperText={blockPhoneInvalid ? t('validation.invalidPhone') : ' '}
            slotProps={{ htmlInput: { inputMode: 'tel' as const, 'data-testid': 'block-phone' } }}
            autoFocus={!blockPhoneLocked}
          />
          <TextField
            label={t('clients.blockReason')}
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            helperText={t('clients.blockReasonHelp')}
            slotProps={{ htmlInput: { maxLength: FIELD_LIMITS.notes, 'data-testid': 'block-reason' } }}
          />
        </Stack>
      </SideDrawer>

      {/* Erase confirmation (Art. 16) — destructive, kept as a centered confirm. */}
      <ConfirmDialog
        open={!!confirmErase}
        title={t('clients.eraseTitle')}
        message={t('clients.eraseMessage', {
          name: confirmErase ? `${confirmErase.firstName} ${confirmErase.lastName ?? ''}`.trim() : '',
        })}
        confirmLabel={t('dashboard.eraseConfirm')}
        loading={erasing}
        onClose={() => setConfirmErase(null)}
        onConfirm={() => { if (confirmErase) eraseClient(confirmErase) }}
      />

      <ConfirmDialog
        open={!!confirmUnblock}
        title={t('clients.unblockTitle')}
        message={t('clients.unblockMessage', { phone: confirmUnblock?.phone ?? '' })}
        confirmLabel={t('clients.unblock')}
        destructive
        loading={unblocking}
        onClose={() => setConfirmUnblock(null)}
        onConfirm={() => { if (confirmUnblock) unblock(confirmUnblock) }}
      />
    </Box>
  )
}
