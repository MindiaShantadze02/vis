import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { executeRefund } from '../_shared/payments/index.ts'
import { sendSms, rescheduleUpdateBody, cancellationUpdateBody } from '../_shared/sms/index.ts'

// Customer self-service reschedule / cancel for /manage/:appointmentId. The
// appointment UUID is the capability (like /review), but every MUTATION is gated
// behind a booking OTP to the appointment's phone — cancel/reschedule is higher
// stakes than a review.
//
// Actions (verify_jwt=false, public):
//   * request-otp {appointment_id}            → texts a code to the booking's phone
//   * reschedule  {appointment_id, code, scheduled_at, staff_id?, lang?}
//   * cancel      {appointment_id, code, lang?}
//
// The OTP is requested/verified by delegating to the existing
// request-booking-otp / verify-booking-otp functions (server-to-server), so the
// phone never reaches the client and this file carries NO test bypass — the
// '000000' dev code lives only in verify-booking-otp. After a successful verify
// the challenge is consumed (single-use per action).
//
// Refund-on-cancel mirrors refund-payment: atomically claim the row
// (payment_status → refunded) BEFORE hitting the gateway, and revert on failure,
// so booking-state and money-state only ever move together.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function err(code: string, status: number): Response {
  return Response.json({ ok: false, error: code }, { status, headers: corsHeaders })
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

