import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  bookingConfirmationBody,
  appointmentReminderBody,
  sendSms,
  type SmsMessageType,
} from '../_shared/sms/index.ts'

// Event-driven SMS sender. Invoked by the send_appointment_sms DB trigger (via
// pg_net) on appointment insert — NOT by end users. It loads everything the
// message needs from the booking, builds the body, and delegates to sendSms
// (which picks the provider and writes the sms_log audit row).
//
// Auth: verify_jwt = false so the trigger can reach it without a user JWT;
// instead it checks a shared secret header against SMS_WEBHOOK_SECRET.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sms-secret',
}

interface Payload {
  appointment_id?: string
  message_type?: SmsMessageType
}

// Resolved booking details so the rest of the handler (cooldown, body, send)
// is shared.
interface Resolved {
  orgId: string
  appointmentId: string | null
  to: string | null
  businessName: string
  label: string
  when: string
  pending: boolean
}

const RESEND_COOLDOWN_SECONDS = 60

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi', dateStyle: 'medium', timeStyle: 'short' })

// Supabase types embedded relations as arrays; normalise to a single row.
function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

async function resolveAppointment(supabase: SupabaseClient, id: string): Promise<Resolved | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, org_id, status, scheduled_at, service:services ( name ), customer:customers ( first_name, phone_number ), org:organisations ( name )')
    .eq('id', id)
    .single()
  if (error || !data) return null
  const service = one(data.service as { name: string } | { name: string }[] | null)
  const customer = one(data.customer as { phone_number: string } | { phone_number: string }[] | null)
  const org = one(data.org as { name: string } | { name: string }[] | null)
  return {
    orgId: data.org_id,
    appointmentId: data.id,
    to: customer?.phone_number ?? null,
    businessName: org?.name ?? 'vis',
    label: service?.name ?? '',
    when: fmtDateTime(data.scheduled_at),
    pending: data.status === 'pending',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const expected = Deno.env.get('SMS_WEBHOOK_SECRET')
    if (!expected || req.headers.get('x-sms-secret') !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const { appointment_id, message_type = 'booking_confirmation' } =
      (await req.json().catch(() => ({}))) as Payload

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (!appointment_id) {
      return Response.json({ error: 'missing booking id' }, { status: 400, headers: corsHeaders })
    }
    const resolved: Resolved | null = await resolveAppointment(supabase, appointment_id)

    if (!resolved) {
      return Response.json({ error: 'booking not found' }, { status: 404, headers: corsHeaders })
    }

    const to = resolved.to
    if (!to) {
      return Response.json({ error: 'customer has no phone' }, { status: 422, headers: corsHeaders })
    }

    // appointment_reminder only applies to appointments; everything else uses
    // the shared booking-confirmation body (approval_update reuses it too).
    const SUPPORTED: SmsMessageType[] = ['booking_confirmation', 'approval_update', 'appointment_reminder']
    if (!SUPPORTED.includes(message_type)) {
      return Response.json({ error: `unsupported message_type: ${message_type}` }, { status: 400, headers: corsHeaders })
    }

    // Drop duplicate/replayed sends of the same message to the same recipient.
    const since = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('sms_log')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_phone', to)
      .eq('message_type', message_type)
      .in('status', ['queued', 'sent'])
      .gte('created_at', since)
    if ((recentCount ?? 0) > 0) {
      return Response.json({ status: 'skipped', reason: 'cooldown' }, { headers: corsHeaders })
    }

    const details = {
      businessName: resolved.businessName,
      serviceName: resolved.label,
      when: resolved.when,
      pending: resolved.pending,
    }
    const body = message_type === 'appointment_reminder'
      ? appointmentReminderBody(details)
      : bookingConfirmationBody(details)

    const result = await sendSms(supabase, {
      orgId: resolved.orgId,
      appointmentId: resolved.appointmentId,
      messageType: message_type,
      to,
      body,
    })

    return Response.json(result, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
