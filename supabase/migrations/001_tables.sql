-- ============================================================
-- 001_tables.sql
-- Run this FIRST. Drops old tables and creates the new schema.
-- ============================================================

-- Drop old schema (if migrating from initial setup)
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS slots CASCADE;
DROP TABLE IF EXISTS appointment_types CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS organisations CASCADE;

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE organisations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  name                        varchar(255) NOT NULL,
  description                 text,
  slug                        varchar(100) NOT NULL UNIQUE,
  contact_phone               text,
  logo_url                    text,
  payment_config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  subscription_tier           text NOT NULL DEFAULT 'free'
                                CHECK (subscription_tier IN ('free','starter','pro','business')),
  subscription_expires_at     timestamptz,
  appointments_used_this_month int4 NOT NULL DEFAULT 0,
  owner_id                    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE organisations IS 'One row per registered business on vis.';
COMMENT ON COLUMN organisations.payment_config IS
  '{"bog":{"merchantId":"","apiKey":"","enabled":false},"tbc":{"merchantId":"","apiKey":"","enabled":false},"inPerson":{"enabled":true}}';

-- --------------------------------------------------------

CREATE TABLE services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  org_id           uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name             varchar(255) NOT NULL,
  duration_minutes int2 NOT NULL CHECK (duration_minutes > 0),
  price            numeric(10,2) NOT NULL DEFAULT 0,
  is_active        bool NOT NULL DEFAULT true,
  sort_order       int2 NOT NULL DEFAULT 0
);

COMMENT ON TABLE services IS 'Appointment types offered by an organisation (replaces appointment_types).';

-- --------------------------------------------------------

CREATE TABLE customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  first_name   varchar(100) NOT NULL,
  last_name    varchar(100),
  phone_number text NOT NULL
);

COMMENT ON TABLE customers IS 'Guest customers — no auth account required. Looked up by phone on each booking.';

-- ============================================================
-- ORG MANAGEMENT
-- ============================================================

CREATE TABLE org_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  org_id      uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin')),
  invited_by  uuid REFERENCES auth.users(id),
  joined_at   timestamptz,
  UNIQUE (org_id, user_id)
);

COMMENT ON TABLE org_members IS 'Maps Supabase auth users to organisations with a role.';

-- --------------------------------------------------------

CREATE TABLE invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  org_id       uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  role         text NOT NULL DEFAULT 'admin',
  invited_by   uuid REFERENCES auth.users(id),
  token        text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at  timestamptz
);

COMMENT ON TABLE invitations IS 'Pending phone-based admin invitations. Token sent via SMS.';

-- ============================================================
-- SCHEDULING
-- ============================================================

CREATE TABLE working_hours_template (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  org_id                   uuid NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
  monday                   jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  tuesday                  jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  wednesday                jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  thursday                 jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  friday                   jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  saturday                 jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  sunday                   jsonb NOT NULL DEFAULT '{"open":false,"ranges":[]}'::jsonb,
  max_appointments_per_slot int2 NOT NULL DEFAULT 1 CHECK (max_appointments_per_slot > 0),
  slot_duration_minutes    int2 NOT NULL DEFAULT 30 CHECK (slot_duration_minutes > 0)
);

COMMENT ON TABLE working_hours_template IS
  'Weekly recurring schedule per org. Each day: {"open":bool,"ranges":[{"start":"09:00","end":"17:00"}]}';

-- --------------------------------------------------------

CREATE TABLE working_hours_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  org_id     uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  date       date NOT NULL,
  is_closed  bool NOT NULL DEFAULT false,
  ranges     jsonb,
  note       text,
  UNIQUE (org_id, date)
);

COMMENT ON TABLE working_hours_overrides IS
  'Per-date exceptions: holidays or special hours. Overrides the weekly template for that date.';

-- ============================================================
-- APPOINTMENTS
-- ============================================================

CREATE TABLE appointments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  org_id           uuid NOT NULL REFERENCES organisations(id),
  service_id       uuid NOT NULL REFERENCES services(id),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  scheduled_at     timestamptz NOT NULL,
  duration_minutes int2 NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','cancelled','completed')),
  payment_method   text NOT NULL
                     CHECK (payment_method IN ('online','in_person')),
  payment_status   text NOT NULL DEFAULT 'unpaid'
                     CHECK (payment_status IN ('unpaid','paid','refunded')),
  payment_provider text CHECK (payment_provider IN ('bog','tbc')),
  payment_reference text,
  notes            text,
  admin_notes      text
);

COMMENT ON TABLE appointments IS
  'Core booking record. duration_minutes is snapshotted from services at booking time.';

-- ============================================================
-- PLATFORM TABLES
-- ============================================================

CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  org_id         uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type           text NOT NULL
                   CHECK (type IN ('new_appointment','pending_approval','appointment_cancelled')),
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  title          text NOT NULL,
  body           text,
  read_at        timestamptz
);

COMMENT ON TABLE notifications IS 'In-app notification bell items for dashboard users.';

-- --------------------------------------------------------

CREATE TABLE sms_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  org_id              uuid REFERENCES organisations(id) ON DELETE SET NULL,
  appointment_id      uuid REFERENCES appointments(id) ON DELETE SET NULL,
  recipient_phone     text NOT NULL,
  message_type        text NOT NULL
                        CHECK (message_type IN (
                          'booking_confirmation','approval_update',
                          'admin_new_booking','admin_reminder','invitation'
                        )),
  provider            text,
  provider_message_id text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','failed')),
  error               text
);

COMMENT ON TABLE sms_log IS 'Audit trail for every SMS sent through the platform.';

-- --------------------------------------------------------

CREATE TABLE subscription_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  org_id           uuid NOT NULL REFERENCES organisations(id),
  tier             text NOT NULL,
  amount           numeric(10,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'GEL',
  payment_provider text CHECK (payment_provider IN ('bog','tbc')),
  payment_reference text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','failed')),
  period_start     date,
  period_end       date
);

COMMENT ON TABLE subscription_payments IS 'Records of vis subscription billing payments per org.';

-- --------------------------------------------------------

CREATE TABLE platform_config (
  id                  int PRIMARY KEY DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  sms_provider        text,
  sms_config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier_limits         jsonb NOT NULL DEFAULT '{"free":30,"starter":200,"pro":600,"business":null}'::jsonb,
  tier_prices         jsonb NOT NULL DEFAULT '{"starter":15,"pro":40,"business":80}'::jsonb,
  superadmin_user_id  uuid,
  CONSTRAINT single_row CHECK (id = 1)
);

COMMENT ON TABLE platform_config IS
  'Single-row platform settings table. superadmin_user_id gates the /superadmin panel.';
COMMENT ON COLUMN platform_config.tier_limits IS
  'null means unlimited. Update via SQL to change limits without code deploy.';

-- Seed the single config row
INSERT INTO platform_config (id) VALUES (1) ON CONFLICT DO NOTHING;
