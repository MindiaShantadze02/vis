-- ============================================================
-- 042_fix_org_anon_grant.sql
-- Fixes H2 properly. 041 used a column-level REVOKE on
-- organisations(payment_config, owner_id), but that is a no-op while
-- anon still holds TABLE-level SELECT (which implicitly covers every
-- column). Live check confirmed anon could still read payment_config
-- (which carries per-org gateway secrets).
--
-- Correct pattern (same as appointments in 040): drop anon's
-- table-level SELECT, then grant back only the public booking columns.
-- payment_config and owner_id are deliberately omitted; anon reads the
-- safe, secret-stripped view through get_public_org().
-- ============================================================

REVOKE SELECT ON organisations FROM anon;

GRANT SELECT (
  id,
  name,
  description,
  slug,
  contact_phone,
  logo_url,
  booking_theme
) ON organisations TO anon;
