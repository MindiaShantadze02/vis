import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  bookingConfirmationBody,
  appointmentReminderBody,
  sendSms,
  type SmsMessageType,
} from '../_shared/sms/index.ts'

// Event-driven SMS sender. Invoked by the `send_appointment_sms` DB trigger
// (via pg_net) on appointment insert — NOT by end users. It loads everything
// the message needs from the appointment, builds the body, and delegates to
// sendSms (which picks the provider and writes the sms_log audit row).
//
// Auth: this function has verify_jwt = false so the trigger can reach it without
// a user JWT. Instead it checks a shared secret header against SMS_WEBHOOK_SECRET,
// so a real provider can't be driven (and billed) by anonymous callers.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sms-secret',
}

interface Payload {
  appointment_id?: string
  message_type?: SmsMessageType
}

// Per-recipient/type cooldown: even though this endpoint is secret-gated and
// trigger-driven, a replayed or duplicated call would re-bill an SMS to the same
// customer. Refuse if an identical message_type was already queued/sent to this
// number within the window.
const RESEND_COOLDOWN_SECONDS = 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const expected = Deno.env.get('SMS_WEBHOOK_SECRET')
    if (!expected || req.headers.get('x-sms-secret') !== expected) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const { appointment_id, message_type = 'booking_confirmation' } =
      (await req.json().catch(() => ({}))) as Payload
    if (!appointment_id) {
      return Response.json({ error: 'missing appointment_id' }, { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Pull the appointment plus the related rows needed to compose the message.
    const { data: appt, error } = await supabase
      .from('appointments')
      .select(`
        id, org_id, status, scheduled_at,
        service:services ( name ),
        customer:customers ( first_name, phone_number ),
        org:organisations ( name )
      `)
      .eq('id', appointment_id)
      .single()

    if (error || !appt) {
      return Response.json({ error: 'appointment not found' }, { status: 404, headers: corsHeaders })
    }

    // Supabase types embedded relations as arrays; normalise to single rows.
    const service = Array.isArray(appt.service) ? appt.service[0] : appt.service
    const customer = Array.isArray(appt.customer) ? appt.customer[0] : appt.customer
    const org = Array.isArray(appt.org) ? appt.org[0] : appt.org

    const to = customer?.phone_number
    if (!to) {
      return Response.json({ error: 'customer has no phone' }, { status: 422, headers: corsHeaders })
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

    // Supported types render here. booking_confirmation/approval_update share
    // the booking-details body (approval_update is sent once a guest booking
    // reaches 'approved'); appointment_reminder is the ~24h-before nudge dispatched
    // by the dispatch_appointment_reminders cron. Other types (admin_*, invitation)
    // can branch here as their flows are built.
    const SUPPORTED: SmsMessageType[] = ['booking_confirmation', 'approval_update', 'appointment_reminder']
    if (!SUPPORTED.includes(message_type)) {
      return Response.json({ error: `unsupported message_type: ${message_type}` }, { status: 400, headers: corsHeaders })
    }

    const when = new Date(appt.scheduled_at).toLocaleString('ka-GE', {
      timeZone: 'Asia/Tbilisi',
      dateStyle: 'medium',
      timeStyle: 'short',
    })

    const details = {
      businessName: org?.name ?? 'vis',
      serviceName: service?.name ?? '',
      when,
      pending: appt.status === 'pending',
    }
    const body = message_type === 'appointment_reminder'
      ? appointmentReminderBody(details)
      : bookingConfirmationBody(details)

    const result = await sendSms(supabase, {
      orgId: appt.org_id,
      appointmentId: appt.id,
      messageType: message_type,
      to,
      body,
    })

    return Response.json(result, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
