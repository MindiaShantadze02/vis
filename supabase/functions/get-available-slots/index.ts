import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const orgId = url.searchParams.get('org_id')
    const serviceId = url.searchParams.get('service_id')
    const date = url.searchParams.get('date') // yyyy-MM-dd

    if (!orgId || !serviceId || !date) {
      return Response.json({ error: 'Missing org_id, service_id or date' }, { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load service duration
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .single()

    if (!service) return Response.json({ error: 'Service not found' }, { status: 404, headers: corsHeaders })

    // Load working hours template
    const { data: template } = await supabase
      .from('working_hours_template')
      .select('monday,tuesday,wednesday,thursday,friday,saturday,sunday,max_appointments_per_slot')
      .eq('org_id', orgId)
      .single()

    if (!template) return Response.json({ slots: [] }, { headers: corsHeaders })

    // Check for date override
    const { data: override } = await supabase
      .from('working_hours_overrides')
      .select('is_closed, ranges')
      .eq('org_id', orgId)
      .eq('date', date)
      .maybeSingle()

    if (override?.is_closed) return Response.json({ slots: [] }, { headers: corsHeaders })

    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
    const d = new Date(date + 'T00:00:00')
    const dayKey = dayNames[d.getDay()]
    const dayCfg = override?.ranges ? { open: true, ranges: override.ranges } : template[dayKey]

    if (!dayCfg?.open) return Response.json({ slots: [] }, { headers: corsHeaders })

    // Load existing appointments for the day
    const { data: existing } = await supabase
      .from('appointments')
      .select('scheduled_at, duration_minutes')
      .eq('org_id', orgId)
      .gte('scheduled_at', `${date}T00:00:00Z`)
      .lt('scheduled_at', `${date}T23:59:59Z`)
      .not('status', 'in', '(rejected,cancelled)')

    const maxPerSlot = template.max_appointments_per_slot ?? 1
    const now = new Date()

    const slots: string[] = []

    for (const range of dayCfg.ranges) {
      const [sh, sm] = range.start.split(':').map(Number)
      const [eh, em] = range.end.split(':').map(Number)

      let cur = new Date(d)
      cur.setHours(sh, sm, 0, 0)
      const end = new Date(d)
      end.setHours(eh, em, 0, 0)

      while (cur < end) {
        const slotEnd = new Date(cur.getTime() + service.duration_minutes * 60000)
        if (slotEnd > end) break
        if (cur <= now) { cur = slotEnd; continue }

        const count = (existing ?? []).filter(a => {
          const aStart = new Date(a.scheduled_at)
          const aEnd = new Date(aStart.getTime() + a.duration_minutes * 60000)
          return cur < aEnd && slotEnd > aStart
        }).length

        if (count < maxPerSlot) {
          slots.push(`${String(cur.getHours()).padStart(2,'0')}:${String(cur.getMinutes()).padStart(2,'0')}`)
        }

        cur = slotEnd
      }
    }

    return Response.json({ slots }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
