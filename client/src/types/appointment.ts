import type { AppointmentStatus } from '@/components/ui'

/** A bookable org member, as embedded on an appointment. */
export interface StaffRef {
  id: string
  display_name: string | null
  title: string | null
}

/**
 * One appointment row as the dashboard reads it. Both dashboard surfaces share
 * this shape: the overview list (via the `search_appointments` RPC) and the
 * calendar week (via a PostgREST range select), which selects the same columns
 * so a single type serves both.
 */
export interface Appointment {
  id: string
  scheduled_at: string
  duration_minutes: number
  service_id: string
  staff_id: string | null
  status: AppointmentStatus
  payment_method: string
  payment_status: string
  notes: string | null
  admin_notes: string | null
  meeting_link: string | null
  customers: { first_name: string; last_name: string | null; phone_number: string } | null
  services: { name: string; price: number; duration_minutes: number; location_type: string } | null
  staff: StaffRef | null
}

/**
 * Columns a PostgREST select needs to satisfy `Appointment`. Kept as one
 * literal (not concatenated) so supabase-js can still infer the row shape.
 */
export const APPOINTMENT_SELECT = 'id, scheduled_at, duration_minutes, service_id, staff_id, status, payment_method, payment_status, notes, admin_notes, meeting_link, customers(first_name, last_name, phone_number), services(name, price, duration_minutes, location_type), staff:org_members!appointments_staff_id_fkey(id, display_name, title)' as const

/** PostgREST may type a to-one relation as an array; normalize to one object. */
export function pickOne<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null
  return rel ?? null
}
