import type { ReactNode } from 'react'
import { Card, CardContent, Box, Typography, TablePagination } from '@mui/material'

/**
 * Section shell shared by the superadmin console pages. Matches the dashboard
 * layout convention used everywhere else: full-width card, CardContent p:3,
 * subtitle1/600 heading with a body2 explanatory line beneath it.
 *
 * The hint is not decoration — every number on these pages needs a sentence
 * saying what decision it supports, or it just becomes a wall of digits nobody
 * acts on.
 */
export function Section({ title, hint, action, children }: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: hint ? 0.5 : 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
            {title}
          </Typography>
          {action}
        </Box>
        {hint && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
            {hint}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

/** Horizontally scrollable table wrapper — the page body must never scroll sideways. */
export function ScrollX({ children }: { children: ReactNode }) {
  return <Box sx={{ overflowX: 'auto', mx: -1, px: 1 }}>{children}</Box>
}

/**
 * Footer pager for the superadmin lists. Mirrors the dashboard's
 * OverviewPage control (same MUI component, same responsive toolbar tweaks) so
 * the two consoles behave identically; the labels are Georgian inline because
 * the superadmin area is single-language by design.
 *
 * Paging is client-side: these lists arrive whole from one RPC and are searched
 * in memory, so slicing locally keeps search instant and avoids a round trip
 * per page. If the platform ever passes a few thousand orgs, move
 * list_orgs_overview to p_limit/p_offset the way get_org_appointments already
 * does — the component below does not change.
 */
export function Pager({ count, page, rowsPerPage, onPage, onRowsPerPage }: {
  count: number
  page: number
  rowsPerPage: number
  onPage: (p: number) => void
  onRowsPerPage: (n: number) => void
}) {
  if (count === 0) return null
  return (
    <TablePagination
      component="div"
      count={count}
      page={page}
      onPageChange={(_, p) => onPage(p)}
      rowsPerPage={rowsPerPage}
      onRowsPerPageChange={e => { onRowsPerPage(parseInt(e.target.value, 10)); onPage(0) }}
      rowsPerPageOptions={[10, 25, 50]}
      labelRowsPerPage="სტრიქონი გვერდზე"
      labelDisplayedRows={({ from, to, count: c }) => `${from}–${to} / ${c}`}
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', minHeight: 52, gap: 0.5 },
        '& .MuiTablePagination-actions button': { p: { xs: 1.25, md: 1 } },
      }}
    />
  )
}
