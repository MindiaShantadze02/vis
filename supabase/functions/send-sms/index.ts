import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  bookingConfirmationBody,
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

    // Only booking_confirmation is wired today. Other message types (approval_update,
    // admin_*, invitation) can branch here as their flows are built.
    if (message_type !== 'booking_confirmation') {
      return Response.json({ error: `unsupported message_type: ${message_type}` }, { status: 400, headers: corsHeaders })
    }

    const when = new Date(appt.scheduled_at).toLocaleString('ka-GE', {
      timeZone: 'Asia/Tbilisi',
      dateStyle: 'medium',
      timeStyle: 'short',
    })

    const body = bookingConfirmationBody({
      businessName: org?.name ?? 'Grafiki',
      serviceName: service?.name ?? '',
      when,
      pending: appt.status === 'pending',
    })

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
