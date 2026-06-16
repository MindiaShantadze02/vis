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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Check org subscription limit
    const { data: org } = await supabase
      .from('organisations')
      .select('subscription_tier, appointments_used_this_month')
      .eq('id', org_id)
      .single()

    if (!org) return Response.json({ error: 'Organisation not found' }, { status: 404, headers: corsHeaders })

    const { data: config } = await supabase
      .from('platform_config')
      .select('tier_limits')
      .eq('id', 1)
      .single()

    const limits: Record<string, number | null> = config?.tier_limits ?? { free: 30, starter: 200, pro: 600, business: null }
    const limit = limits[org.subscription_tier]

    if (limit !== null && org.appointments_used_this_month >= limit) {
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
        { first_name, last_name: last_name || null, phone_number: phone },
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

    // Increment monthly counter
    await supabase
      .from('organisations')
      .update({ appointments_used_this_month: (org.appointments_used_this_month ?? 0) + 1 })
      .eq('id', org_id)

    return Response.json({ appointment_id: appt.id }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
