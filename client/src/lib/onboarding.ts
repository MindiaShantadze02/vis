/**
 * Shared onboarding persistence.
 *
 * The final onboarding step differs per vertical (appointments/restaurants
 * finish on the working-hours step; hotels finish on the rooms step), but they
 * all create the same set of rows. This module holds that one-shot creation so
 * both entry points call identical logic.
 */
import { supabase } from './supabase'
import { formatGeorgianPhone, scheduleToRanges } from './validation'
import { slugify } from './slug'
import { uploadResourceImage } from './catalogImages'
import type { OnboardingData } from '@/pages/onboarding/OnboardingLayout'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/**
 * Create the organisation and all its onboarding-time rows for `userId`.
 *
 * Returns `{ alreadyExisted: true }` (without creating anything) if the user is
 * already a member of an org, so the caller can just route to the dashboard.
 * Room photos are uploaded best-effort: a failed image never aborts onboarding
 * since the org/rooms already exist and photos can be added later in Settings.
 */
export async function persistOnboarding(
  data: OnboardingData,
  userId: string,
): Promise<{ orgId: string; alreadyExisted: boolean }> {
  // Guard against creating a duplicate org: if this user already belongs to
  // one, let the caller just go to the dashboard instead of inserting another.
  const { data: existing } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (existing) {
    return { orgId: existing.org_id as string, alreadyExisted: true }
  }

  const suffix = Math.random().toString(36).slice(2, 6)
  // Prefer the slug derived during the profile step; re-derive from the name as
  // a fallback (both transliterate Georgian → Latin).
  const slug = data.slug || slugify(data.name) || `org-${suffix}`

  const orgRow = {
    name: data.name,
    description: data.description || null,
    slug,
    contact_phone: data.contact_phone.trim() ? formatGeorgianPhone(data.contact_phone) : null,
    owner_id: userId,
    subscription_tier: 'free',
    vertical: data.vertical,
  }

  let attempt = await supabase.from('organisations').insert(orgRow).select('id').single()
  // Slug collision — retry once with a random suffix.
  if (attempt.error?.code === '23505') {
    attempt = await supabase
      .from('organisations')
      .insert({ ...orgRow, slug: `${slug}-${suffix}` })
      .select('id')
      .single()
  }
  if (attempt.error) throw new Error(attempt.error.message)
  const orgId = attempt.data!.id as string

  const { error: memberErr } = await supabase
    .from('org_members')
    .insert({ org_id: orgId, user_id: userId, role: 'owner', joined_at: new Date().toISOString() })
  if (memberErr) throw new Error(memberErr.message)

  if (data.services.length > 0) {
    const { error: svcErr } = await supabase.from('services').insert(
      data.services.map((s, i) => ({
        org_id: orgId, name: s.name, duration_minutes: s.duration_minutes, price: s.price, sort_order: i,
        location_type: s.location_type, meeting_link: s.meeting_link,
      })),
    )
    if (svcErr) throw new Error(svcErr.message)
  }

  // Vertical-specific inventory captured in the catalog step. Rooms/tables are
  // `resources` rows (kinds room_type / table); nightly_price & total_rooms live
  // in attrs (matches Rooms/TablesSettings).
  if (data.rooms.length > 0) {
    const { data: insertedRooms, error: roomErr } = await supabase
      .from('resources')
      .insert(data.rooms.map((r, i) => ({
        org_id: orgId, kind: 'room_type', name: r.name, capacity: r.capacity,
        attrs: { nightly_price: r.nightly_price, total_rooms: r.total_rooms },
        is_active: r.is_active, sort_order: i,
      })))
      .select('id, sort_order')
    if (roomErr) throw new Error(roomErr.message)

    // Upload each room's photos, matching inserted rows back to the draft by
    // sort_order (which we set = array index). Best-effort: never abort here.
    for (const [i, room] of data.rooms.entries()) {
      if (!room.images?.length) continue
      const resourceId = (insertedRooms ?? []).find(r => r.sort_order === i)?.id as string | undefined
      if (!resourceId) continue
      for (const [j, file] of room.images.entries()) {
        try {
          await uploadResourceImage({ orgId, resourceId, file, sortOrder: j, isPrimary: j === 0 })
        } catch (err) {
          console.error('onboarding room image upload failed', err)
        }
      }
    }
  }

  if (data.tables.length > 0) {
    const { error: tblErr } = await supabase.from('resources').insert(
      data.tables.map((tb, i) => ({
        org_id: orgId, kind: 'table', name: tb.name, capacity: tb.capacity,
        is_active: tb.is_active, sort_order: i,
      })),
    )
    if (tblErr) throw new Error(tblErr.message)
  }

  if (data.vertical === 'restaurant') {
    const { error: turnErr } = await supabase
      .from('organisations')
      .update({ reservation_turn_minutes: data.turnMinutes })
      .eq('id', orgId)
    if (turnErr) throw new Error(turnErr.message)
  }

  // Hotels have no weekly working hours (availability is date-range based), so
  // skip the template entirely for them — nothing reads it and the settings tab
  // is hidden for hotels.
  if (data.vertical !== 'hotel') {
    const templateRow: Record<string, unknown> = { org_id: orgId }
    for (const day of DAYS) {
      const s = data.workingHours[day]
      templateRow[day] = {
        open: s.open,
        ranges: s.open ? scheduleToRanges(s.openTime, s.closeTime, s.breaks) : [],
      }
    }
    const { error: hoursErr } = await supabase.from('working_hours_template').insert(templateRow)
    if (hoursErr) throw new Error(hoursErr.message)
  }

  return { orgId, alreadyExisted: false }
}