// Human-readable business-time (Asia/Tbilisi = UTC+4) slot label for the SMS.
function formatWhen(iso: string, lang: string): string {
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'ka-GE'
  return new Intl.DateTimeFormat(loc, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tbilisi',
  }).format(new Date(iso))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action as string
    const appointmentId = body.appointment_id as string
    const lang = ['ka', 'ru', 'en'].includes(body.lang) ? body.lang as string : 'ka'
    if (!appointmentId || !['request-otp', 'reschedule', 'cancel'].includes(action)) {
      return err('invalid_request', 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: appt } = await admin
      .from('appointments')
      .select(`
        id, org_id, status, scheduled_at, duration_minutes, service_id, staff_id,
        payment_status, payment_reference, payment_method,
        customer:customers(first_name, phone_number),
        service:services(name),
        org:organisations(name, cancellation_window_hours, deposit_refundable)
      `)
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appt) return err('not_found', 404)

    const customer = one(appt.customer as { first_name: string; phone_number: string } | null)
    const service = one(appt.service as { name: string } | null)
    const org = one(appt.org as { name: string; cancellation_window_hours: number; deposit_refundable: boolean } | null)
    const phone = customer?.phone_number
    if (!phone || !org) return err('not_found', 404)

    // Manageable only while pending/approved and still in the future.
    const manageable = ['pending', 'approved'].includes(appt.status) && new Date(appt.scheduled_at) > new Date()
    if (!manageable) return err('not_manageable', 409)

    const otpBase = `${Deno.env.get('SUPABASE_URL')}/functions/v1`
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const otpHeaders = { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` }

    // ── request-otp ─────────────────────────────────────────────────────────
    if (action === 'request-otp') {
      const r = await fetch(`${otpBase}/request-booking-otp`, {
        method: 'POST', headers: otpHeaders, body: JSON.stringify({ phone, org_id: appt.org_id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) {
        return Response.json({ ok: false, error: j.error ?? 'otp_request_failed' },
          { status: r.status === 429 ? 429 : 400, headers: corsHeaders })
      }
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // reschedule / cancel — verify the OTP first.
    const code = String(body.code ?? '')
    if (!/^\d{6}$/.test(code)) return err('invalid_code', 400)

    const vr = await fetch(`${otpBase}/verify-booking-otp`, {
      method: 'POST', headers: otpHeaders, body: JSON.stringify({ phone, code }),
    })
    const vj = await vr.json().catch(() => ({}))
    if (!vj.verified) {
      return Response.json({ ok: false, error: vj.error ?? 'wrong_code' }, { status: 401, headers: corsHeaders })
    }
    // Single-use: consume the verified challenge so the same code can't drive a
    // second action.
    await admin.from('booking_verifications')
      .update({ consumed_at: new Date().toISOString() })
      .eq('phone', phone).not('verified_at', 'is', null).is('consumed_at', null)

    // ── reschedule ──────────────────────────────────────────────────────────
    if (action === 'reschedule') {
      const newAt = body.scheduled_at as string
      const staffId = (body.staff_id as string | null) ?? null
      if (!newAt) return err('invalid_request', 400)

      const { error: rpcErr } = await admin.rpc('reschedule_appointment_slot', {
        p_appointment_id: appointmentId, p_scheduled_at: newAt, p_staff_id: staffId,
      })
      if (rpcErr) {
        const m = rpcErr.message ?? ''
        if (m.includes('slot_taken')) return err('slot_taken', 409)
        if (m.includes('not_reschedulable') || m.includes('not_found')) return err('not_manageable', 409)
        if (m.includes('staff_not_available')) return err('staff_not_available', 409)
        console.error('[manage-appointment] reschedule:', rpcErr)
        return err('server_error', 500)
      }

      await sendSms(admin, {
        orgId: appt.org_id, appointmentId, messageType: 'reschedule_update', to: phone,
        body: rescheduleUpdateBody({ businessName: org.name ?? 'Vis', serviceName: service?.name ?? '', when: formatWhen(newAt, lang) }, lang as 'ka' | 'ru' | 'en'),
      })
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // ── cancel (+ refund per policy) ────────────────────────────────────────
    // An online payment (full or deposit) is refunded when the cancellation
    // lands within the free-cancel window AND the org allows deposit refunds;
    // otherwise the booking cancels without a refund.
    const withinWindow =
      new Date(appt.scheduled_at).getTime() - Date.now() >= (org.cancellation_window_hours ?? 0) * 3_600_000
    const isPaidOnline = appt.payment_status === 'paid' || appt.payment_status === 'deposit_paid'
    const refundEligible =
      isPaidOnline && !!appt.payment_reference && withinWindow && org.deposit_refundable !== false

    let refunded = false, refundAmount = 0, refundCurrency = 'GEL'

    if (refundEligible) {
      // Atomic claim BEFORE the gateway (refund-payment pattern): the
      // payment_status guard makes a concurrent second cancel lose.
      const priorStatus = appt.status, priorPayment = appt.payment_status
      const { data: claimed } = await admin
        .from('appointments')
        .update({ payment_status: 'refunded', status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', appointmentId)
        .in('payment_status', ['paid', 'deposit_paid'])
        .in('status', ['pending', 'approved'])
        .select('id')
      if (!claimed || claimed.length === 0) return err('not_manageable', 409)

      const { data: log } = await admin
        .from('payment_log').select('amount, currency')
        .eq('provider_reference', appt.payment_reference).maybeSingle()
      try {
        if (!log) throw new Error('log_not_found')
        await executeRefund(admin, {
          providerReference: appt.payment_reference,
          amount: Number(log.amount), currency: log.currency ?? 'GEL',
        })
        refunded = true; refundAmount = Number(log.amount); refundCurrency = log.currency ?? 'GEL'
      } catch (refundErr) {
        // Money did not move — put the appointment back exactly as it was.
        await admin.from('appointments')
          .update({ payment_status: priorPayment, status: priorStatus, updated_at: new Date().toISOString() })
          .eq('id', appointmentId)
        console.error('[manage-appointment] refund failed:', refundErr)
        return err('refund_failed', 502)
      }
    } else {
      const { data: claimed } = await admin
        .from('appointments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', appointmentId)
        .in('status', ['pending', 'approved'])
        .select('id')
      if (!claimed || claimed.length === 0) return err('not_manageable', 409)
    }

    await sendSms(admin, {
      orgId: appt.org_id, appointmentId, messageType: 'cancellation_update', to: phone,
      body: cancellationUpdateBody({
        businessName: org.name ?? 'Vis', serviceName: service?.name ?? '',
        when: formatWhen(appt.scheduled_at, lang), refunded, amount: refundAmount, currency: refundCurrency,
      }, lang as 'ka' | 'ru' | 'en'),
    })
    return Response.json({ ok: true, refunded }, { headers: corsHeaders })
  } catch (e) {
    console.error('[manage-appointment] unhandled:', e)
    return err('server_error', 500)
  }
})
