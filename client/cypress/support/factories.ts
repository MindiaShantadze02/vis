/// <reference types="cypress" />
/**
 * Reusable test-data factories. Each returns a plain row in the shape the app
 * expects back from PostgREST, with sensible defaults overridable per test —
 * so specs declare only the fields they care about.
 */

let seq = 0
const uid = (tag: string) => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}-${tag}`.slice(0, 36)

export function makeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    name: 'ტესტ ბიზნესი',
    description: 'საუკეთესო სერვისი ქალაქში',
    slug: 'test-biz',
    contact_phone: '599 12 34 56',
    logo_url: null,
    subscription_tier: 'pro',
    booking_theme: null,
    vertical: 'appointments',
    payment_config: { inPerson: { enabled: true } },
    ...overrides,
  }
}

export function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: uid('svc'),
    org_id: '00000000-0000-4000-8000-0000000000aa',
    name: 'სტრიჟკა',
    duration_minutes: 60,
    price: 50,
    max_per_slot: 1,
    is_active: true,
    ...overrides,
  }
}

export function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: uid('mem'),
    org_id: '00000000-0000-4000-8000-0000000000aa',
    user_id: null,
    display_name: 'ნინო ბერიძე',
    title: 'სტილისტი',
    role: 'admin',
    is_bookable: true,
    sort_order: 0,
    created_at: '2024-02-01T00:00:00Z',
    ...overrides,
  }
}

export function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    first_name: 'გიორგი',
    last_name: 'მაისურაძე',
    phone_number: '599 11 22 33',
    ...overrides,
  }
}

/** A row shaped like the `search_appointments` RPC return (joined + total_count). */
export function makeAppointment(overrides: Record<string, unknown> = {}) {
  const base = {
    id: uid('apt'),
    scheduled_at: '2026-07-01T10:00:00Z',
    duration_minutes: 60,
    service_id: uid('svc'),
    staff_id: null,
    status: 'pending',
    payment_method: 'in_person',
    payment_status: 'unpaid',
    notes: null,
    admin_notes: null,
    customers: makeCustomer(),
    services: { name: 'სტრიჟკა', price: 50, duration_minutes: 60 },
    staff: null,
    total_count: 1,
  }
  return { ...base, ...overrides }
}

export function makeInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: uid('inv'),
    org_id: '00000000-0000-4000-8000-0000000000aa',
    email: 'invitee@example.com',
    token: 'invite-token-123',
    status: 'pending',
    expires_at: '2030-01-01T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

/** A weekly working-hours template row (open Mon–Fri 09:00–18:00). */
export function makeWorkingHours(overrides: Record<string, unknown> = {}) {
  const open = { open: true, ranges: [{ start: '09:00', end: '18:00' }] }
  const closed = { open: false, ranges: [] }
  return {
    org_id: '00000000-0000-4000-8000-0000000000aa',
    monday: open,
    tuesday: open,
    wednesday: open,
    thursday: open,
    friday: open,
    saturday: closed,
    sunday: closed,
    ...overrides,
  }
}
