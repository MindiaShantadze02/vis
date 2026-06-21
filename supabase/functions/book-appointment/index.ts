import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { org_id, service_id, scheduled_at, first_name, last_name, phone, notes, payment_method } = body

    if (!org_id || !service_id || !scheduled_at || !first_name || !phone) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: corsHeaders })
    }

    // Validate name/notes lengths to mirror the client + DB constraints
    // (customers_first_name_min_length, appointments_notes_max_length).
    const firstNameTrim = String(first_name).trim()
    if (firstNameTrim.length < 2 || firstNameTrim.length > 100) {
      return Response.json({ error: 'invalid_name' }, { status: 400, headers: corsHeaders })
    }
    if (last_name && String(last_name).length > 100) {
      return Response.json({ error: 'invalid_name' }, { status: 400, headers: corsHeaders })
    }
    if (notes && String(notes).length > 500) {
      return Response.json({ error: 'notes_too_long' }, { status: 400, headers: corsHeaders })
    }

    // Validate & normalise the phone to a bare 9-digit Georgian number
    // (mobile starts with 5, landline with 3/4). No country code is stored.
    const phoneDigits = String(phone).replace(/\D/g, '')
    const phoneLocal = phoneDigits.startsWith('995') ? phoneDigits.slice(3) : phoneDigits
    if (!/^[345]\d{8}$/.test(phoneLocal)) {
      return Response.json({ error: 'invalid_phone' }, { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Check org subscription limit. Usage is derived server-side from the
    // appointments table against the org's rolling billing period, so it
    // stays correct regardless of how appointments were created.
    const { data: canAccept, error: limitErr } = await supabase
      .rpc('org_can_accept_appointment', { p_org_id: org_id })

    if (limitErr) return Response.json({ error: limitErr.message }, { status: 500, headers: corsHeaders })
    if (canAccept === null) return Response.json({ error: 'Organisation not found' }, { status: 404, headers: corsHeaders })
    if (canAccept === false) {
      return Response.json({ error: 'limit_reached' }, { status: 422, headers: corsHeaders })
    }

    // Load service
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes, price')
      .eq('id', service_id)
      .eq('org_id', org_id)
      .eq('is_active', true)
      .single()

    if (!service) return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders })

    // An appointment may last at most 24 hours. Mirrors the DB constraint
    // (services_duration_max) so a misconfigured service fails fast here.
    if (service.duration_minutes > 1440) {
      return Response.json({ error: 'duration_too_long' }, { status: 422, headers: corsHeaders })
    }

    // Check slot is still free
    const slotStart = new Date(scheduled_at)
    const slotEnd = new Date(slotStart.getTime() + service.duration_minutes * 60000)

    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org_id)
      .not('status', 'in', '(rejected,cancelled)')
      .lt('scheduled_at', slotEnd.toISOString())
      .gte('scheduled_at', slotStart.toISOString())

    if ((count ?? 0) > 0) {
      return Response.json({ error: 'slot_taken' }, { status: 409, headers: corsHeaders })
    }

    // Upsert customer
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .upsert(
        { first_name: firstNameTrim, last_name: last_name?.trim() || null, phone_number: phoneLocal },
        { onConflict: 'phone_number' }
      )
      .select('id')
      .single()

    if (custErr) return Response.json({ error: custErr.message }, { status: 500, headers: corsHeaders })

    // Create appointment
    const { data: appt, error: apptErr } = await supabase
      .from('appointments')
      .insert({
        org_id,
        service_id,
        customer_id: customer.id,
        scheduled_at: slotStart.toISOString(),
        duration_minutes: service.duration_minutes,
        status: payment_method === 'online' ? 'approved' : 'pending',
        payment_method: payment_method ?? 'in_person',
        payment_status: 'unpaid',
        notes: notes || null,
      })
      .select('id')
      .single()

    if (apptErr) return Response.json({ error: apptErr.message }, { status: 500, headers: corsHeaders })

    // No counter to bump — usage is derived from the appointments table.
    // Admin notifications + the booking-confirmation SMS are created by DB
    // triggers on appointment insert (notify_new_appointment, send_appointment_sms),
    // so every booking path — including this one — is covered.
    return Response.json({ appointment_id: appt.id }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
