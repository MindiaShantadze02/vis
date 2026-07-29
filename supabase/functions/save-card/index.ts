import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Saves a card on file for post-paid usage charges. Authenticated org-admin
// call. The client tokenises with the provider SDK and sends ONLY the token +
// display metadata (last4/brand/expiry) — a PAN never reaches this function.
//
// A real provider would run a zero-value auth-and-void here to validate the
// card before storing it; the mock provider has nothing to validate, so it
// stores directly. store_org_card (service role) keeps the one-default invariant.
//
// NEVER charges at save time.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function err(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: corsHeaders })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('unauthorized', 401)

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await authClient.auth.getUser()
    if (userErr || !user) return err('unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const orgId = body.org_id as string
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const last4 = typeof body.last4 === 'string' ? body.last4.replace(/\D/g, '').slice(-4) : null
    const brand = typeof body.brand === 'string' ? body.brand.slice(0, 20) : null
    const expMonth = Number(body.exp_month)
    const expYear = Number(body.exp_year)

    if (!orgId || !token) return err('invalid_request', 400)
    if (!(Number.isInteger(expMonth) && expMonth >= 1 && expMonth <= 12)) return err('invalid_card', 422)
    if (!(Number.isInteger(expYear) && expYear >= 2000 && expYear <= 2100)) return err('invalid_card', 422)

    // Reject an already-expired card (compare against the last day of exp month).
    const expiresAt = `${expYear}-${String(expMonth).padStart(2, '0')}-01`
    const endOfExpMonth = new Date(Date.UTC(expYear, expMonth, 0)) // day 0 of next month = last day
    if (endOfExpMonth.getTime() < Date.now()) return err('card_expired', 422)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: membership } = await admin
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return err('forbidden', 403)

    // (Real provider: provider.saveCard(token) → zero-value auth-and-void here.)

    const { error: rpcErr } = await admin.rpc('store_org_card', {
      p_org_id: orgId,
      p_provider: 'mock',
      p_token: token,
      p_last4: last4,
      p_brand: brand,
      p_expires_at: expiresAt,
    })
    if (rpcErr) {
      console.error('[save-card] store_org_card:', rpcErr)
      return err('server_error', 500)
    }

    return Response.json({ ok: true, card: { last4, brand, expires_at: expiresAt } }, { headers: corsHeaders })
  } catch (e) {
    console.error('[save-card] unhandled:', e)
    return err('server_error', 500)
  }
})
