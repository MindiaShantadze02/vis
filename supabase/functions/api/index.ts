import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeGeorgianPhone } from '../_shared/otp.ts'
import {
  businessDayKey,
  businessDayWindow,
  computeAvailableSlotsWithCapacity,
  type SlotOverride,
  type WeekTemplate,
} from '../_shared/slots.ts'

/**
 * Public REST API v1 — lets a business integrate Grafiki booking into its own
 * app. Auth: per-organisation API key (x-api-key header or Bearer token),
 * minted in dashboard Settings → API keys, checked against api_keys via the
 * authenticate_api_key RPC (which also rate-limits per key; migration 071).
 *
 * Server-to-server only: keys must never ship in browser/mobile code. CORS is
 * open ('*') to match the other functions, but the docs warn against it.
 *
 * Routes (all under /functions/v1/api):
 *   GET  /v1/organisation                       — the key's org public profile
 *   GET  /v1/services                            — active services
 *   GET  /v1/slots?service_id&date[&staff_id]    — free slots for one day
 *   POST /v1/bookings                            — create an in-person booking
 *
 * Booking inserts go through the api_create_booking RPC, which is the ONLY
 * path allowed to skip the guest-OTP gate (transaction-local GUC — see
 * migration 071 header). Slot validity is re-checked server-side here first,
 * which is stronger than the public booking page (same last-ms race remains —
 * no DB exclusion constraint; accepted risk, documented).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, x-client-info, apikey, content-type',
}

// Mirror of CONSENT_VERSION in client/src/pages/legal/legalContent.ts — the
// integrator asserts the customer's consent when calling POST /v1/bookings
// (documented in docs/PUBLIC_API.md); bump together with the client constant.
const CONSENT_VERSION = '2026-07-03.2'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...corsHeaders, ...extra } })
}

function apiError(status: number, error: string, message: string): Response {
  return json({ error, message }, status)
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Fetch everything computeAvailableSlotsWithCapacity needs for one org/service/day. */
async function loadSlotInputs(admin: SupabaseClient, orgId: string, serviceId: string, dateKey: string) {
  const window = businessDayWindow(dateKey)
  const [tmplRes, ovrRes, busyRes, svcRes, staffRes] = await Promise.all([
    admin
      .from('working_hours_template')
      .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday,max_advance_days')
      .eq('org_id', orgId)
      .maybeSingle(),
    admin
      .from('working_hours_overrides')
      .select('is_closed, ranges')
      .eq('org_id', orgId)
      .eq('date', dateKey)
      .maybeSingle(),
    // Same filters as get_org_busy_slots (066): everything not rejected/cancelled blocks.
    admin
      .from('appointments')
      .select('scheduled_at, duration_minutes, service_id, staff_id')
      .eq('org_id', orgId)
      .gte('scheduled_at', window.from)
      .lte('scheduled_at', window.to)
      .not('status', 'in', '("rejected","cancelled")'),
    admin
      .from('services')
      .select('id, duration_minutes, max_per_slot')
      .eq('id', serviceId)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle(),
    // Mirrors Step2DateTimeSelect: only bookable members assigned to the service.
    admin
      .from('service_staff')
      .select('member_id, org_members!inner(id, is_bookable)')
      .eq('service_id', serviceId)
      .eq('org_members.is_bookable', true),
  ])

  const firstError = tmplRes.error ?? ovrRes.error ?? busyRes.error ?? svcRes.error ?? staffRes.error
  if (firstError) throw new Error(firstError.message)

  return {
    template: (tmplRes.data ?? null) as (WeekTemplate & { max_advance_days: number | null }) | null,
    override: (ovrRes.data ?? null) as SlotOverride | null,
    busy: busyRes.data ?? [],
    service: svcRes.data as { id: string; duration_minutes: number; max_per_slot: number } | null,
    assignedStaff: (staffRes.data ?? []).map((r) => ({ id: (r as { member_id: string }).member_id })),
  }
}

