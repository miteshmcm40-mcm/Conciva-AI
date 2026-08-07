-- ============================================================================
-- Voice Agent Portal — database schema
-- ============================================================================
-- Reconstructed from the SQL the server actually issues (server/*.js), because
-- the original schema was never committed (.gitignore excludes it) and no dump
-- existed on the host. Every column below is referenced by a real query in the
-- codebase. Safe to re-run: all objects use IF NOT EXISTS / ON CONFLICT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT,
  company                TEXT,
  username               TEXT UNIQUE,
  email                  TEXT UNIQUE,
  phone                  TEXT,
  password_hash          TEXT,
  role                   TEXT NOT NULL DEFAULT 'customer',   -- 'admin' | 'customer'

  -- Plan
  plan_label             TEXT,
  plan_amount            NUMERIC(12,2) DEFAULT 0,
  plan_min               INTEGER DEFAULT 0,
  plan_rate              NUMERIC(12,4) DEFAULT 0,
  plan_agents            INTEGER DEFAULT 0,

  -- Phone number
  number_value           TEXT,
  number_loc             TEXT,
  number_price           NUMERIC(12,2) DEFAULT 0,
  twilio_sid             TEXT,

  -- Agent / knowledge base
  voice                  TEXT,
  agent_name             TEXT,
  greeting               TEXT,
  prompt                 TEXT,
  kb_company             TEXT,
  kb_faqs                TEXT,

  -- Wallet & usage
  minutes_used           NUMERIC(12,2) DEFAULT 0,
  wallet_minutes         NUMERIC(12,2) DEFAULT 0,
  wallet_usd             NUMERIC(12,2) DEFAULT 0,
  low_balance_threshold  NUMERIC(12,2) DEFAULT 20,
  auto_topup_enabled     BOOLEAN DEFAULT false,
  auto_topup_pack_min    INTEGER DEFAULT 100,
  auto_topup_pack_usd    NUMERIC(12,2) DEFAULT 0,

  -- Stripe
  stripe_customer_id     TEXT,

  -- LiveKit / agent provisioning
  provisioning_status    TEXT DEFAULT 'unprovisioned',
  provisioning_error     TEXT,
  provisioned_at         TIMESTAMPTZ,
  livekit_trunk_id       TEXT,
  livekit_dispatch_id    TEXT,
  livekit_room_name      TEXT,
  agent_id               TEXT,
  agent_slug             TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- One-time codes for email verification during self-signup. `payload` holds
-- the pending account's other fields (name/company/password_hash) so the
-- user row is only created once the code is confirmed. A row is deleted on
-- successful verification or expiry — at most one live code per email+purpose.
CREATE TABLE IF NOT EXISTS email_otps (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'signup',
  otp_code    TEXT NOT NULL,
  payload     JSONB,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_otps_email ON email_otps(email, purpose);

-- One row per phone number a user owns. The shared voice agent lives on
-- users.agent_id / users.agent_slug; every number here just dispatches to that
-- agent. The user's "primary" number (selected at signup) is also mirrored
-- onto users.number_value for backward compat with older code paths.
CREATE TABLE IF NOT EXISTS user_numbers (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number_value         TEXT NOT NULL UNIQUE,
  label                TEXT,
  is_primary           BOOLEAN NOT NULL DEFAULT false,
  livekit_trunk_id     TEXT,
  livekit_dispatch_id  TEXT,
  provisioning_status  TEXT NOT NULL DEFAULT 'unprovisioned',
  provisioning_error   TEXT,
  provisioned_at       TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_numbers_user ON user_numbers(user_id);
-- At most one primary per user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_numbers_primary
  ON user_numbers(user_id) WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS pending_signups (
  id                 SERIAL PRIMARY KEY,
  token              TEXT UNIQUE NOT NULL,
  payload            JSONB NOT NULL,
  consumed           BOOLEAN NOT NULL DEFAULT false,
  consumed_at        TIMESTAMPTZ,
  resulting_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stripe_session_id  TEXT,
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand         TEXT,
  last4         TEXT,
  exp_month     INTEGER,
  exp_year      INTEGER,
  cardholder    TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  stripe_pm_id  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pm_user ON payment_methods(user_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,           -- 'signup' | 'topup' | 'number_rental'
  minutes_delta      NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_usd         NUMERIC(12,2) NOT NULL DEFAULT 0,
  description        TEXT,
  payment_method_id  INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'failed'
  failure_reason     TEXT,
  external_ref       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wtx_user ON wallet_transactions(user_id);
-- external_ref drives idempotency (SELECT 1 ... WHERE external_ref = $1); enforce it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wtx_external_ref
  ON wallet_transactions(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  is_secret   BOOLEAN NOT NULL DEFAULT false,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);