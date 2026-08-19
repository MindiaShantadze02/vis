import { useMemo, useState } from 'react'

/**
 * Client-side paging for the superadmin lists.
 *
 * Kept in its own module (not _shared.tsx) because a file that exports both
 * components and plain functions breaks React fast refresh.
 *
 * The current page is CLAMPED during render rather than reset from an effect.
 * Without clamping, filtering a list down while sitting on page 4 leaves the
 * table empty and looks broken; doing it in an effect instead would setState
 * during render-commit and cascade an extra render for every filter keystroke.
 * Clamping is derived state, so it costs nothing.
 */
export function usePaged<T>(rows: T[], initialRowsPerPage = 10) {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage)

  const maxPage = Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1)
  const safePage = Math.min(page, maxPage)

  const paged = useMemo(
    () => rows.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage),
    [rows, safePage, rowsPerPage],
  )

  return { paged, page: safePage, setPage, rowsPerPage, setRowsPerPage, count: rows.length }
}