function computeSlots(
  inputs: Awaited<ReturnType<typeof loadSlotInputs>>,
  dateKey: string,
  staffId: string | null,
) {
  const { max_advance_days, ...days } =
    inputs.template ?? ({} as WeekTemplate & { max_advance_days: number | null })

  // Same cap the booking page shows and the insert trigger (025) enforces.
  if (max_advance_days != null) {
    const latest = businessDayKey(new Date(Date.now() + max_advance_days * 24 * 60 * 60_000))
    if (dateKey > latest) return []
  }

  return computeAvailableSlotsWithCapacity({
    dateKey,
    template: inputs.template ? (days as WeekTemplate) : null,
    override: inputs.override,
    existing: inputs.busy,
    serviceId: inputs.service!.id,
    durationMinutes: inputs.service!.duration_minutes,
    maxPerSlot: inputs.service!.max_per_slot,
    assignedStaff: inputs.assignedStaff,
    selectedStaffId: staffId,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ---- Auth: resolve the org from the API key --------------------------
    const bearer = req.headers.get('authorization') ?? ''
    const rawKey = req.headers.get('x-api-key') ??
      (bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '')
    if (!rawKey || !rawKey.startsWith('grf_')) {
      return apiError(401, 'invalid_key', 'Pass your API key in the x-api-key header.')
    }

    const { data: auth, error: authErr } = await admin.rpc('authenticate_api_key', {
      p_key_hash: await sha256Hex(rawKey),
    })
    if (authErr) return apiError(500, 'internal', authErr.message)
    const session = Array.isArray(auth) ? auth[0] : auth
    if (!session) return apiError(401, 'invalid_key', 'Unknown or revoked API key.')
    if (session.rate_limited) {
      return apiError(429, 'rate_limited', 'Per-minute request limit reached. Retry shortly.')
    }
    const orgId: string = session.org_id

    // ---- Routing ----------------------------------------------------------
    const url = new URL(req.url)
    let path = url.pathname
    for (const prefix of ['/functions/v1/api', '/api']) {
      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length)
        break
      }
    }
    if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1)

    // GET /v1/organisation
    if (req.method === 'GET' && path === '/v1/organisation') {
      const { data, error } = await admin
        .from('organisations')
        .select('id, name, slug, description, contact_phone, logo_url')
        .eq('id', orgId)
        .single()
      if (error) return apiError(500, 'internal', error.message)
      return json({ organisation: data })
    }

    // GET /v1/services
    if (req.method === 'GET' && path === '/v1/services') {
      const { data, error } = await admin
        .from('services')
        .select('id, name, duration_minutes, price, max_per_slot')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('sort_order')
      if (error) return apiError(500, 'internal', error.message)
      // PostgREST returns numeric columns as strings; present price as a number.
      const services = (data ?? []).map((s) => ({ ...s, price: Number(s.price) }))
      return json({ services })
    }

    // GET /v1/slots?service_id&date[&staff_id]
    if (req.method === 'GET' && path === '/v1/slots') {
      const serviceId = url.searchParams.get('service_id') ?? ''
      const dateKey = url.searchParams.get('date') ?? ''
      const staffId = url.searchParams.get('staff_id')
      if (!UUID_RE.test(serviceId)) return apiError(422, 'invalid_service_id', 'service_id must be a UUID.')
      if (!DATE_RE.test(dateKey)) return apiError(422, 'invalid_date', 'date must be YYYY-MM-DD.')
      if (staffId !== null && !UUID_RE.test(staffId)) {
        return apiError(422, 'invalid_staff_id', 'staff_id must be a UUID.')
      }

      const inputs = await loadSlotInputs(admin, orgId, serviceId, dateKey)
      if (!inputs.service) return apiError(404, 'service_not_found', 'No such active service for this organisation.')
      if (staffId && !inputs.assignedStaff.some((m) => m.id === staffId)) {
        return apiError(422, 'staff_not_available', 'That staff member is not bookable for this service.')
      }

      const slots = computeSlots(inputs, dateKey, staffId ?? null)
      return json({ service_id: serviceId, date: dateKey, timezone: '+04:00', slots })
    }

    // POST /v1/bookings
    if (req.method === 'POST' && path === '/v1/bookings') {
      const body = await req.json().catch(() => null)
      if (!body || typeof body !== 'object') return apiError(422, 'invalid_body', 'Body must be JSON.')

      const { service_id, date, time, staff_id, notes, status } = body as Record<string, unknown>
      const customer = (body as { customer?: Record<string, unknown> }).customer ?? {}
      const firstName = String(customer.first_name ?? '').trim()
      const lastName = customer.last_name == null ? '' : String(customer.last_name)

      if (!UUID_RE.test(String(service_id))) return apiError(422, 'invalid_service_id', 'service_id must be a UUID.')
      if (!DATE_RE.test(String(date))) return apiError(422, 'invalid_date', 'date must be YYYY-MM-DD.')
      if (!TIME_RE.test(String(time))) return apiError(422, 'invalid_time', 'time must be HH:mm (24h).')
      if (staff_id != null && !UUID_RE.test(String(staff_id))) {
        return apiError(422, 'invalid_staff_id', 'staff_id must be a UUID.')
      }
      if (status != null && status !== 'pending' && status !== 'approved') {
        return apiError(422, 'invalid_status', "status must be 'pending' or 'approved'.")
      }
      if (!firstName) return apiError(422, 'invalid_name', 'customer.first_name is required.')

      const phone = normalizeGeorgianPhone(customer.phone)
      if (!phone) return apiError(422, 'invalid_phone', 'customer.phone must be a Georgian number (5XXXXXXXX).')

      // Server-side availability check: the requested time must be a currently
      // free slot for this service (and staff member, when given).
      const dateKey = String(date)
      const inputs = await loadSlotInputs(admin, orgId, String(service_id), dateKey)
      if (!inputs.service) return apiError(404, 'service_not_found', 'No such active service for this organisation.')
      const requestedStaff = staff_id == null ? null : String(staff_id)
      if (requestedStaff && !inputs.assignedStaff.some((m) => m.id === requestedStaff)) {
        return apiError(422, 'staff_not_available', 'That staff member is not bookable for this service.')
      }
      const slots = computeSlots(inputs, dateKey, requestedStaff)
      if (!slots.some((s) => s.time === time)) {
        return apiError(409, 'slot_unavailable', 'The requested time is not available.')
      }

      // "Any available" → pin a concrete free member, like the booking page does.
      let staffToBook = requestedStaff
      if (!staffToBook && inputs.assignedStaff.length > 0) {
        const slotStart = Date.parse(`${dateKey}T${time}:00+04:00`)
        const slotEnd = slotStart + inputs.service.duration_minutes * 60_000
        const busyIds = new Set(
          inputs.busy
            .filter((a) => {
              const aStart = new Date(a.scheduled_at).getTime()
              return slotStart < aStart + a.duration_minutes * 60_000 && slotEnd > aStart
            })
            .map((a) => a.staff_id)
            .filter(Boolean),
        )
        staffToBook = inputs.assignedStaff.find((m) => !busyIds.has(m.id))?.id ?? null
      }

      const scheduledAt = new Date(`${dateKey}T${time}:00+04:00`).toISOString()
      const { data: created, error: rpcErr } = await admin.rpc('api_create_booking', {
        p_org_id: orgId,
        p_service_id: service_id,
        p_first_name: firstName,
        p_last_name: lastName,
        p_phone: phone,
        p_scheduled_at: scheduledAt,
        p_staff_id: staffToBook,
        p_notes: notes == null ? null : String(notes),
        p_status: status ?? 'pending',
        p_consent_version: CONSENT_VERSION,
      })
      if (rpcErr) {
        const msg = rpcErr.message ?? ''
        if (msg.includes('limit_reached')) {
          return apiError(403, 'quota_exceeded', "The organisation's monthly appointment quota is used up.")
        }
        if (msg.includes('booking_too_far_in_advance')) {
          return apiError(422, 'too_far_in_advance', 'The date is beyond the booking window.')
        }
        if (msg.includes('service_not_found')) return apiError(404, 'service_not_found', 'No such active service.')
        if (msg.includes('staff_not_available')) return apiError(422, 'staff_not_available', 'Staff member not bookable.')
        if (msg.includes('first_name_letters') || msg.includes('last_name_letters')) {
          return apiError(422, 'invalid_name', 'Customer names may only contain letters.')
        }
        if (msg.includes('phone_format')) return apiError(422, 'invalid_phone', 'Invalid phone number.')
        return apiError(500, 'internal', msg)
      }

      const row = Array.isArray(created) ? created[0] : created
      return json({ booking: { id: row.appointment_id, status: row.status, scheduled_at: row.scheduled_at, staff_id: staffToBook } }, 201)
    }

    return apiError(404, 'not_found', `No route for ${req.method} ${path || '/'}.`)
  } catch (err) {
    return apiError(500, 'internal', String(err))
  }
})
