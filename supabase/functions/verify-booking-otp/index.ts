import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashCode, normalizeGeorgianPhone } from '../_shared/otp.ts'

// Step 2 of guest-booking phone verification. Checks the code against the most
// recent unconsumed, unexpired challenge for the phone and, on success, marks it
// verified. The DB trigger enforce_booking_verification (migration 030) then lets
// the appointment insert through and consumes the row. Public (verify_jwt=false).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_ATTEMPTS = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, code } = await req.json().catch(() => ({}))
    const local = normalizeGeorgianPhone(phone)
    if (!local || !/^\d{6}$/.test(String(code ?? ''))) {
      return Response.json({ verified: false, error: 'invalid_input' }, { headers: corsHeaders })
    }

    const secret = Deno.env.get('OTP_HASH_SECRET')
    if (!secret) {
      return Response.json({ error: 'server_misconfigured' }, { status: 500, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Latest challenge for this phone that hasn't been used or expired.
    const { data: row } = await supabase
      .from('booking_verifications')
      .select('id, code_hash, attempts, expires_at')
      .eq('phone', local)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!row) {
      return Response.json({ verified: false, error: 'expired' }, { headers: corsHeaders })
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return Response.json({ verified: false, error: 'too_many_attempts' }, { headers: corsHeaders })
    }

    const matches = row.code_hash === (await hashCode(String(code), local, secret))

    if (!matches) {
      const attempts = row.attempts + 1
      await supabase.from('booking_verifications').update({ attempts }).eq('id', row.id)
      return Response.json(
        { verified: false, error: 'wrong_code', remaining: Math.max(0, MAX_ATTEMPTS - attempts) },
        { headers: corsHeaders },
      )
    }

    await supabase
      .from('booking_verifications')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', row.id)

    return Response.json({ verified: true }, { headers: corsHeaders })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: corsHeaders })
  }
})
