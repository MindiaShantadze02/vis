import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Member {
  id: string
  user_id: string
  role: 'owner' | 'admin'
  joined_at: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Identify the caller from their JWT. An anon client bound to the request's
    // Authorization header validates the token and yields the authenticated user.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
    }

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await authClient.auth.getUser()
    if (userErr || !user) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders })
    }
    const callerId = user.id

    const body = await req.json().catch(() => ({}))
    const orgId: string | undefined = body.orgId
    const deleteOrg: boolean = body.deleteOrg === true
    if (!orgId) {
      return Response.json({ error: 'missing_org_id' }, { status: 400, headers: corsHeaders })
    }

    // Service-role client: every mutation below is privileged (org/auth deletes
    // are not permitted by RLS), so it must bypass RLS. All authorization is
    // re-checked here against the verified caller — never trust the client.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load the org's members and confirm the caller belongs to it.
    const { data: membersData, error: membersErr } = await admin
      .from('org_members')
      .select('id, user_id, role, joined_at')
      .eq('org_id', orgId)
    if (membersErr) {
      return Response.json({ error: membersErr.message }, { status: 500, headers: corsHeaders })
    }
    const members = (membersData ?? []) as Member[]
    const caller = members.find(m => m.user_id === callerId)
    if (!caller) {
      return Response.json({ error: 'forbidden' }, { status: 403, headers: corsHeaders })
    }

    const soleMember = members.length === 1

    if (deleteOrg && soleMember) {
      // Sole member opted to remove the whole org. The cascade (migration 027 +
      // existing FKs) clears services, members, hours, overrides, invitations,
      // notifications, appointments, subscription_payments and service_staff.
      const { error: orgErr } = await admin.from('organisations').delete().eq('id', orgId)
      if (orgErr) {
        return Response.json({ error: orgErr.message }, { status: 500, headers: corsHeaders })
      }
    } else {
      // Keep the org. If the caller is the owner and others remain, promote the
      // longest-standing remaining member so the org is never left without one.
      if (caller.role === 'owner') {
        const others = members
          .filter(m => m.user_id !== callerId)
          .sort((a, b) => {
            if (!a.joined_at) return 1
            if (!b.joined_at) return -1
            return a.joined_at.localeCompare(b.joined_at)
          })
        const successor = others[0]
        if (successor) {
          const { error: promoteErr } = await admin
            .from('org_members')
            .update({ role: 'owner' })
            .eq('id', successor.id)
          if (promoteErr) {
            return Response.json({ error: promoteErr.message }, { status: 500, headers: corsHeaders })
          }
          await admin
            .from('organisations')
            .update({ owner_id: successor.user_id })
            .eq('id', orgId)
        }
      }
      // Remove the caller's membership in this org.
      const { error: memberErr } = await admin.from('org_members').delete().eq('id', caller.id)
      if (memberErr) {
        return Response.json({ error: memberErr.message }, { status: 500, headers: corsHeaders })
      }
    }

    // Finally delete the auth identity. This cascades any remaining org_members
    // (other orgs), notifications and superadmins for this user.
    const { error: delErr } = await admin.auth.admin.deleteUser(callerId)
    if (delErr) {
      return Response.json({ error: delErr.message }, { status: 500, headers: corsHeaders })
    }

    return Response.json({ ok: true }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
