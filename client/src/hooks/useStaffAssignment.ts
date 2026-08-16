import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Appointment, StaffRef } from '@/types/appointment'

/**
 * Which bookable members may take the opened appointment's service, plus the
 * writer that reassigns it. Both dashboard surfaces (overview list and calendar)
 * offer the same staff dropdown in their detail drawer, so the lookup and the
 * optimistic local patch live here once.
 *
 * `patch` lets the caller mirror the change into whatever list it holds.
 */
export function useStaffAssignment(
  selected: Appointment | null,
  bookableMembers: StaffRef[],
  patch: (id: string, staffId: string | null, staff: StaffRef | null) => void,
) {
  const [assignableIds, setAssignableIds] = useState<string[]>([])

  useEffect(() => {
    if (!selected) { setAssignableIds([]); return }
    supabase
      .from('service_staff')
      .select('member_id')
      .eq('service_id', selected.service_id)
      .then(({ data }) => setAssignableIds((data ?? []).map(r => (r as { member_id: string }).member_id)))
  }, [selected])

  async function reassignStaff(staffId: string | null) {
    if (!selected) return
    await supabase
      .from('appointments')
      .update({ staff_id: staffId, updated_at: new Date().toISOString() })
      .eq('id', selected.id)
    const staff = staffId ? bookableMembers.find(m => m.id === staffId) ?? null : null
    patch(selected.id, staffId, staff)
  }

  /** Members actually offerable for this appointment's service. */
  const assignableMembers = bookableMembers.filter(m => assignableIds.includes(m.id))

  return { assignableMembers, reassignStaff }
}
