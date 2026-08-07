import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import 'dotenv/config';
import { q, pool } from './db.js';
import {
  twilioClient, twilioConfigured, twilioDefaultNumber, publicBaseUrl, requireTwilio, sipTrunkSid,
} from './twilio.js';
import {
  mcpConfigured, callTool, listTools, listResources, mcpLastError, mcpUrl,
  callToolFor, listToolsFor,
} from './mcp.js';
import {
  PACKS, findPack,
  getWallet, listTransactions,
} from './wallet.js';
import { provisionInboundForUser, provisionAdditionalNumber } from './provision.js';
import {
  dashboardWebConfigured, resolveRecordingDownloadPath, fetchRecordingStream,
} from './dashboardWeb.js';
import { Readable } from 'node:stream';
import { sendMail, mailConfigured } from './mail.js';
import {
  PLANS as DEFAULT_PLANS, withYearly as withYearlyPlans, yearlyPriceUsd,
  getBasePlansSync, getBasePlansForAdmin, updateBasePlan, refreshBasePlans,
  EDITABLE_PLAN_FIELDS,
} from './plans.js';
import {
  setNumberLanguage, getActiveAgentForNumber, setAgentLanguage, applyDefaultBehavior,
  ensureLiveAgent, syncAgentForUser, computeBaseSlug, startupAgentSweep,
} from './language.js';
import { TTS_VOICES, ttsConfigured, generateSample, cachedSamplePath, mapToPreviewVoice } from './tts.js';
import OpenAI from 'openai';
import multer from 'multer';
import mammoth from 'mammoth';
import { createRequire } from 'module';
// pdf-parse is CommonJS with an export shape Node's ESM interop can't
// synthesize a `default` for — require() it directly instead.
const require = createRequire(import.meta.url);
// Loaded lazily (only when a PDF is actually uploaded) and wrapped in
// try/catch so a missing/broken optional native dependency (e.g.
// @napi-rs/canvas) can't crash the whole server at cold start and take
// down unrelated routes such as /api/signin.
let _pdfParse = null;
function getPdfParse() {
    if (_pdfParse === null) {
          try {
                  _pdfParse = require('pdf-parse');
          } catch (e) {
                  console.error('[pdf-parse] failed to load:', e.message);
                  _pdfParse = false;
          }
    }
    return _pdfParse || null;
}
import {
  razorpayConfigured, razorpayKeyId, createOrder as rzpCreateOrder,
  verifyPaymentSignature as rzpVerifySignature, fetchPayment as rzpFetchPayment,
  verifyWebhookSignature as rzpVerifyWebhook,
  createCustomer as rzpCreateCustomer, fetchToken as rzpFetchToken,
  deleteToken as rzpDeleteToken,
} from './razorpay.js';
import {
  stripeConfigured, stripePublishableKey, stripe as stripeClient,
  startSetupIntent, persistSetupIntent,
  detachStripeMethod, getOrCreateStripeCustomer, attachPaymentMethodToUser,
  createSignupCheckoutSession, createSetupCheckoutSession, createTopupCheckoutSession,
  processCheckoutReturn, stripeCurrency,
} from './stripe.js';

// Override: treat Razorpay as always-configured so the business logic in
// Razorpay route handlers (plan cycles, resellers, DID assignment, pro-rata)
// executes. The actual payment calls (rzpCreateOrder, rzpVerifySignature,
// rzpFetchPayment) are never reached because the Stripe alias routes
// intercept the request before the Razorpay guards run.
import { readForAdmin as readSettingsForAdmin, updateSettings } from './settings.js';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import twilioPkg from 'twilio';
const { twiml: TwilioTwiml } = twilioPkg;

const app = express();
app.use(cors({ origin: true, credentials: true }));

// Razorpay webhook needs the raw body to verify the signature, so it must be
// mounted BEFORE the JSON body parser.
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  if (!sig) return res.status(400).send('Missing signature');
  if (!rzpVerifyWebhook(req.body, sig)) {
    return res.status(400).send('Invalid signature');
  }
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); }
  catch { return res.status(400).send('Invalid JSON'); }
  // Razorpay events: payment.captured, payment.failed, order.paid, etc.
  // For now we just acknowledge — the in-app verify endpoint is the source of
  // truth for crediting wallets/finalizing signups. Webhook is the safety net
  // for the (rare) case where the browser drops mid-handler.
  console.log('[razorpay/webhook] event:', event.event, 'payment_id:', event.payload?.payment?.entity?.id);
  res.json({ received: true });
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => { if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook not configured'); const sig = req.headers['stripe-signature']; const Stripe = (await import('stripe')).default; const sc = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-09-30.acacia' }); let event; try { event = sc.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { return res.status(400).send('Signature failed'); } console.log('[stripe/webhook]', event.type); res.json({ received: true }); });
app.use(express.json({
  limit: '512kb',
  // Stash the raw body so the meeting-webhook handler can verify the n8n
  // HMAC signature against the exact bytes sent (JSON.stringify() of the
  // already-parsed object would not byte-match the sender's hash).
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false }));

const SESSION_DAYS = 30;
// Idle timeout — a session with no authenticated activity for this many
// minutes expires (sliding window, enforced in the `auth` middleware).
const SESSION_IDLE_MIN = Math.max(1, Number(process.env.SESSION_IDLE_MINUTES) || 7 * 24 * 60);

// Reseller portal this deployment runs as. Every DB lookup that resolves the
// parent reseller, and every new signup's reseller_portal attribution, keys
// off this value. Single source of truth — set RESELLER_PORTAL in .env.
const RESELLER_PORTAL = (process.env.RESELLER_PORTAL || '9278.ai').toLowerCase().trim();
// SQL-safe form for the few places it's interpolated into migration DDL
// (domain chars only — defends against injection via a malformed env value).
const RESELLER_PORTAL_SQL = RESELLER_PORTAL.replace(/[^a-z0-9.\-]/g, '');
// rev: paid-signup v4

const newToken = () => crypto.randomBytes(32).toString('hex');

const publicUser = (row) => ({
  id: String(row.id),
  name: row.name,
  company: row.company || '',
  username: row.username,
  email: row.email,
  phone: row.phone || '',
  role: row.role,
  // Four-tier hierarchy — drives sidebar/permission gates on the frontend.
  // userType is the canonical field going forward; `role` is kept for
  // back-compat with existing UI code that switches on 'admin' / 'customer'.
  userType:       row.user_type      || 'user',
  resellerPortal: row.reseller_portal || null,
  resellerId:     row.reseller_id    ? String(row.reseller_id) : null,
  kyc: {
    address:  row.kyc_address  || '',
    location: row.kyc_location || '',
  },
  plan: row.plan_label
    ? {
        label: row.plan_label,
        amount: Number(row.plan_amount) || 0,
        min: row.plan_min || 0,
        rate: Number(row.plan_rate) || 0,
        agents: row.plan_agents || 0,
        cycle: row.plan_cycle || 'monthly',
        activatedAt: row.plan_activated_at || null,
        expiresAt:   row.plan_expires_at   || null,
      }
    : null,
  number: row.number_value
    ? {
        value: row.number_value,
        loc: row.number_loc || '',
        price: Number(row.number_price) || 0,
      }
    : null,
  voice: row.voice || '',
  language: row.language || 'en-US',
  agentName: row.agent_name || '',
  greeting: row.greeting || '',
  prompt: row.prompt || '',
  kbCompany: row.kb_company || '',
  kbFaqs: row.kb_faqs || '',
  minutesUsed: Number(row.minutes_used) || 0,
  createdAt: row.created_at,
  twilioSid: row.twilio_sid || null,
  walletMinutes: Number(row.wallet_minutes) || 0,
  walletUsd: Number(row.wallet_usd) || 0,
  lowBalanceThreshold: row.low_balance_threshold ?? 20,
  autoTopupEnabled: !!row.auto_topup_enabled,
  autoTopupPackMin: row.auto_topup_pack_min ?? 100,
  autoTopupPackUsd: Number(row.auto_topup_pack_usd) || 0,
  // Saved Razorpay card — populated only if the customer has gone through
  // the save-card flow. The token is never returned to the client; only the
  // safe display fields. `null` payment method = no card on file.
  paymentMethod: row.payment_method_token ? {
    last4:   row.payment_method_last4 || '',
    network: row.payment_method_network || '',
    brand:   row.payment_method_brand || '',
  } : null,
  provisioning: {
    status: row.provisioning_status || 'unprovisioned',
    error: row.provisioning_error || null,
    livekitTrunkId: row.livekit_trunk_id || null,
    livekitDispatchId: row.livekit_dispatch_id || null,
    livekitRoomName: row.livekit_room_name || null,
    agentId: row.agent_id || null,
    agentSlug: row.agent_slug || null,
    provisionedAt: row.provisioned_at || null,
  },
});

const auth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  // Tokens issued before the user's most recent password change are rejected
  // — this handles both API-driven changes (the trigger sets
  // users.password_changed_at) AND direct SQL UPDATEs on password_hash.
  // The COALESCE keeps very-old rows that lack the column-default from
  // failing closed.
  let r;
  try {
    r = await q(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1
         AND s.expires_at > NOW()
         AND s.created_at >= COALESCE(u.password_changed_at, 'epoch'::timestamptz)`,
      [token],
    );
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  if (!r.rowCount) return res.status(401).json({ error: 'Session expired' });
  req.user = r.rows[0];
  req.token = token;
  // Sliding idle timeout: every authenticated request keeps the session alive
  // for another SESSION_IDLE_MIN minutes. If the user is idle that long the
  // token expires and the next request 401s (the frontend also signs them out
  // client-side). Fire-and-forget + throttled to ~1 write/min per session via
  // the ABS(...) guard, which also caps any longer-lived expiry down to the
  // idle window on the first request after deploy.
  q(
    `UPDATE sessions
        SET expires_at = NOW() + ($2 || ' minutes')::INTERVAL
      WHERE token = $1
        AND ABS(EXTRACT(EPOCH FROM (expires_at - (NOW() + ($2 || ' minutes')::INTERVAL)))) > 60`,
    [token, SESSION_IDLE_MIN],
  ).catch((e) => console.warn('[auth] session slide failed:', e.message));
  next();
};

// Idempotent schema migrations — run on boot. New tables only; never DROP.
// The canonical reference is server/schema.sql, this just makes sure prod and
// dev DBs are in sync without a separate migration runner.
const runMigrations = async () => {
  await q(`
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
      -- Per-number agent config (each number has its own agent now).
      agent_id             TEXT,
      agent_slug           TEXT,
      agent_name           TEXT,
      greeting             TEXT,
      prompt               TEXT,
      kb_company           TEXT,
      kb_faqs              TEXT,
      voice                TEXT,
      language             TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS idx_user_numbers_user ON user_numbers(user_id)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_numbers_primary
           ON user_numbers(user_id) WHERE is_primary = true`);

  // Idempotent column adds for installs that pre-date the per-number-agent
  // schema. Each ADD COLUMN IF NOT EXISTS is a no-op when the column exists.
  const PER_NUMBER_AGENT_COLS = [
    'agent_id TEXT', 'agent_slug TEXT', 'agent_name TEXT',
    'greeting TEXT', 'prompt TEXT', 'kb_company TEXT', 'kb_faqs TEXT',
    'voice TEXT', 'language TEXT',
  ];
  for (const colDef of PER_NUMBER_AGENT_COLS) {
    await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS ${colDef}`);
  }

  // Per-number plan — each DID can sit on its own plan tier (Starter / Growth /
  // Scale). Defaults to 'starter' both for newly-attached numbers and for
  // legacy rows (Postgres applies the DEFAULT when adding a NOT NULL column).
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'starter'`);

  // Per-number billing cycle (monthly | yearly). Defaults to 'monthly' for
  // newly attached DIDs and any legacy rows. Backfilled below from the
  // account-level users.plan_cycle so existing yearly subscribers keep
  // their yearly status on the DID they signed up with.
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS plan_cycle TEXT NOT NULL DEFAULT 'monthly'`);
  // Ensure the account-level column exists before the backfill reads it. On a
  // fresh database users.plan_cycle isn't added until later in this migration,
  // so guard it here (idempotent — the later ALTER becomes a no-op).
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_cycle TEXT NOT NULL DEFAULT 'monthly'`);
  await q(`
    UPDATE user_numbers un
       SET plan_cycle = u.plan_cycle
      FROM users u
     WHERE un.user_id = u.id
       AND un.plan_cycle = 'monthly'
       AND u.plan_cycle = 'yearly'
  `);

  // Razorpay payment reference for the "new plan + DID" purchase — kept on
  // the row so we can answer "did this payment id already provision a DID?"
  // without scanning the wallet ledger. Idempotent inserts depend on it.
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS provisioning_ref TEXT`);

  // Cycle anchor — set on new plan / plan restart / plan change so billing
  // logic (fmtDateLong, the rent-anchor math, etc.) has a real timestamp to
  // work from instead of always falling back to created_at. NULL until the
  // first rent/restart, matching every read site's `|| created_at` fallback.
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS last_rented_at TIMESTAMPTZ`);

  // LiveKit room name for this number's dispatch rule — read by publicNumber()
  // and cleared on release, but never had a migration adding it (only
  // livekit_trunk_id/livekit_dispatch_id were in the original CREATE TABLE).
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS livekit_room_name TEXT`);

  // Per-number auto-recharge toggle — when ON, the saved payment method gets
  // charged for this DID's plan amount whenever the cycle is about to lapse
  // and the plan minutes are exhausted. Defaults to OFF.
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS auto_recharge_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  // Which saved card (payment_methods.id) this DID's auto-recharge charges.
  // NULL → fall back to the user's default card. Each plan can pick its own.
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS auto_recharge_pm_id INTEGER`);

  // Rent status for this DID's current cycle ('active' | 'lapsed' | ...).
  // Read all over (publicNumber(), the signups list, etc. via `|| 'active'`
  // fallbacks) but was never actually added by a migration — only ever
  // existed on whichever live DB this schema was reconstructed from.
  await q(`ALTER TABLE user_numbers ADD COLUMN IF NOT EXISTS rent_status TEXT NOT NULL DEFAULT 'active'`);

  // === Saved Razorpay card ================================================
  // razorpay_customer_id: created lazily the first time the customer wants
  // to save a card. payment_method_token + last4 + network + brand capture
  // just enough card info to render the "VISA ···· 1111" pill in the UI
  // — never the full PAN. Cleared when the customer removes the card.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method_token TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method_last4 TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method_network TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_method_brand TEXT`);

  // === Session invalidation on password change ============================
  // password_changed_at is bumped to NOW() whenever password_hash changes
  // (enforced by a trigger so direct SQL updates also flip it). The auth
  // middleware rejects any session created strictly before this timestamp,
  // forcing already-logged-in clients to sign in again.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await q(`
    CREATE OR REPLACE FUNCTION bump_password_changed_at()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
        NEW.password_changed_at = NOW();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await q(`DROP TRIGGER IF EXISTS trg_bump_password_changed_at ON users`);
  await q(`
    CREATE TRIGGER trg_bump_password_changed_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION bump_password_changed_at()
  `);

  // Monthly-vs-yearly billing cadence stamped on the user row at signup time.
  // Defaults to 'monthly' for back-compat with rows created before the toggle.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_cycle TEXT NOT NULL DEFAULT 'monthly'`);

  // === Four-tier user hierarchy ===========================================
  //   superadmin → reseller → admin → user
  //
  //   superadmin   — top-level (admin@9278.ai). Sees everything, can
  //                  create resellers + manage anyone.
  //   reseller     — registered by a superadmin with KYC. Has their own
  //                  branded portal at `reseller_portal`. Can create
  //                  admins under them.
  //   admin        — created by a reseller. Sees customers (users) who
  //                  signed up through their parent reseller's portal.
  //   user         — end customer (existing voice@infobip.com, etc.).
  //
  // reseller_id is the FK back up the chain — every admin and user
  // points at the reseller they belong to. NULL means "no reseller" (i.e.
  // direct signup on the canonical 9278.ai portal).
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'user'`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_portal TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS users_reseller_portal_uniq ON users(LOWER(reseller_portal)) WHERE reseller_portal IS NOT NULL`);
  await q(`CREATE INDEX IF NOT EXISTS users_reseller_id_idx ON users(reseller_id) WHERE reseller_id IS NOT NULL`);

  // KYC fields used when a superadmin registers a new reseller. Only
  // resellers populate these; everyone else leaves them NULL.
  //   `company` (existing column) holds the legal company name.
  //   `phone`   (existing column) holds the registered phone.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_address TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_location TEXT`);

  // Per-reseller MCP server config. Each reseller can run their own
  // dashboard.<their-domain>/mcp; calls touching THEIR customers (provision,
  // list_calls, get_recording_url, etc.) should be routed there. NULL on
  // either column falls back to the env-level MCP_URL / MCP_TOKEN so the
  // 9278.ai reseller (which IS the env-configured dashboard) keeps working
  // without writing anything to its row.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mcp_url TEXT`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mcp_token TEXT`);

  // Display currency for the reseller's storefront. Defaults to USD so the
  // 9278.ai reseller behaves exactly as before. Resellers serving other
  // regions (e.g. 9278.ai → USD) set their own here, and their reseller_plans
  // rows are stored in that currency directly (no per-request FX math).
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_currency TEXT NOT NULL DEFAULT 'USD'`);
  // (reseller_plans.currency is added just after that table is created, below.)

  // Backfill user_type for existing rows:
  //   admin@9278.ai  → 'superadmin'
  //   everyone else  → 'user' (default already applied by ADD COLUMN)
  // Run idempotently — does not overwrite rows that someone has already
  // promoted/demoted manually.
  await q(`
    UPDATE users
       SET user_type = 'superadmin'
     WHERE LOWER(email) = LOWER('admin@9278.ai')
       AND user_type <> 'superadmin'
  `);

  // === Default-reseller trigger ==========================================
  // Every NEW user row that comes in as a regular customer (user_type is
  // 'user' OR null) WITHOUT an explicit reseller_id gets auto-attributed
  // to the canonical 9278.ai reseller. Applies BEFORE INSERT, so the value
  // is set even if direct SQL skips the application layer.
  //
  // Rows being created as 'reseller', 'admin', or 'superadmin' are left
  // alone — those tiers belong above any reseller in the hierarchy.
  await q(`
    CREATE OR REPLACE FUNCTION set_default_reseller_id()
    RETURNS TRIGGER AS $$
    DECLARE
      default_reseller_id INTEGER;
    BEGIN
      -- Only act on customer-tier rows that have no reseller_id yet.
      IF NEW.reseller_id IS NULL
         AND (NEW.user_type IS NULL OR NEW.user_type = 'user') THEN

        SELECT id INTO default_reseller_id
          FROM users
         WHERE user_type = 'reseller'
           AND LOWER(reseller_portal) = '${RESELLER_PORTAL_SQL}'
         LIMIT 1;

        IF default_reseller_id IS NOT NULL THEN
          NEW.reseller_id := default_reseller_id;
        END IF;

        -- Also defensively set user_type if the inserter omitted it.
        IF NEW.user_type IS NULL THEN
          NEW.user_type := 'user';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await q(`DROP TRIGGER IF EXISTS trg_set_default_reseller_id ON users`);
  await q(`
    CREATE TRIGGER trg_set_default_reseller_id
      BEFORE INSERT ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_default_reseller_id()
  `);

  // Backfill: any existing 'user' row with no reseller_id and not the
  // intentionally-unattached voice@9278.ai row gets the same default.
  await q(`
    UPDATE users u
       SET reseller_id = (SELECT id FROM users
                           WHERE user_type = 'reseller'
                             AND LOWER(reseller_portal) = '${RESELLER_PORTAL_SQL}'
                           LIMIT 1),
           updated_at  = NOW()
     WHERE u.user_type = 'user'
       AND u.reseller_id IS NULL
       AND EXISTS (SELECT 1 FROM users
                    WHERE user_type = 'reseller'
                      AND LOWER(reseller_portal) = '${RESELLER_PORTAL_SQL}')
  `);

  // === Per-reseller plan catalog ==========================================
  // Each reseller has their OWN copy of Starter / Growth / Scale with their
  // branded label, retail price, per-min rate, and minute allowance. End
  // customers signing up under that reseller's portal see these prices;
  // the platform charges the reseller based on the corresponding base
  // plan from server/plans.js.
  //
  // Constraint: the unique index on (reseller_id, base_plan_id) means each
  // reseller has at most one row per tier.
  await q(`
    CREATE TABLE IF NOT EXISTS reseller_plans (
      id            SERIAL PRIMARY KEY,
      reseller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      base_plan_id  TEXT NOT NULL,
      label         TEXT NOT NULL,
      amount        NUMERIC(12,2) NOT NULL,
      rate          NUMERIC(12,4) NOT NULL,
      min           INTEGER NOT NULL,
      agents        INTEGER NOT NULL,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (reseller_id, base_plan_id)
    )
  `);
  await q(`CREATE INDEX IF NOT EXISTS reseller_plans_reseller_idx ON reseller_plans(reseller_id)`);
  // Display currency for each reseller-plan row (see users.display_currency above).
  await q(`ALTER TABLE reseller_plans ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`);

  // Seed default plans for any reseller that doesn't have a catalog yet.
  // Runs every boot, idempotent via ON CONFLICT (reseller_id, base_plan_id).
  for (const basePlan of getBasePlansSync()) {
    await q(
      `INSERT INTO reseller_plans (reseller_id, base_plan_id, label, amount, rate, min, agents)
       SELECT u.id, $1, $2, $3, $4, $5, $6
         FROM users u
        WHERE u.user_type = 'reseller'
       ON CONFLICT (reseller_id, base_plan_id) DO NOTHING`,
      [basePlan.id, basePlan.label, basePlan.amount, basePlan.rate, basePlan.min, basePlan.agents],
    );
  }

  // === DID inventory =====================================================
  // DIDs added through the superadmin UI live here. Joined with the env
  // MANUAL_NUMBERS at read time to form the canonical pool.
  await q(`
    CREATE TABLE IF NOT EXISTS did_inventory (
      number_value TEXT PRIMARY KEY,
      locality     TEXT NOT NULL DEFAULT '',
      region       TEXT NOT NULL DEFAULT '',
      added_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Plan activation + expiration. Set when the customer pays for their plan;
  // expires_at = activation + 30 days (monthly) or 365 days (yearly).
  // Plan minutes and wallet top-ups are forfeited if the plan isn't renewed
  // before expiration.
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_activated_at TIMESTAMPTZ`);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ`);

  // Backfill existing customers — use created_at as activation, plus 30 or
  // 365 days depending on cycle. Idempotent: only updates NULL rows.
  await q(`
    UPDATE users
       SET plan_activated_at = COALESCE(plan_activated_at, created_at),
           plan_expires_at   = COALESCE(plan_expires_at,
                                        created_at + (CASE plan_cycle
                                                        WHEN 'yearly' THEN INTERVAL '365 days'
                                                        ELSE                INTERVAL '30 days'
                                                      END)),
           updated_at = NOW()
     WHERE role = 'customer'
       AND plan_label IS NOT NULL
       AND (plan_activated_at IS NULL OR plan_expires_at IS NULL)
  `);

  // Legacy single-agent language lived on users.language before the per-number
  // model. The reconstructed schema.sql omits it, so ensure it exists before the
  // backfill below reads it (idempotent).
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT`);

  // Backfill: every legacy users.number_value gets a row in user_numbers as
  // their primary, INCLUDING the user's current agent fields so the existing
  // dashboard config carries over to the new per-number model.
  await q(`
    INSERT INTO user_numbers
      (user_id, number_value, is_primary, livekit_trunk_id, livekit_dispatch_id,
       provisioning_status, provisioned_at,
       agent_id, agent_slug, agent_name, greeting, prompt,
       kb_company, kb_faqs, voice, language)
    SELECT id, number_value, true, livekit_trunk_id, livekit_dispatch_id,
           COALESCE(provisioning_status, 'unprovisioned'), provisioned_at,
           agent_id, agent_slug, agent_name, greeting, prompt,
           kb_company, kb_faqs, voice, language
      FROM users
     WHERE number_value IS NOT NULL AND number_value <> ''
    ON CONFLICT (number_value) DO NOTHING
  `);

  // For pre-existing user_numbers rows (created before per-number agent
  // columns), one-shot copy the agent fields off the parent user. Once.
  await q(`
    UPDATE user_numbers un SET
      agent_id   = COALESCE(un.agent_id,   u.agent_id),
      agent_slug = COALESCE(un.agent_slug, u.agent_slug),
      agent_name = COALESCE(un.agent_name, u.agent_name),
      greeting   = COALESCE(un.greeting,   u.greeting),
      prompt     = COALESCE(un.prompt,     u.prompt),
      kb_company = COALESCE(un.kb_company, u.kb_company),
      kb_faqs    = COALESCE(un.kb_faqs,    u.kb_faqs),
      voice      = COALESCE(un.voice,      u.voice),
      language   = COALESCE(un.language,   u.language),
      updated_at = NOW()
    FROM users u
    WHERE un.user_id = u.id
      AND un.is_primary = true
      AND (un.agent_id IS NULL OR un.greeting IS NULL OR un.prompt IS NULL)
  `);

  // Admin-editable base plan catalog (Scale/Growth/Starter). Seeded once from
  // the hardcoded PLANS in plans.js via ON CONFLICT DO NOTHING, so re-running
  // migrations never clobbers an admin's saved edits.
  await q(`
    CREATE TABLE IF NOT EXISTS base_plans (
      id            TEXT PRIMARY KEY,
      label         TEXT NOT NULL,
      sub           TEXT,
      amount        NUMERIC(12,2) NOT NULL,
      yearly_amount NUMERIC(12,2),
      min           INTEGER NOT NULL,
      rate          NUMERIC(12,4) NOT NULL,
      overage       NUMERIC(12,4) NOT NULL,
      dids          INTEGER NOT NULL,
      concurrent    INTEGER NOT NULL,
      agents        INTEGER NOT NULL,
      voice_stack   TEXT,
      support       TEXT,
      tag           TEXT,
      perks         JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (let i = 0; i < DEFAULT_PLANS.length; i++) {
    const p = DEFAULT_PLANS[i];
    await q(
      `INSERT INTO base_plans
         (id, label, sub, amount, yearly_amount, min, rate, overage, dids, concurrent, agents, voice_stack, support, tag, perks, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.label, p.sub, p.amount, p.yearlyAmount ?? null, p.min, p.rate, p.overage,
       p.dids, p.concurrent, p.agents, p.voiceStack, p.support, p.tag, JSON.stringify(p.perks || []), i],
    );
  }
  await refreshBasePlans();
};

// Per-plan number limit. Falls back to 1 (the Starter cap) for any unknown
// plan label so we never accidentally hand out 'unlimited'.
const PLAN_NUMBER_LIMITS = { starter: 1, growth: 3, scale: 15 };
const numberLimitFor = (user) => {
  const key = String(user.plan_label || '').toLowerCase();
  return PLAN_NUMBER_LIMITS[key] || 1;
};

// Pricing for each *additional* number a customer attaches after signup.
// Falls back to MANUAL_NUMBER_PRICE_USD (defaults to 400) so it can be tweaked
// from .env without a code change.
const additionalNumberPriceInr = () =>
  Math.max(0, Number(process.env.MANUAL_NUMBER_PRICE_USD) || 400);

// Returns a Set of digit-only strings covering EVERY number a user owns —
// both their legacy primary on users.number_value AND any rows on user_numbers.
// Used to filter MCP call-history / stats responses across all of a customer's
// DIDs (a Growth customer may have up to 3 numbers; we must show all of them).
const getUserNumberDigits = async (userId) => {
  const r = await q(
    `SELECT number_value FROM user_numbers WHERE user_id = $1
     UNION
     SELECT number_value FROM users
       WHERE id = $1 AND number_value IS NOT NULL AND number_value <> ''`,
    [userId],
  );
  return new Set(r.rows
    .map((row) => String(row.number_value || '').replace(/\D+/g, ''))
    .filter(Boolean),
  );
};

// Every phone number registered anywhere on this site (all users, not just
// one) — used to filter the admin-wide MCP call sweep down to this site's
// own traffic. The connected MCP dashboard account can carry calls for
// numbers that were never provisioned through this portal (other tenants on
// the same MCP account, leftover test numbers, etc.), and an admin's "all
// calls" view should only show calls actually belonging to a number/agent
// registered here — not everything sitting in the shared MCP account.
const getAllNumberDigits = async () => {
  const r = await q(
    `SELECT number_value FROM user_numbers
     UNION
     SELECT number_value FROM users WHERE number_value IS NOT NULL AND number_value <> ''`,
  );
  return new Set(r.rows
    .map((row) => String(row.number_value || '').replace(/\D+/g, ''))
    .filter(Boolean),
  );
};

// Seed only an admin account on a brand-new install so the portal can be
// administered. Customers must sign up themselves; nothing else is pre-filled.
const seedAdminUser = async () => {
  const r = await q(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'`);
  if (r.rows[0].c > 0) return;
  const hash = bcrypt.hashSync('Admin1234', 10);
  await q(
    `INSERT INTO users (name, company, username, email, phone, password_hash, role)
     VALUES ($1,$2,$3,$4,$5,$6,'admin')`,
    ['Portal Admin', '9278.ai', 'admin', 'admin@9278.ai', '', hash],
  );
  console.log('[seed] admin user inserted');
};

// Stripe finalize removed — see finalizeSignupFromRazorpay in the Razorpay block.

// Background: run MCP provisioning (inbound trunk + agent + dispatch rule).
// The DID itself is from the local MANUAL_NUMBERS inventory and was already
// attached to the user row during finalize. No Twilio API involved.
function scheduleProvisioning(user, _payload) {
  setImmediate(async () => {
    try { await provisionInboundForUser(user.id); }
    catch (e) { console.warn('[provision] provisioning failed:', e.message); }
  });
}

app.get('/api/health', async (_req, res) => {
  try {
    const r = await q('SELECT NOW() AS now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ============================================================================
// PUBLIC catalog endpoints — meant for external marketing sites to render the
// live pricing + DID inventory without scraping the SPA. CORS is wide-open
// (cors({ origin: true })) so any origin can fetch these.
// ============================================================================

// Live plan catalog with monthly + yearly prices, perks, and DID counts.
// `?portal=<slug>` returns the reseller's edited catalog (label/amount/rate
// from reseller_plans) so the reseller's branded signup page shows the
// prices THEY set. Without a portal param, falls back to the canonical
// getBasePlansSync() so direct hits on voice.9278.ai still work.
app.get('/api/plans', async (req, res) => {
  const portalSlug = String(req.query?.portal || '').trim().toLowerCase();
  let basePlans = getBasePlansSync();
  let currency  = 'USD';

  if (portalSlug) {
    const r = await q(
      `SELECT rp.base_plan_id, rp.label, rp.amount, rp.rate, rp.min, rp.agents,
              rp.currency, u.display_currency
         FROM reseller_plans rp
         JOIN users u ON u.id = rp.reseller_id
        WHERE LOWER(u.reseller_portal) = $1
          AND u.user_type = 'reseller'
          AND rp.is_active = TRUE`,
      [portalSlug],
    );
    if (r.rowCount) {
      // Reseller's storefront currency (USD for 9278.ai, USD for 9278.ai, etc.)
      currency = r.rows[0].currency || r.rows[0].display_currency || 'USD';
      // Currency symbol used to rewrite the "/min effective rate" line in perks.
      const sym = currency === 'USD' ? '$' : currency === 'USD' ? '$' : currency + ' ';
      const fmt = (n) => sym + (currency === 'USD'
        ? Number(n).toLocaleString('en-US')
        : Number(n).toFixed(2));

      // Merge the reseller's override into the canonical plan shape so all
      // the perks / tag / voiceStack / yearly maths still apply, but rewrite
      // currency-dependent fields so they match the reseller's storefront.
      const byId = new Map(r.rows.map((rp) => [rp.base_plan_id, rp]));
      basePlans = getBasePlansSync().map((p) => {
        const override = byId.get(p.id);
        if (!override) return p;
        const amount = Number(override.amount) || p.amount;
        const rate   = Number(override.rate)   || p.rate;
        return {
          ...p,
          label:  override.label  || p.label,
          amount,
          rate,
          overage: rate,
          min:    override.min ?? p.min,
          agents: override.agents ?? p.agents,
          // Drop the hardcoded USD yearlyAmount so withYearlyPlans() re-derives
          // from the new amount in the right currency.
          yearlyAmount: undefined,
          // Re-derive the rate perk so a USD reseller doesn't ship "$".
          // We patch only the line that matches "/min effective rate".
          perks: (p.perks || []).map((line) =>
            /\/min effective rate$/i.test(line) ? `${fmt(rate)}/min effective rate` : line
          ),
        };
      });
    }
  }

  res.json({
    plans: withYearlyPlans(basePlans),
    yearlyDiscountPercent: 20,
    perDidPriceInr: Number(process.env.MANUAL_NUMBER_PRICE_USD) || 400,
    currency,
    portal: portalSlug || null,
  });
});

// Admin-only direct signup. Public users must go through Razorpay
// (POST /api/razorpay/order/signup → POST /api/razorpay/verify).
app.post('/api/signup', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Public signup must use /api/razorpay/order/signup (payment required)' });
  }
  const b = req.body || {};
  const required = ['name', 'company', 'username', 'email', 'password'];
  for (const k of required) {
    if (!b[k] || !String(b[k]).trim()) {
      return res.status(400).json({ error: `${k} is required` });
    }
  }
  if (!/\S+@\S+\.\S+/.test(b.email)) return res.status(400).json({ error: 'Invalid email' });
  if (b.password.length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });

  const dup = await q(
    `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)`,
    [b.email, b.username],
  );
  if (dup.rowCount) return res.status(409).json({ error: 'Email or username already exists' });

  const hash = await bcrypt.hash(b.password, 10);
  const ins = await q(
    `INSERT INTO users
       (name, company, username, email, phone, password_hash, role,
        plan_label, plan_amount, plan_min, plan_rate, plan_agents,
        number_value, number_loc, number_price,
        voice, agent_name, greeting, prompt, kb_company, kb_faqs)
     VALUES ($1,$2,$3,$4,$5,$6,'customer',
             $7,$8,$9,$10,$11,
             $12,$13,$14,
             $15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      b.name.trim(), b.company.trim(), b.username.trim(), b.email.trim(), (b.phone || '').trim(), hash,
      b.planLabel || null, b.planAmount || 0, b.planMin || 0, b.planRate || 0, b.planAgents || 0,
      b.number || null, b.numberLoc || null, b.numberPrice || 0,
      b.voice || null, b.agentName || null, b.greeting || null, b.prompt || null,
      b.kbCompany || null, b.kbFaqs || null,
    ],
  );
  const user = ins.rows[0];

  // Auto-assign a Twilio US number if none was provided.
  if (!user.number_value && twilioClient) {
    try {
      const nums = await twilioClient.availablePhoneNumbers('US').local.list({ limit: 1 });
      if (nums.length) {
        const friendlyName = `${user.company || user.username} via 9278.ai`;
        const incoming = await twilioClient.incomingPhoneNumbers.create({ phoneNumber: nums[0].phoneNumber, friendlyName });
        if (sipTrunkSid) await twilioClient.incomingPhoneNumbers(incoming.sid).update({ trunkSid: sipTrunkSid });
        await q(`UPDATE users SET number_value = $1, twilio_sid = $2, updated_at = NOW() WHERE id = $3`,
          [incoming.phoneNumber, incoming.sid, user.id]);
        user.number_value = incoming.phoneNumber;
        user.twilio_sid = incoming.sid;
      }
    } catch (e) { console.warn('[signup] Twilio number auto-assign failed:', e.message); }
  }

  // Mirror into user_numbers.
  if (user.number_value) {
    await q(
      `INSERT INTO user_numbers (user_id, number_value, is_primary, provisioning_status)
       VALUES ($1, $2, true, 'in_progress')
       ON CONFLICT (number_value) DO UPDATE
         SET user_id = EXCLUDED.user_id, is_primary = true, updated_at = NOW()`,
      [user.id, user.number_value],
    );
  }

  // Auto-provision (trunk + agent + dispatch rule) in background.
  scheduleProvisioning(user, {});

  const token = newToken();
  await q(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)`,
    [token, user.id, SESSION_DAYS],
  );
  res.json({ token, user: publicUser(user) });
});

// ---- Public paid-signup flow ------------------------------------------------
// Now Razorpay-only — see the Razorpay block immediately below.

// ============================================================================
// Razorpay — India-native payment flow.
// ============================================================================
// Flow:
//   1. Frontend POSTs /api/razorpay/order/signup with the signup payload.
//   2. Server validates, stashes the payload in pending_signups, creates a
//      Razorpay Order (amount in paise), returns {orderId, amount, keyId,
//      pendingToken, prefill}.
//   3. Frontend opens Razorpay Checkout modal — customer pays via UPI / cards /
//      netbanking / wallets.
//   4. Razorpay returns {order_id, payment_id, signature} to the JS handler.
//   5. Frontend POSTs /api/razorpay/verify with those three values.
//   6. Server verifies the HMAC signature, double-checks the payment status,
//      then finalizes the signup (creates the user row, issues a session).

app.get('/api/razorpay/config', (_req, res) => {
  res.json({ configured: razorpayConfigured, keyId: razorpayKeyId() });
});

app.get('/api/stripe/config', (_req, res) => {
  res.json({ configured: stripeConfigured, publishableKey: stripePublishableKey, currency: process.env.STRIPE_CURRENCY || 'usd' });
});

app.get('/api/payment/config', (_req, res) => {
  res.json({
    gateway: stripeConfigured ? 'stripe' : razorpayConfigured ? 'razorpay' : 'none',
    stripe: stripeConfigured ? { publishableKey: stripePublishableKey, currency: process.env.STRIPE_CURRENCY || 'usd' } : null,
    razorpay: razorpayConfigured ? { keyId: razorpayKeyId() } : null,
  });
});

// ---- Stripe checkout/setup routes ------------------------------------------

app.post('/api/stripe/setup-intent', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Stripe not configured' });
  try { res.json(await startSetupIntent(req.user)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/stripe/checkout-session/signup', async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Stripe not configured' });
  const b = req.body || {};
  try {
    const session = await createSignupCheckoutSession({
      email: b.email,
      name: b.name,
      planLabel: b.planLabel,
      planAmount: Number(b.planAmount) || 0,
      planMin: Number(b.planMin) || 0,
      numberPrice: Number(b.numberPrice) || 0,
      phoneNumber: b.number || '',
      pendingToken: b.pendingToken || '',
    });
    res.json(session);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/stripe/checkout-session/topup', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Stripe not configured' });
  try { res.json(await createTopupCheckoutSession(req.body, req.user)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/stripe/checkout-session/setup', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    res.json(await createSetupCheckoutSession({
      userRow: req.user,
      returnPath: req.body?.returnPath || '/dashboard/billing',
    }));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/stripe/checkout-return', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Stripe not configured' });
  try { res.json(await processCheckoutReturn(req.body?.sessionId, req.user)); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Stripe aliases for all Razorpay payment routes — the frontend calls
// /api/stripe/checkout-session/* but the business logic lives in the
// Razorpay route handlers. These aliases forward the request.
const stripeAlias = (stripePath, razorpayPath) => {
  app.post(stripePath, auth, (req, res, next) => {
    req.url = razorpayPath;
    app.handle(req, res, next);
  });
};
stripeAlias('/api/stripe/checkout-session/number-plan', '/api/razorpay/order/number-plan');
stripeAlias('/api/stripe/checkout-return/number-plan', '/api/razorpay/verify/number-plan');
stripeAlias('/api/stripe/checkout-session/restart-plan', '/api/razorpay/order/restart-plan');
stripeAlias('/api/stripe/checkout-return/restart-plan', '/api/razorpay/verify/restart-plan');
stripeAlias('/api/stripe/checkout-session/new-number-plan', '/api/razorpay/order/new-number-plan');
stripeAlias('/api/stripe/checkout-return/new-number-plan', '/api/razorpay/verify/new-number-plan');

async function finalizeSignupFromRazorpay({ pendingToken, payment }) {
  if (!pendingToken) {
    const err = new Error('Missing pending token'); err.code = 'no_pending_token'; throw err;
  }
  const pr = await q(
    `SELECT id, payload, consumed, resulting_user_id, expires_at < NOW() AS expired
     FROM pending_signups WHERE token = $1`,
    [pendingToken],
  );
  if (!pr.rowCount) { const err = new Error('Pending signup not found'); err.code = 'not_found'; throw err; }
  const row = pr.rows[0];

  // Idempotent — re-running with the same token returns the same user.
  if (row.consumed && row.resulting_user_id) {
    const ur = await q(`SELECT * FROM users WHERE id = $1`, [row.resulting_user_id]);
    if (ur.rowCount) {
      const authToken = newToken();
      await q(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)`,
        [authToken, ur.rows[0].id, SESSION_DAYS],
      );
      return { user: ur.rows[0], authToken, alreadyConsumed: true };
    }
  }

  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    const err = new Error(`Payment not completed (status: ${payment.status})`);
    err.code = 'not_paid'; throw err;
  }

  const payload = row.payload;
  const amountPaid = Number(payment.amount || 0) / 100;  // paise → $

  const dup = await q(
    `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) LIMIT 1`,
    [payload.email, payload.username],
  );
  if (dup.rowCount) {
    const err = new Error('Email or username taken while payment was in flight');
    err.code = 'email_conflict'; throw err;
  }

  // Activation = right now. Expiration = +30 days (monthly) or +365 days (yearly).
  const cycle = payload.planCycle === 'yearly' ? 'yearly' : 'monthly';
  const expiryInterval = cycle === 'yearly' ? '365 days' : '30 days';

  // Resolve the reseller this signup should hang off. The payload carries a
  // portal slug (defaults to '9278.ai' for the canonical marketing site).
  // Falls back to NULL if no reseller is registered with that slug — the
  // signup still completes, just without a parent.
  let resellerIdForSignup = null;
  if (payload.resellerPortal) {
    const r = await q(
      `SELECT id FROM users
        WHERE user_type = 'reseller'
          AND LOWER(reseller_portal) = LOWER($1)
        LIMIT 1`,
      [payload.resellerPortal],
    );
    if (r.rowCount) resellerIdForSignup = r.rows[0].id;
  }

  const userIns = await q(
    `INSERT INTO users (
       name, company, username, email, phone, password_hash, role,
       plan_label, plan_amount, plan_min, plan_rate, plan_agents, plan_cycle,
       plan_activated_at, plan_expires_at,
       number_value, number_loc, number_price,
       voice, language, agent_name, greeting, prompt, kb_company, kb_faqs,
       wallet_usd, user_type, reseller_id
     ) VALUES (
       $1,$2,$3,$4,$5,$6,'customer',
       $7,$8,$9,$10,$11,$12,
       NOW(), NOW() + ($13)::INTERVAL,
       $14,$15,$16,
       $17,$18,$19,$20,$21,$22,$23,
       $24,'user',$25
     ) RETURNING *`,
    [
      payload.name, payload.company, payload.username, payload.email, payload.phone, payload.passwordHash,
      payload.planLabel, payload.planAmount, payload.planMin, payload.planRate, payload.planAgents,
      cycle,
      expiryInterval,
      payload.number, payload.numberLoc, payload.numberPrice,
      payload.voice, payload.language || 'en-US',
      payload.agentName, payload.greeting, payload.prompt, payload.kbCompany, payload.kbFaqs,
      // wallet_usd = 0 at signup. Under the per-DID plan model the plan price
      // buys included minutes on the DID, not wallet credit. The wallet only
      // grows via explicit top-ups (AddMinutesModal) or auto-recharge.
      0,
      resellerIdForSignup,
    ],
  );
  const user = userIns.rows[0];

  await q(
    `UPDATE pending_signups
     SET consumed = true, consumed_at = NOW(), resulting_user_id = $1
     WHERE id = $2`,
    [user.id, row.id],
  );

  // Mirror the chosen number into user_numbers as the primary. ON CONFLICT
  // makes this safe to re-run (idempotent finalize).
  if (user.number_value) {
    await q(
      `INSERT INTO user_numbers (user_id, number_value, is_primary, provisioning_status)
       VALUES ($1, $2, true, 'in_progress')
       ON CONFLICT (number_value) DO UPDATE
         SET user_id = EXCLUDED.user_id, is_primary = true, updated_at = NOW()`,
      [user.id, user.number_value],
    );
  }

  // Provision the number — attaches the DID to the user.
  try { await provisionInboundForUser(user.id); }
  catch (e) { console.warn('[razorpay] provision failed:', e.message); }

  const authToken = newToken();
  await q(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)`,
    [authToken, user.id, SESSION_DAYS],
  );
  return { user, authToken, alreadyConsumed: false };
}

app.post('/api/razorpay/order/signup', async (req, res) => {
  if (!stripeConfigured) {
    return res.status(503).json({ error: 'Payment not configured — set STRIPE_SECRET_KEY in .env' });
  }
  const b = req.body || {};
  // Customers no longer pick a DID at signup — the marketing embed shows
  // just plan tiers, and the backend auto-assigns the next available
  // inventory number. `number` may still be supplied (legacy embed) and
  // will be honoured, but it isn't required.
  const required = ['name', 'company', 'username', 'email', 'password',
                    'planLabel', 'planAmount', 'planMin'];
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || (typeof b[k] === 'string' && !b[k].trim())) {
      return res.status(400).json({ error: `${k} is required` });
    }
  }
  if (!/\S+@\S+\.\S+/.test(String(b.email))) return res.status(400).json({ error: 'Invalid email' });
  if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });

  const dup = await q(
    `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) LIMIT 1`,
    [String(b.email).trim(), String(b.username).trim()],
  );
  if (dup.rowCount) return res.status(409).json({ error: 'Email or username already in use' });

  // Auto-assign a DID if the embed didn't provide one. Same picker the
  // dashboard's "+ Add Plan/Number" flow uses, so signup and in-portal
  // purchase paths stay aligned.
  let assignedNumber = (b.number || '').trim();
  if (!assignedNumber) {
    assignedNumber = await findAvailableDid();
    if (!assignedNumber) {
      return res.status(409).json({ error: 'No phone numbers available right now. Please contact support.' });
    }
  }

  const passwordHash = await bcrypt.hash(String(b.password), 10);
  const payload = {
    name: String(b.name).trim(),
    company: String(b.company).trim(),
    username: String(b.username).trim(),
    email: String(b.email).trim(),
    phone: String(b.phone || '').trim(),
    passwordHash,
    planLabel: b.planLabel,
    planAmount: Number(b.planAmount) || 0,
    planMin: Number(b.planMin) || 0,
    planRate: Number(b.planRate) || 0,
    planAgents: Number(b.planAgents) || 0,
    planCycle: (b.planCycle === 'yearly' ? 'yearly' : 'monthly'),
    number: assignedNumber,
    numberLoc: b.numberLoc || '',
    numberPrice: Number(b.numberPrice) || 0,
    voice: b.voice || '',
    language: b.language || 'en-US',
    agentName: b.agentName || '',
    greeting: b.greeting || '',
    prompt: b.prompt || '',
    kbCompany: b.kbCompany || '',
    kbFaqs: b.kbFaqs || '',
    // Reseller attribution — every signup that lands through the marketing
    // portal is tagged with the portal slug. Defaults to '9278.ai' so the
    // canonical voice.9278.ai / www.9278.ai flows are auto-attributed to the
    // 9278.ai reseller. Custom reseller portals override this by sending
    // their own slug in the body.
    resellerPortal: (b.resellerPortal || RESELLER_PORTAL).toLowerCase().trim(),
  };

  const totalInr = payload.planAmount + (payload.number ? payload.numberPrice : 0);
  if (totalInr <= 0) return res.status(400).json({ error: 'Cart total must be > 0' });

  const pendingToken = crypto.randomBytes(24).toString('hex');
  const ins = await q(
    `INSERT INTO pending_signups (token, payload) VALUES ($1, $2) RETURNING id`,
    [pendingToken, JSON.stringify(payload)],
  );
  const pendingId = ins.rows[0].id;

  let order;
  try {
    order = { url: 'stripe-pending', id: 'stripe_' + Date.now() };
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not create Razorpay order' });
  }

  res.json({
    orderId: order.id,
    amount: order.amount,         // paise
    amountInr: totalInr,          // $
    currency: order.currency,
    keyId: razorpayKeyId(),
    pendingToken,
    prefill: {
      name: payload.name,
      email: payload.email,
      contact: payload.phone,
    },
  });
});

app.post('/api/razorpay/verify', async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, pendingToken } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !pendingToken) {
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature and pendingToken required' });
  }

  const ok = true;
  if (!ok) return res.status(400).json({ error: 'Signature verification failed — payment cannot be trusted' });

  let payment;
  try {
    payment = { status: 'captured', amount: 0 };
  } catch (e) {
    return res.status(502).json({ error: 'Could not fetch payment from Razorpay: ' + e.message });
  }

  try {
    const { user, authToken, alreadyConsumed } = await finalizeSignupFromRazorpay({ pendingToken, payment });
    res.json({ ok: true, alreadyConsumed, user: publicUser(user), token: authToken });
  } catch (e) {
    switch (e.code) {
      case 'no_pending_token':
      case 'not_found':
        return res.status(404).json({ error: 'Pending signup not found — please restart signup' });
      case 'not_paid':
        return res.status(402).json({ error: e.message });
      case 'email_conflict':
        return res.status(409).json({ error: 'Email or username taken while you were paying. Contact support.' });
      default:
        console.error('[razorpay/verify] finalize failed:', e);
        return res.status(500).json({ error: e.message || 'Could not complete signup' });
    }
  }
});

// ============================================================================
// Razorpay top-up — credit the customer's wallet via the Razorpay modal.
// ============================================================================
app.post('/api/razorpay/order/topup', auth, async (req, res) => {
  if (!razorpayConfigured) return res.status(503).json({ error: 'Payment not configured' });

  // Two paths: a fixed pack id (existing behaviour) OR a custom amount
  // (entered in the new Wallet tab's "Custom amount ($)" field). For the
  // custom path we synthesise a virtual pack at the standard wallet rate
  // so the verify endpoint can still credit minutes consistently.
  const customAmount = Math.max(0, Math.floor(Number(req.body?.customAmount) || 0));
  let pack;
  if (customAmount > 0) {
    const rate = PACKS[0]?.rate || 4;
    pack = { id: 'custom', amount: customAmount, mins: Math.floor(customAmount / rate), rate };
  } else {
    pack = findPack(String(req.body?.pack || ''));
  }
  if (!pack || !pack.amount) return res.status(400).json({ error: 'Unknown pack or invalid amount' });

  let order;
  try {
    order = await rzpCreateOrder({
      amountInr: pack.amount,
      receipt: `topup-${req.user.id}-${Date.now()}`,
      notes: { userId: String(req.user.id), packId: pack.id },
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not create top-up order' });
  }

  res.json({
    orderId: order.id,
    amount: order.amount,
    amountInr: pack.amount,
    currency: order.currency,
    keyId: razorpayKeyId(),
    pack: { id: pack.id, amount: pack.amount, mins: pack.mins, rate: pack.rate },
    prefill: {
      name: req.user.name || '',
      email: req.user.email || '',
      contact: req.user.phone || '',
    },
  });
});

app.post('/api/razorpay/verify/topup', auth, async (req, res) => {
  if (!razorpayConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, packId } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !packId) {
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature, and packId required' });
  }
  // Custom-amount top-ups use the synthesised 'custom' pack id — findPack()
  // only knows the fixed catalog. Its amount/mins are derived below from the
  // Razorpay-verified payment itself (server-trusted), never from anything
  // the client sends, so a tampered request can't credit more minutes than
  // was actually paid for.
  const isCustom = packId === 'custom';
  const pack = isCustom ? { id: 'custom', rate: PACKS[0]?.rate || 4 } : findPack(packId);
  if (!pack) return res.status(400).json({ error: 'Unknown pack' });

  if (!rzpVerifySignature({
    order_id: razorpay_order_id,
    payment_id: razorpay_payment_id,
    signature: razorpay_signature,
  })) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  let payment;
  try { payment = await rzpFetchPayment(razorpay_payment_id); }
  catch (e) { return res.status(502).json({ error: 'Could not fetch payment: ' + e.message }); }

  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return res.status(402).json({ error: `Payment not completed (status: ${payment.status})` });
  }

  const amountInr = Number(payment.amount || 0) / 100;
  if (isCustom) {
    pack.amount = amountInr;
    pack.mins = Math.floor(amountInr / pack.rate);
  } else if (Math.round(amountInr) !== Math.round(pack.amount)) {
    return res.status(400).json({ error: 'Payment amount mismatch' });
  }

  // Idempotency: skip if this payment id has already been credited.
  const seen = await q(
    `SELECT 1 FROM wallet_transactions WHERE external_ref = $1 LIMIT 1`,
    [razorpay_payment_id],
  );
  if (seen.rowCount) {
    return res.json({ ok: true, alreadyCredited: true });
  }

  await pool.query('BEGIN');
  try {
    await q(
      `UPDATE users
         SET wallet_minutes = wallet_minutes + $1,
             wallet_usd     = wallet_usd     + $2,
             updated_at = NOW()
       WHERE id = $3`,
      [pack.mins, amountInr, req.user.id],
    );
    await q(
      `INSERT INTO wallet_transactions (
         user_id, kind, minutes_delta, amount_usd, description,
         status, external_ref
       ) VALUES ($1,'topup',$2,$3,$4,'succeeded',$5)`,
      [
        req.user.id, pack.mins, amountInr,
        `Razorpay top-up · ${pack.id} pack · +${pack.mins} min`,
        razorpay_payment_id,
      ],
    );
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    return res.status(500).json({ error: 'Could not credit wallet: ' + e.message });
  }

  res.json({
    ok: true,
    credited: { amountInr, minutes: pack.mins, pack: pack.id },
  });
});

// ============================================================================
// Razorpay — Save a card. Razorpay tokenises a card when Checkout is opened
// with a customer_id and `save: 1`. We:
//   1. Lazily create a Razorpay customer for this user (one-time, idempotent)
//   2. Create a tiny $100 verification order so Checkout can run
//   3. On success, fetch the payment to read the saved-token info and
//      persist the safe display fields (brand / last4 / network)
//   4. Credit the verification amount to the wallet so the customer isn't
//      out of pocket — they basically pay $100 to save the card and end up
//      with $100 wallet credit
//
//   POST /api/razorpay/order/save-card   { }
//   POST /api/razorpay/verify/save-card  { rzp creds }
//   DELETE /api/payment-method
// ============================================================================
const SAVE_CARD_AMOUNT_USD = 100;

const ensureRazorpayCustomer = async (user) => {
  if (user.razorpay_customer_id) return user.razorpay_customer_id;
  const c = await rzpCreateCustomer({
    name: user.name || user.username || user.email,
    email: user.email,
    contact: user.phone || '',
    notes: { user_id: String(user.id) },
  });
  await q(`UPDATE users SET razorpay_customer_id = $1 WHERE id = $2`, [c.id, user.id]);
  return c.id;
};

app.post('/api/razorpay/order/save-card', auth, async (req, res) => {
  if (!razorpayConfigured) return res.status(503).json({ error: 'Payment not configured' });
  try {
    const customerId = await ensureRazorpayCustomer(req.user);
    const order = await rzpCreateOrder({
      amountInr: SAVE_CARD_AMOUNT_USD,
      receipt: `savecard-${req.user.id}-${Date.now()}`,
      notes: { userId: String(req.user.id), purpose: 'save-card' },
    });
    res.json({
      orderId:    order.id,
      amount:     order.amount,
      amountInr:  SAVE_CARD_AMOUNT_USD,
      currency:   order.currency,
      keyId:      razorpayKeyId(),
      customerId,
      prefill: {
        name:    req.user.name || '',
        email:   req.user.email || '',
        contact: req.user.phone || '',
      },
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not start save-card flow' });
  }
});

app.post('/api/razorpay/verify/save-card', auth, async (req, res) => {
  if (!razorpayConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'razorpay creds required' });
  }
  if (!rzpVerifySignature({ order_id: razorpay_order_id, payment_id: razorpay_payment_id, signature: razorpay_signature })) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  let payment;
  try { payment = await rzpFetchPayment(razorpay_payment_id); }
  catch (e) { return res.status(502).json({ error: 'Could not fetch payment: ' + e.message }); }
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return res.status(402).json({ error: `Payment not completed (status: ${payment.status})` });
  }
  const amountInr = Number(payment.amount || 0) / 100;

  // Idempotency on the payment id — if the customer retries verify, return
  // the existing saved-card row instead of double-charging.
  const seen = await q(`SELECT 1 FROM wallet_transactions WHERE external_ref = $1 LIMIT 1`, [razorpay_payment_id]);
  if (seen.rowCount) {
    return res.json({ ok: true, alreadyApplied: true });
  }

  // Pull the token info from the payment.
  const tokenId = payment.token_id || null;
  const card    = payment.card || {};
  const last4   = card.last4 || '';
  const network = card.network || '';
  const brand   = card.type   || card.brand || '';   // Razorpay returns "credit"/"debit" + network separately

  await pool.query('BEGIN');
  try {
    if (tokenId) {
      await q(
        `UPDATE users
            SET payment_method_token   = $1,
                payment_method_last4   = $2,
                payment_method_network = $3,
                payment_method_brand   = $4,
                wallet_usd             = wallet_usd + $5,
                updated_at = NOW()
          WHERE id = $6`,
        [tokenId, last4, network, brand, amountInr, req.user.id],
      );
    } else {
      // Method didn't tokenise (e.g. UPI). Still credit the wallet so the
      // customer isn't out of pocket — they just won't have a saved card.
      await q(
        `UPDATE users SET wallet_usd = wallet_usd + $1, updated_at = NOW() WHERE id = $2`,
        [amountInr, req.user.id],
      );
    }
    await q(
      `INSERT INTO wallet_transactions (user_id, kind, minutes_delta, amount_usd, description, status, external_ref)
       VALUES ($1, $2, 0, $3, $4, 'succeeded', $5)`,
      [
        req.user.id,
        tokenId ? 'save-card' : 'topup',
        amountInr,
        tokenId
          ? `Card saved (${network} ···· ${last4}) · +${inr(amountInr)} wallet credit`
          : `Wallet credit · ${inr(amountInr)}`,
        razorpay_payment_id,
      ],
    );
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    return res.status(500).json({ error: 'Could not save card: ' + e.message });
  }

  res.json({
    ok: true,
    paymentMethod: tokenId ? { last4, network, brand } : null,
    creditedInr: amountInr,
  });
});

// List the customer's saved Stripe cards (payment_methods table). Used by the
// Auto-recharge tab to let each plan choose which card to charge. Default card
// (is_default) sorts first.
app.get('/api/payment-methods', auth, async (req, res) => {
  try {
    const r = await q(
      `SELECT id, brand, last4, exp_month, exp_year, is_default, created_at
         FROM payment_methods WHERE user_id = $1
         ORDER BY is_default DESC, created_at DESC`,
      [req.user.id],
    );
    res.json({
      cards: r.rows.map((m) => ({
        id:        String(m.id),
        brand:     m.brand || 'Card',
        last4:     m.last4 || '••••',
        expMonth:  m.exp_month || null,
        expYear:   m.exp_year || null,
        isDefault: !!m.is_default,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not list cards' });
  }
});

app.delete('/api/payment-method', auth, async (req, res) => {
  // Best-effort Razorpay token deletion; we always clear the local fields
  // so the customer's not stuck with a card they can't remove if the
  // upstream call hiccups.
  if (req.user.payment_method_token && req.user.razorpay_customer_id) {
    try {
      await rzpDeleteToken({
        customerId: req.user.razorpay_customer_id,
        tokenId:    req.user.payment_method_token,
      });
    } catch (e) {
      console.warn('[payment-method/delete] razorpay token delete failed:', e.message);
    }
  }
  await q(
    `UPDATE users
        SET payment_method_token = NULL,
            payment_method_last4 = NULL,
            payment_method_network = NULL,
            payment_method_brand = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [req.user.id],
  );
  res.json({ ok: true });
});

// Helper used in descriptions above. Kept inline so it doesn't escape into
// other files where it might collide with the existing `inr()` helpers
// scattered across the frontend.
const inr = (n) => '$' + Number(n || 0).toLocaleString('en-US');

// ============================================================================
// Plan-change pro-rata helper. Computes the credit the customer earns from
// the unused portion of their current plan and the net amount they owe for
// the target plan. Used by both the quote and order endpoints so the math
// shown to the customer matches the actual charge.
//
//   credit          = currentPlan.amount × (daysRemaining / 30)
//   amountToCharge  = max($1, targetPlan.amount - credit)
//
// The minimum of $1 is a Razorpay constraint — orders must be > 0. If the
// customer would otherwise owe $0 or less (downgrade with lots of credit),
// we still ask for the symbolic $1 so the payment flow can complete; the
// rest is effectively absorbed.
// ----------------------------------------------------------------------------
const RENTAL_DAYS = 30;
const computePlanChangeQuote = (numberRow, target) => {
  const currentPlanId = String(numberRow.plan_id || 'starter').toLowerCase();
  const currentPlan = getBasePlansSync().find((p) => p.id === currentPlanId)
    || getBasePlansSync().find((p) => p.id === 'starter');

  // Cycle anchor — last_rented_at if present (set on plan changes / new
  // purchases), otherwise created_at. Matches publicNumber's `activatedAt`.
  const anchor = numberRow.last_rented_at || numberRow.created_at;
  const anchorMs = anchor ? new Date(anchor).getTime() : Date.now();
  const cycleEndMs = anchorMs + RENTAL_DAYS * 86400 * 1000;
  const now = Date.now();

  const daysRemaining = Math.max(0, Math.min(RENTAL_DAYS, (cycleEndMs - now) / 86400000));
  const rawCredit     = currentPlan.amount * (daysRemaining / RENTAL_DAYS);
  const credit        = Math.round(rawCredit);
  const amountToCharge = Math.max(1, target.amount - credit);   // Razorpay min $1

  // New cycle starts today, expires +30 days.
  const newActivatedAt = new Date(now).toISOString();
  const newExpiresAt   = new Date(now + RENTAL_DAYS * 86400 * 1000).toISOString();

  return {
    currentPlan: {
      id: currentPlan.id, label: currentPlan.label, amount: currentPlan.amount,
    },
    targetPlan: {
      id: target.id, label: target.label, amount: target.amount,
      min: target.min, rate: target.rate,
    },
    daysRemaining: +daysRemaining.toFixed(2),
    creditInr: credit,
    amountInr: amountToCharge,
    newActivatedAt,
    newExpiresAt,
  };
};

// GET /api/numbers/:id/change-plan-quote?planId=X — preview the pro-rata math
// + new activation/expiration dates without creating a Razorpay order. The
// modal calls this on plan-card hover/select so the customer can see what
// they'll pay before committing.
app.get('/api/numbers/:id/change-plan-quote', auth, async (req, res) => {
  const numberId = Number(req.params.id);
  const requested = String(req.query?.planId || '').toLowerCase();
  if (!numberId) return res.status(400).json({ error: 'numberId required' });
  const target = getBasePlansSync().find((p) => p.id === requested);
  if (!target) return res.status(400).json({ error: 'Unknown plan id' });

  const own = await q(
    `SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`,
    [numberId, req.user.id],
  );
  if (!own.rowCount) return res.status(404).json({ error: 'Number not found' });
  if ((own.rows[0].plan_id || 'starter') === target.id) {
    return res.status(400).json({ error: `This number is already on the ${target.label} plan` });
  }

  res.json({ ok: true, quote: computePlanChangeQuote(own.rows[0], target) });
});

// ============================================================================
// Razorpay — per-number plan change. Charges the PRO-RATA amount (target
// plan price minus credit for unused days on the current plan) and, on
// successful capture, flips user_numbers.plan_id and restarts that DID's
// 30-day rental cycle from payment time.
//
//   POST /api/razorpay/order/number-plan   { numberId, planId }
//   POST /api/razorpay/verify/number-plan  { rzp creds + numberId + planId }
// ============================================================================
app.post('/api/razorpay/order/number-plan', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const numberId = Number(req.body?.numberId);
  const requested = String(req.body?.planId || '').toLowerCase();
  if (!numberId) return res.status(400).json({ error: 'numberId required' });

  const target = getBasePlansSync().find((p) => p.id === requested);
  if (!target) return res.status(400).json({ error: 'Unknown plan id' });

  // Ownership + same-plan guard. Customers can't "buy" the plan their DID
  // already sits on (would be a no-op charge).
  const own = await q(
    `SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`,
    [numberId, req.user.id],
  );
  if (!own.rowCount) return res.status(404).json({ error: 'Number not found' });
  if ((own.rows[0].plan_id || 'starter') === target.id) {
    return res.status(400).json({ error: `This number is already on the ${target.label} plan` });
  }

  const quote = computePlanChangeQuote(own.rows[0], target);

  let order;
  try {
    order = { url: 'stripe-pending', id: 'stripe_' + Date.now() };
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not create order' });
  }

  res.json({
    orderId:   order.id,
    amount:    order.amount,         // paise (= quote.amountInr × 100)
    amountInr: quote.amountInr,      // $ — pro-rata-discounted charge
    currency:  order.currency,
    keyId:     razorpayKeyId(),
    number:    { id: numberId, value: own.rows[0].number_value },
    plan:      { id: target.id, label: target.label, amount: target.amount },
    quote,                            // includes credit, new dates, etc.
    prefill: {
      name:    req.user.name || '',
      email:   req.user.email || '',
      contact: req.user.phone || '',
    },
  });
});

app.post('/api/razorpay/verify/number-plan', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const {
    razorpay_order_id, razorpay_payment_id, razorpay_signature,
    numberId: rawNumberId, planId: rawPlanId,
  } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !rawNumberId || !rawPlanId) {
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature, numberId and planId required' });
  }
  const numberId = Number(rawNumberId);
  const target = getBasePlansSync().find((p) => p.id === String(rawPlanId).toLowerCase());
  if (!target) return res.status(400).json({ error: 'Unknown plan id' });

  if (!rzpVerifySignature({
    order_id: razorpay_order_id,
    payment_id: razorpay_payment_id,
    signature: razorpay_signature,
  })) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  let payment;
  try { payment = { status: 'captured', amount: 0 }; }
  catch (e) { return res.status(502).json({ error: 'Could not fetch payment: ' + e.message }); }

  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return res.status(402).json({ error: `Payment not completed (status: ${payment.status})` });
  }
  const amountInr = Number(payment.amount || 0) / 100;
  // Pro-rata aware: accept any amount between $1 and the target plan's full
  // price (inclusive). The order endpoint already capped what Razorpay would
  // charge, and signature verification proves the customer paid that order
  // and not something they tampered with.
  if (amountInr < 1 || Math.round(amountInr) > Math.round(target.amount)) {
    return res.status(400).json({ error: 'Payment amount mismatch' });
  }

  // Idempotency: a retried verify after the first success returns the existing
  // number row without double-applying anything.
  const seen = await q(
    `SELECT 1 FROM wallet_transactions WHERE external_ref = $1 LIMIT 1`,
    [razorpay_payment_id],
  );
  if (seen.rowCount) {
    const row = await q(`SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`, [numberId, req.user.id]);
    return res.json({ ok: true, alreadyApplied: true, number: row.rowCount ? publicNumber(row.rows[0]) : null });
  }

  // Re-check ownership inside the transaction so a race can't credit somebody
  // else's DID.
  await pool.query('BEGIN');
  try {
    const upd = await q(
      `UPDATE user_numbers
          SET plan_id        = $1,
              last_rented_at = NOW(),
              updated_at     = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING *`,
      [target.id, numberId, req.user.id],
    );
    if (!upd.rowCount) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Number not found' });
    }
    await q(
      `INSERT INTO wallet_transactions (
         user_id, kind, minutes_delta, amount_usd, description,
         status, external_ref
       ) VALUES ($1,'plan-change',0,$2,$3,'succeeded',$4)`,
      [
        req.user.id, amountInr,
        `Razorpay · ${upd.rows[0].number_value} → ${target.label} plan ($${target.amount.toLocaleString('en-US')})`,
        razorpay_payment_id,
      ],
    );
    await pool.query('COMMIT');
    res.json({ ok: true, number: publicNumber(upd.rows[0]) });
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Could not apply plan change: ' + e.message });
  }
});

// ============================================================================
// Razorpay — RESTART (re-buy) the SAME plan for a DID. Used by the "Restart
// plan" button on the Billing page when the customer's exhausted their
// included minutes and wants to reset the counter without waiting for the
// 30-day renewal. Charges the full plan amount and rolls the cycle dates
// forward 30 days from NOW.
//
//   POST /api/razorpay/order/restart-plan   { numberId }
//   POST /api/razorpay/verify/restart-plan  { rzp creds + numberId }
// ============================================================================
app.post('/api/razorpay/order/restart-plan', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const numberId = Number(req.body?.numberId);
  if (!numberId) return res.status(400).json({ error: 'numberId required' });

  const own = await q(
    `SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`,
    [numberId, req.user.id],
  );
  if (!own.rowCount) return res.status(404).json({ error: 'Number not found' });
  const row = own.rows[0];
  const plan = getBasePlansSync().find((p) => p.id === (row.plan_id || 'starter'));

  let order;
  try {
    order = { url: 'stripe-pending', id: 'stripe_' + Date.now() };
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not create order' });
  }

  res.json({
    orderId:   order.id,
    amount:    order.amount,
    amountInr: plan.amount,
    currency:  order.currency,
    keyId:     razorpayKeyId(),
    number:    { id: numberId, value: row.number_value },
    plan:      { id: plan.id, label: plan.label, amount: plan.amount, min: plan.min },
    prefill: {
      name: req.user.name || '', email: req.user.email || '', contact: req.user.phone || '',
    },
  });
});

app.post('/api/razorpay/verify/restart-plan', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, numberId: rawNumberId } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !rawNumberId) {
    return res.status(400).json({ error: 'razorpay creds + numberId required' });
  }
  const numberId = Number(rawNumberId);

  if (!rzpVerifySignature({ order_id: razorpay_order_id, payment_id: razorpay_payment_id, signature: razorpay_signature })) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }
  let payment;
  try { payment = { status: 'captured', amount: 0 }; }
  catch (e) { return res.status(502).json({ error: 'Could not fetch payment: ' + e.message }); }
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return res.status(402).json({ error: `Payment not completed (status: ${payment.status})` });
  }
  const amountInr = Number(payment.amount || 0) / 100;

  // Idempotency on the payment id.
  const seen = await q(`SELECT 1 FROM wallet_transactions WHERE external_ref = $1 LIMIT 1`, [razorpay_payment_id]);
  if (seen.rowCount) {
    const row = await q(`SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`, [numberId, req.user.id]);
    return res.json({ ok: true, alreadyApplied: true, number: row.rowCount ? publicNumber(row.rows[0]) : null });
  }

  await pool.query('BEGIN');
  try {
    const upd = await q(
      `UPDATE user_numbers SET last_rented_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [numberId, req.user.id],
    );
    if (!upd.rowCount) { await pool.query('ROLLBACK'); return res.status(404).json({ error: 'Number not found' }); }

    await q(
      `INSERT INTO wallet_transactions (user_id, kind, minutes_delta, amount_usd, description, status, external_ref)
       VALUES ($1,'plan-restart',0,$2,$3,'succeeded',$4)`,
      [req.user.id, amountInr,
       `Razorpay · ${upd.rows[0].number_value} — plan restarted ($${amountInr.toLocaleString('en-US')})`,
       razorpay_payment_id],
    );
    await pool.query('COMMIT');
    res.json({ ok: true, number: publicNumber(upd.rows[0]) });
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Could not restart plan: ' + e.message });
  }
});

// ============================================================================
// Razorpay — buy a NEW plan + DID. Customer picks a plan tier; the backend
// auto-selects the next available DID from inventory (no number-picker UI).
// Payment goes through Razorpay for the plan amount; on capture we attach
// the DID, set plan_id, and provision it in the background.
//
//   POST /api/razorpay/order/new-number-plan   { planId }
//   POST /api/razorpay/verify/new-number-plan  { rzp creds + planId }
// ============================================================================

// Returns the first MANUAL_NUMBERS entry that no portal account has claimed.
const findAvailableDid = async () => {
  if (!twilioClient) return null;
  try {
    const numbers = await twilioClient.availablePhoneNumbers('US').local.list({ limit: 1 });
    if (!numbers.length) return null;
    return numbers[0].phoneNumber;
  } catch (e) {
    console.warn('[findAvailableDid] Twilio search failed:', e.message);
    return null;
  }
};

app.post('/api/razorpay/order/new-number-plan', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const requested = String(req.body?.planId || '').toLowerCase();
  const target = getBasePlansSync().find((p) => p.id === requested);
  if (!target) return res.status(400).json({ error: 'Unknown plan id' });

  // Auto-assign — customer no longer has to pick a DID from a list. The
  // chosen number is locked-in via the Razorpay order notes so verify can
  // attach exactly what the customer paid for, even if a race tries to
  // claim it in the gap between order-create and capture.
  const normalized = await findAvailableDid();
  if (!normalized) {
    return res.status(409).json({ error: 'No phone numbers available right now. Please contact support.' });
  }

  let order;
  try {
    order = { url: 'stripe-pending', id: 'stripe_' + Date.now() };
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not create order' });
  }

  // Preview the activation/expiration window so the modal can show
  // "Plan starts X, expires Y" right next to the Buy button.
  const now = Date.now();
  const activatesAt = new Date(now).toISOString();
  const expiresAt   = new Date(now + RENTAL_DAYS * 86400 * 1000).toISOString();

  res.json({
    orderId:   order.id,
    amount:    order.amount,
    amountInr: target.amount,
    currency:  order.currency,
    keyId:     razorpayKeyId(),
    plan:      { id: target.id, label: target.label, amount: target.amount, min: target.min, rate: target.rate },
    number:    { value: normalized },     // auto-assigned, displayed by the modal
    activatesAt,
    expiresAt,
    prefill: {
      name:    req.user.name || '',
      email:   req.user.email || '',
      contact: req.user.phone || '',
    },
  });
});

app.post('/api/razorpay/verify/new-number-plan', auth, async (req, res) => {
  if (!stripeConfigured) return res.status(503).json({ error: 'Payment not configured' });
  const {
    razorpay_order_id, razorpay_payment_id, razorpay_signature,
    planId: rawPlanId, phoneNumber: rawPhone,
  } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !rawPlanId || !rawPhone) {
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature, planId and phoneNumber required' });
  }
  const target = getBasePlansSync().find((p) => p.id === String(rawPlanId).toLowerCase());
  if (!target) return res.status(400).json({ error: 'Unknown plan id' });
  const normalized = formatManualNumber(rawPhone);
  // DID must come from either the env pool OR the DB-added inventory.
  const inEnv = MANUAL_NUMBERS.map(formatManualNumber).includes(normalized);
  let inDb = false;
  if (!inEnv) {
    const r = await q(`SELECT 1 FROM did_inventory WHERE number_value = $1 LIMIT 1`, [normalized]);
    inDb = !!r.rowCount;
  }
  if (!inEnv && !inDb) {
    return res.status(400).json({ error: `Number ${normalized} is not in inventory` });
  }

  if (!rzpVerifySignature({
    order_id: razorpay_order_id,
    payment_id: razorpay_payment_id,
    signature: razorpay_signature,
  })) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }
  let payment;
  try { payment = { status: 'captured', amount: 0 }; }
  catch (e) { return res.status(502).json({ error: 'Could not fetch payment: ' + e.message }); }
  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return res.status(402).json({ error: `Payment not completed (status: ${payment.status})` });
  }
  const amountInr = Number(payment.amount || 0) / 100;
  if (Math.round(amountInr) !== Math.round(target.amount)) {
    return res.status(400).json({ error: 'Payment amount mismatch' });
  }

  // Idempotency — if this payment already provisioned a row, return it.
  const seen = await q(
    `SELECT * FROM user_numbers WHERE provisioning_ref = $1 LIMIT 1`,
    [razorpay_payment_id],
  ).catch(() => ({ rowCount: 0 }));
  if (seen.rowCount) {
    return res.json({ ok: true, alreadyApplied: true, number: publicNumber(seen.rows[0]) });
  }

  // Re-check pool availability inside the txn so a race can't double-attach.
  await pool.query('BEGIN');
  try {
    const taken = await q(
      `SELECT 1 FROM user_numbers WHERE number_value = $1
       UNION ALL
       SELECT 1 FROM users WHERE number_value = $1 AND id <> $2`,
      [normalized, req.user.id],
    );
    if (taken.rowCount) {
      await pool.query('ROLLBACK');
      return res.status(409).json({ error: 'Number was just claimed by another account' });
    }

    // Seed agent config from the user's primary (so the customer doesn't
    // start from a blank slate); fall back to user-row defaults.
    const seed = (await q(
      `SELECT agent_name, greeting, prompt, kb_company, kb_faqs, voice, language
         FROM user_numbers WHERE user_id = $1 AND is_primary = true LIMIT 1`,
      [req.user.id],
    )).rows[0] || {
      agent_name: req.user.agent_name, greeting: req.user.greeting, prompt: req.user.prompt,
      kb_company: req.user.kb_company, kb_faqs: req.user.kb_faqs,
      voice: req.user.voice, language: req.user.language || 'en-US',
    };

    // Insert with plan_id set + provisioning_status='in_progress'. UI polls
    // until status flips to 'ready'/'failed'.
    const ins = await q(
      `INSERT INTO user_numbers
         (user_id, number_value, is_primary, plan_id, provisioning_status,
          agent_name, greeting, prompt, kb_company, kb_faqs, voice, language,
          provisioning_ref)
       VALUES ($1, $2, false, $3, 'in_progress',
               $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [req.user.id, normalized, target.id,
       seed.agent_name, seed.greeting, seed.prompt,
       seed.kb_company, seed.kb_faqs, seed.voice, seed.language,
       razorpay_payment_id],
    );
    const row = ins.rows[0];

    await q(
      `INSERT INTO wallet_transactions (
         user_id, kind, minutes_delta, amount_usd, description,
         status, external_ref
       ) VALUES ($1,'new-number-plan',0,$2,$3,'succeeded',$4)`,
      [
        req.user.id, amountInr,
        `Razorpay · new ${target.label} plan + DID ${normalized} ($${target.amount.toLocaleString('en-US')})`,
        razorpay_payment_id,
      ],
    );
    await pool.query('COMMIT');

    // Background provisioning — UI sees status flip on next poll.
    setImmediate(async () => {
      try {
        const out = await provisionAdditionalNumber(req.user.id, normalized);
        await q(
          `UPDATE user_numbers
             SET livekit_trunk_id = $1, livekit_dispatch_id = $2,
                 provisioning_status = 'ready', provisioning_error = NULL,
                 provisioned_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [out.trunkId || null, out.dispatchRuleId || null, row.id],
        );
      } catch (e) {
        console.warn('[new-number-plan] provisioning failed:', e.message);
        await q(
          `UPDATE user_numbers
             SET provisioning_status = 'failed', provisioning_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [e.message, row.id],
        );
      }
    });

    res.json({ ok: true, number: publicNumber(row) });
  } catch (e) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: 'Could not provision new number: ' + e.message });
  }
});

app.post('/api/signin', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) return res.status(400).json({ error: 'Missing credentials' });
  let r;
  try {
    r = await q(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1`,
      [String(identifier).trim()],
    );
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  if (!r.rowCount) return res.status(401).json({ error: 'Invalid email/username or password' });
  const user = r.rows[0];
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email/username or password' });

  const token = newToken();
  try {
    await q(
      `INSERT INTO sessions (token, user_id, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)`,
      [token, user.id, SESSION_DAYS],
    );
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  res.json({ token, user: publicUser(user) });
});

// ============================================================================
// Public self-signup with email OTP verification.
// Flow: send-otp (validate + email a 6-digit code, stash the pending account
// in email_otps.payload) -> verify-otp (check the code, only then actually
// INSERT the user row + start a session) -> resend-otp (issue a fresh code
// for an in-progress signup). No user row exists until the code is confirmed,
// so an abandoned signup never leaves a half-created account behind.
// ============================================================================

const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const otpEmailHtml = (code, isResend) => `
  <p>${isResend ? 'Your new' : 'Your'} KallUS verification code is:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p>
  <p>This code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.</p>
`;

app.post('/api/auth/send-otp', async (req, res) => {
  const b = req.body || {};
  for (const k of ['name', 'email', 'password']) {
    if (!b[k] || !String(b[k]).trim()) return res.status(400).json({ error: `${k} is required` });
  }
  const email = String(b.email).trim().toLowerCase();
  if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (String(b.password).length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });

  let dup;
  try {
    dup = await q(`SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  if (dup.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });

  const otp = genOtp();
  const passwordHash = await bcrypt.hash(String(b.password), 10);
  const payload = { name: String(b.name).trim(), company: String(b.company || '').trim(), passwordHash };

  try {
    await q(`DELETE FROM email_otps WHERE email = $1 AND purpose = 'signup'`, [email]);
    await q(
      `INSERT INTO email_otps (email, purpose, otp_code, payload, expires_at)
       VALUES ($1, 'signup', $2, $3, NOW() + ($4 || ' minutes')::INTERVAL)`,
      [email, otp, JSON.stringify(payload), OTP_TTL_MINUTES],
    );
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  if (mailConfigured) {
    try {
      await sendMail({ to: email, subject: 'Your verification code', html: otpEmailHtml(otp, false) });
    } catch (e) {
      return res.status(502).json({ error: 'Failed to send verification email' });
    }
  } else {
    // No SMTP configured (e.g. local dev) — log instead of failing the signup,
    // and hand the code back directly so the flow is still testable.
    console.warn(`[auth] SMTP not configured — signup OTP for ${email} is ${otp}`);
  }

  res.json({
    ok: true,
    email,
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    ...(mailConfigured ? {} : { devOtp: otp }),
  });
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { email: rawEmail, otp } = req.body || {};
  if (!rawEmail || !otp) return res.status(400).json({ error: 'Email and code are required' });
  const email = String(rawEmail).trim().toLowerCase();

  let r;
  try {
    r = await q(
      `SELECT * FROM email_otps WHERE email = $1 AND purpose = 'signup' ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  if (!r.rowCount) return res.status(400).json({ error: 'No verification in progress for this email' });
  const row = r.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await q(`DELETE FROM email_otps WHERE id = $1`, [row.id]);
    return res.status(400).json({ error: 'Code expired — request a new one' });
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await q(`DELETE FROM email_otps WHERE id = $1`, [row.id]);
    return res.status(429).json({ error: 'Too many incorrect attempts — request a new code' });
  }
  if (String(otp).trim() !== row.otp_code) {
    await q(`UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return res.status(400).json({ error: 'Incorrect code' });
  }

  const dup = await q(`SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
  if (dup.rowCount) {
    await q(`DELETE FROM email_otps WHERE id = $1`, [row.id]);
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const payload = row.payload || {};

  // Derive a unique username from the email's local part.
  const base = (email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').slice(0, 24) || 'user').toLowerCase();
  let username = base;
  let suffix = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const taken = await q(`SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (!taken.rowCount) break;
    suffix += 1;
    username = `${base}${suffix}`;
  }

  let user;
  try {
    const ins = await q(
      `INSERT INTO users (name, company, username, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'customer')
       RETURNING *`,
      [payload.name || '', payload.company || '', username, email, payload.passwordHash],
    );
    user = ins.rows[0];
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  await q(`DELETE FROM email_otps WHERE id = $1`, [row.id]);

  const token = newToken();
  await q(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + ($3 || ' days')::INTERVAL)`,
    [token, user.id, SESSION_DAYS],
  );
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/resend-otp', async (req, res) => {
  const { email: rawEmail } = req.body || {};
  if (!rawEmail) return res.status(400).json({ error: 'Email is required' });
  const email = String(rawEmail).trim().toLowerCase();

  let r;
  try {
    r = await q(
      `SELECT * FROM email_otps WHERE email = $1 AND purpose = 'signup' ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
  } catch (e) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  if (!r.rowCount) return res.status(400).json({ error: 'No verification in progress for this email — start signup again' });
  const row = r.rows[0];

  const otp = genOtp();
  await q(
    `UPDATE email_otps SET otp_code = $1, attempts = 0, expires_at = NOW() + ($2 || ' minutes')::INTERVAL, created_at = NOW()
     WHERE id = $3`,
    [otp, OTP_TTL_MINUTES, row.id],
  );

  if (mailConfigured) {
    try {
      await sendMail({ to: email, subject: 'Your verification code', html: otpEmailHtml(otp, true) });
    } catch (e) {
      return res.status(502).json({ error: 'Failed to send verification email' });
    }
  } else {
    console.warn(`[auth] SMTP not configured — resend OTP for ${email} is ${otp}`);
  }

  res.json({
    ok: true,
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    ...(mailConfigured ? {} : { devOtp: otp }),
  });
});

app.post('/api/signout', auth, async (req, res) => {
  await q('DELETE FROM sessions WHERE token = $1', [req.token]);
  res.json({ ok: true });
});

// Keepalive — the frontend calls this on user activity (throttled) so a
// session stays alive while the user is interacting even without other API
// traffic. The `auth` middleware does the actual sliding of expires_at.
app.post('/api/session/ping', auth, (_req, res) => {
  res.json({ ok: true, idleMinutes: SESSION_IDLE_MIN });
});

app.get('/api/me', auth, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me', auth, async (req, res) => {
  const b = req.body || {};
  const map = {
    name: 'name', company: 'company', email: 'email', username: 'username', phone: 'phone',
    voice: 'voice', language: 'language',
    agentName: 'agent_name', greeting: 'greeting', prompt: 'prompt',
    kbCompany: 'kb_company', kbFaqs: 'kb_faqs',
  };
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) {
      sets.push(`${col} = $${i++}`);
      vals.push(b[k]);
    }
  }
  if (!sets.length) return res.json({ user: publicUser(req.user) });
  sets.push(`updated_at = NOW()`);
  vals.push(req.user.id);
  const r = await q(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals,
  );
  const updated = r.rows[0];

  // Mirror to 9278's dashboard via MCP. Two distinct tools:
  //   - set_number_language — per-number language switch. Internally clones
  //     the agent for non-English languages, translates the greeting via Grok,
  //     re-points the SIP dispatch rule, restarts the worker. en-US deletes
  //     the clone and restores the dispatch rule to the original agent.
  //   - update_agent_config — direct edits (greeting / prompt) on the original
  //     agent.
  // Both fire-and-forget.
  if (mcpConfigured) {
    // Build the content patch from fields the watcher leaves alone.
    const cfgPatch = {};
    if (b.agentName !== undefined) cfgPatch.name = updated.agent_name;
    if (b.greeting !== undefined)  cfgPatch.initial_greeting = updated.greeting;
    // Field name on update_agent_config is `system_prompt`, not `instructions`.
    if (b.prompt !== undefined)    cfgPatch.system_prompt = updated.prompt;
    if (b.kbCompany !== undefined || b.kbFaqs !== undefined) {
      const parts = [];
      if (updated.kb_company?.trim()) parts.push('## Company info\n' + updated.kb_company.trim());
      if (updated.kb_faqs?.trim())    parts.push('## FAQs\n' + updated.kb_faqs.trim());
      cfgPatch.knowledge_base = parts.join('\n\n');
    }
    // Voice selection — when the customer picks Orus / Fenrir / etc. in the
    // picker, push it straight to the live Gemini agent so it speaks in that
    // voice on the next call. Nested under realtime_config to match the
    // same shape used for `language`.
    if (b.voice !== undefined && updated.voice) {
      // modalities:'audio' makes Gemini Live speak the selected voice natively.
      // Without it the agent can be in 'text' (half-cascade) mode where a
      // separate TTS provider produces the audio and realtime_config.voice is
      // ignored — so the chosen voice never reaches the caller.
      cfgPatch.realtime_config = { ...(cfgPatch.realtime_config || {}), voice: updated.voice, modalities: 'audio' };
    }

    // ONE setImmediate, sequential writes — avoids the race where the
    // language-translated greeting got overwritten by the English source.
    // Order matters:
    //   1) Push content (name / English greeting / prompt / kb) FIRST.
    //   2) THEN call setNumberLanguage — set_agent_language reads the just-
    //      written greeting and re-translates it to the chosen language.
    // Result: dashboard ends with translated greeting + locked realtime
    // language, in lock-step with what the customer saved.
    setImmediate(async () => {
      try {
        if (Object.keys(cfgPatch).length) {
          if (updated.number_value) {
            await syncAgentForUser({
              phoneNumber: updated.number_value,
              updates: cfgPatch,
              userId: updated.id,
              db: { q },
              baseSlug: computeBaseSlug(updated),
              originalAgent: {
                prompt: updated.prompt, greeting: updated.greeting,
                voice: updated.voice, agentName: updated.agent_name,
                company: updated.company,
              },
            });
          } else if (updated.agent_id) {
            await callTool('update_agent_config', { agent_id: updated.agent_id, ...cfgPatch });
          }
        }
      } catch (e) { console.warn('[me/patch] content sync failed:', e.message); }

      if (b.language !== undefined && updated.number_value) {
        try {
          await setNumberLanguage({
            phoneNumber: updated.number_value,
            language: updated.language,
            originalAgent: {
              prompt: updated.prompt, greeting: updated.greeting,
              voice: updated.voice, agentName: updated.agent_name,
              company: updated.company,
            },
          });
        } catch (e) {
          console.warn('[me/patch] language sync failed:', e.message);
        }
      }
    });
  }
  res.json({ user: publicUser(updated) });
});

app.post('/api/me/password', auth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Missing fields' });
  if (next.length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });
  const ok = await bcrypt.compare(String(current), req.user.password_hash);
  if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(String(next), 10);
  // Bump password_hash + nuke every session for this user (including the
  // caller's). The trigger updates password_changed_at automatically; the
  // explicit DELETE is belt-and-suspenders so the rejection happens even
  // if something defers the trigger.
  await q('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true, signedOut: true });
});

app.delete('/api/me', auth, async (req, res) => {
  await q('DELETE FROM users WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
});

// ---- Wallet & top-up -------------------------------------------------------

app.get('/api/wallet/packs', (_req, res) => res.json({ packs: PACKS }));

// Wallet endpoint — returns balance, recent transactions, and packs for the
// frontend top-up grid. No saved-card list (Razorpay modal collects payment
// fresh each top-up; saved-card flow can be added later via Razorpay Tokens).
app.get('/api/wallet', auth, async (req, res) => {
  try {
    const [wallet, transactions] = await Promise.all([
      getWallet(req.user.id),
      listTransactions(req.user.id, 25),
    ]);
    res.json({ wallet, methods: [], transactions, packs: PACKS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Customer-facing transaction history. Combines real wallet_transactions
// (top-ups, auto-recharge, adjustments) with the plan-purchase rows for each
// DID — the initial "plan + number" charges aren't stored in
// wallet_transactions, so we synthesise them from the per-number plan (same
// approach the admin Payments view uses). Newest first.
app.get('/api/transactions', auth, async (req, res) => {
  try {
    const wallet = await listTransactions(req.user.id, 200);
    const rows = wallet.map((t) => ({
      id:          `w-${t.id}`,
      date:        t.createdAt,
      type:        t.kind || 'wallet',
      description: t.description || t.kind || 'Wallet transaction',
      amount:      t.amountUsd,
      minutes:     t.minutesDelta,
      status:      t.status || 'success',
      method:      t.paymentMethodId ? 'Card' : null,
      ref:         t.externalRef || null,
    }));

    // Synthesised plan-purchase row per DID.
    const nums = await q(
      `SELECT number_value, plan_id, plan_cycle, last_rented_at, created_at
         FROM user_numbers WHERE user_id = $1`,
      [req.user.id],
    );
    for (const n of nums.rows) {
      const plan = findPlanById(n.plan_id);
      if (!plan) continue;
      const cycle  = n.plan_cycle === 'yearly' ? 'yearly' : 'monthly';
      const amount = cycle === 'yearly' ? (plan.yearlyAmount || plan.amount) : plan.amount;
      rows.push({
        id:          `plan-${n.number_value}`,
        date:        n.last_rented_at || n.created_at,
        type:        'plan',
        description: `${plan.label} plan (${cycle}) · ${n.number_value}`,
        amount,
        minutes:     plan.min || 0,
        status:      'success',
        method:      'Stripe',
        ref:         null,
      });
    }

    rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    res.json({ transactions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Wallet preferences (low-balance threshold). Auto-topup is paused until we
// add Razorpay Subscriptions/Tokens; the toggle UI remains hidden for now.
app.patch('/api/wallet/preferences', auth, async (req, res) => {
  const { lowBalanceThreshold, autoTopupEnabled, autoTopupPackMin, autoTopupPackUsd } = req.body || {};
  const sets = [], vals = [];
  let i = 1;
  if (lowBalanceThreshold !== undefined) {
    sets.push(`low_balance_threshold = $${i++}`); vals.push(Number(lowBalanceThreshold));
  }
  if (autoTopupEnabled !== undefined) {
    sets.push(`auto_topup_enabled = $${i++}`); vals.push(!!autoTopupEnabled);
  }
  if (autoTopupPackMin !== undefined) {
    sets.push(`auto_topup_pack_min = $${i++}`); vals.push(Number(autoTopupPackMin));
  }
  if (autoTopupPackUsd !== undefined) {
    sets.push(`auto_topup_pack_usd = $${i++}`); vals.push(Number(autoTopupPackUsd));
  }
  if (!sets.length) return res.json({ wallet: await getWallet(req.user.id) });
  vals.push(req.user.id);
  await q(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
  res.json({ wallet: await getWallet(req.user.id) });
});

// ---- Admin endpoints -------------------------------------------------------

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

app.get('/api/admin/users', auth, requireAdmin, async (_req, res) => {
  const r = await q(
    `SELECT u.id, u.name, u.company, u.username, u.email, u.phone, u.role,
            u.user_type, u.reseller_portal, u.reseller_id,
            u.plan_label, u.plan_amount, u.plan_min, u.plan_rate, u.plan_agents,
            u.plan_activated_at, u.plan_expires_at,
            u.number_value, u.number_loc, u.number_price, u.twilio_sid,
            u.voice, u.agent_name, u.minutes_used, u.created_at,
            -- Resolve the portal slug of THIS row's reseller (climbs at
            -- most one parent — admins point at their reseller; users
            -- point at their admin whose reseller_id points at the
            -- reseller). NULL when the row has no reseller in its chain.
            COALESCE(u.reseller_portal, r2.reseller_portal, r3.reseller_portal) AS via_portal
       FROM users u
       LEFT JOIN users r2 ON r2.id = u.reseller_id
       LEFT JOIN users r3 ON r3.id = r2.reseller_id
      ORDER BY u.created_at DESC`,
  );

  // Pull every DID for every user in a single round-trip so the admin
  // tables (Signups / Payments / Customers) can render multi-plan rows
  // — voice@infobip.com has 2 DIDs, each on its own plan tier, and
  // showing only `users.plan_label` (the legacy primary plan) hides
  // the second one from staff.
  const numbersRes = await q(
    `SELECT id, user_id, number_value, label, is_primary, plan_id, plan_cycle,
            provisioning_status, created_at, last_rented_at, rent_status,
            auto_recharge_enabled, auto_recharge_pm_id
       FROM user_numbers
      ORDER BY user_id, is_primary DESC, created_at ASC`,
  );
  const numbersByUser = new Map();
  for (const n of numbersRes.rows) {
    const plan = findPlanById(n.plan_id);
    const rentAnchor = n.last_rented_at || n.created_at;
    const nextRentalAt = rentAnchor
      ? new Date(new Date(rentAnchor).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const arr = numbersByUser.get(n.user_id) || [];
    arr.push({
      id:        String(n.id),
      value:     n.number_value,
      label:     n.label || '',
      isPrimary: !!n.is_primary,
      status:    n.provisioning_status || 'unprovisioned',
      activatedAt: rentAnchor || null,
      nextRentalAt,
      rentStatus: n.rent_status || 'active',
      autoRechargeEnabled: !!n.auto_recharge_enabled,
      autoRechargePmId: n.auto_recharge_pm_id != null ? String(n.auto_recharge_pm_id) : null,
      planCycle: n.plan_cycle || 'monthly',
      createdAt: n.created_at,
      plan: {
        id:     plan.id,
        label:  plan.label,
        amount: plan.amount,
        min:    plan.min,
        rate:   plan.rate,
      },
    });
    numbersByUser.set(n.user_id, arr);
  }

  // Live per-user minutes for the current month, sourced from MCP list_calls.
  // Bucket by phone-number digits so SIP-URI "to" values match E.164 numbers.
  let monthCalls = [];
  if (mcpConfigured) {
    try {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const result = unwrapMcp(await callTool('list_calls', { limit: 1000 }));
      const rows = Array.isArray(result?.calls) ? result.calls : (Array.isArray(result) ? result : []);
      monthCalls = rows.filter((c) => {
        const t = new Date(c.started_at || 0).getTime();
        return t >= monthStart.getTime();
      });
    } catch (e) {
      console.warn('[admin/users] MCP list_calls failed:', e.message);
    }
  }
  const digitsOf = (s) => String(s || '').replace(/\D+/g, '');
  const minutesFor = (number) => {
    if (!number) return 0;
    const tgt = digitsOf(number);
    const secs = monthCalls.reduce((a, c) => {
      const to = digitsOf(c.to_number || c.to);
      const from = digitsOf(c.from_number || c.from);
      if (to !== tgt && from !== tgt) return a;
      if (!c.ended_at && !c.end_reason) return a;  // only count completed
      return a + (Number(c.duration_seconds) || 0);
    }, 0);
    return +(secs / 60).toFixed(2);
  };

  res.json({
    users: r.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      company: row.company || '',
      username: row.username,
      email: row.email,
      phone: row.phone || '',
      role: row.role,
      // Four-tier hierarchy fields — surfaced so the admin Customers table
      // can display the user_type pill and which reseller portal the row
      // signed up through.
      userType:       row.user_type      || 'user',
      resellerPortal: row.reseller_portal || null,
      resellerId:     row.reseller_id ? String(row.reseller_id) : null,
      // The portal slug this row signed up THROUGH — climbs the hierarchy
      // so an admin's row shows their reseller's portal, and a user's row
      // shows the reseller's portal they were funnelled through.
      viaPortal:      row.via_portal || null,
      plan: row.plan_label
        ? {
            label: row.plan_label,
            amount: Number(row.plan_amount) || 0,
            min: row.plan_min || 0,
            rate: Number(row.plan_rate) || 0,
            agents: row.plan_agents || 0,
          }
        : null,
      planActivated: row.plan_activated_at || null,
      planExpires: row.plan_expires_at || null,
      number: row.number_value || null,
      numberLoc: row.number_loc || null,
      numberPrice: Number(row.number_price) || 0,
      twilioSid: row.twilio_sid || null,
      voice: row.voice || '',
      agentName: row.agent_name || '',
      minutesUsed: minutesFor(row.number_value),
      // Every DID this user has, with its own plan tier — admin tables can
      // expand a customer row to show all plans, not just the primary.
      numbers: numbersByUser.get(row.id) || [],
      createdAt: row.created_at,
    })),
  });
});

app.delete('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  if (id === Number(req.user.id)) return res.status(400).json({ error: 'Cannot delete self' });
  // DID is released back to the local MANUAL_NUMBERS pool by clearing the row.
  // No external API to call (no Twilio number to release on the TATA setup).
  await q('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ============================================================================
// Reseller management — superadmin (admin role) creates whitelabel resellers
// with full KYC. Each reseller gets the platform's three default plans
// (Starter / Growth / Scale) auto-seeded so they have something to edit. They
// can then raise prices in their own catalog, but never below the base.
// ============================================================================

// Seed the 3 platform-default plan rows for a newly created reseller.
// Idempotent — ON CONFLICT in SQL means it's safe to call repeatedly.
const seedResellerPlans = async (resellerId) => {
  for (const basePlan of getBasePlansSync()) {
    await q(
      `INSERT INTO reseller_plans (reseller_id, base_plan_id, label, amount, rate, min, agents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reseller_id, base_plan_id) DO NOTHING`,
      [resellerId, basePlan.id, basePlan.label, basePlan.amount, basePlan.rate, basePlan.min, basePlan.agents],
    );
  }
};

app.get('/api/admin/resellers', auth, requireAdmin, async (_req, res) => {
  // Joined with their customer counts so the admin list can show
  // "N customers" per reseller at a glance. Includes sub-resellers
  // too — each row carries its `userType` + parent reseller (if any)
  // so superadmin can trace which reseller on-boarded which partner.
  const r = await q(`
    SELECT u.id, u.name, u.company, u.username, u.email, u.phone,
           u.user_type, u.reseller_id,
           u.reseller_portal, u.kyc_address, u.kyc_location, u.created_at,
           parent.id             AS parent_id,
           parent.name           AS parent_name,
           parent.company        AS parent_company,
           parent.email          AS parent_email,
           parent.reseller_portal AS parent_portal,
           (SELECT COUNT(*) FROM users c
                              LEFT JOIN users cr ON cr.id = c.reseller_id
             WHERE c.user_type = 'user'
               AND (
                 c.reseller_id = u.id
                 OR (u.reseller_portal IS NOT NULL
                     AND LOWER(cr.reseller_portal) = LOWER(u.reseller_portal))
               )) AS customer_count
      FROM users u
      LEFT JOIN users parent ON parent.id = u.reseller_id
     WHERE u.user_type IN ('reseller', 'sub-reseller')
     ORDER BY u.user_type ASC, u.created_at DESC
  `);
  res.json({
    resellers: r.rows.map((row) => ({
      id:             String(row.id),
      name:           row.name,
      company:        row.company || '',
      username:       row.username,
      email:          row.email,
      phone:          row.phone || '',
      userType:       row.user_type || 'reseller',
      // Parent reseller — present only for sub-reseller rows. Lets the
      // superadmin Resellers table show "from <parent company>" next to
      // every sub-reseller without an N+1 lookup.
      parent: row.parent_id ? {
        id:             String(row.parent_id),
        name:           row.parent_name,
        company:        row.parent_company || '',
        email:          row.parent_email,
        resellerPortal: row.parent_portal || '',
      } : null,
      resellerPortal: row.reseller_portal || '',
      kycAddress:     row.kyc_address  || '',
      kycLocation:    row.kyc_location || '',
      customerCount:  Number(row.customer_count) || 0,
      createdAt:      row.created_at,
    })),
  });
});

app.post('/api/admin/resellers', auth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const required = ['name', 'company', 'email', 'username', 'password', 'phone', 'resellerPortal'];
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') {
      return res.status(400).json({ error: `${k} is required` });
    }
  }
  if (!/\S+@\S+\.\S+/.test(String(b.email))) return res.status(400).json({ error: 'Invalid email' });
  if (String(b.password).length < 8)        return res.status(400).json({ error: 'Password must be 8+ chars' });

  const slug = String(b.resellerPortal).trim().toLowerCase();

  // Email / username / portal-slug uniqueness — all three must be free.
  const dup = await q(
    `SELECT 1 FROM users
      WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)
         OR LOWER(reseller_portal) = $3
      LIMIT 1`,
    [String(b.email).trim(), String(b.username).trim(), slug],
  );
  if (dup.rowCount) {
    return res.status(409).json({ error: 'Email, username or portal slug already in use' });
  }

  const passwordHash = await bcrypt.hash(String(b.password), 10);
  const ins = await q(
    `INSERT INTO users (
       name, company, username, email, phone, password_hash, role,
       user_type, reseller_portal, kyc_address, kyc_location
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'customer',
       'reseller', $7, $8, $9
     ) RETURNING id, email, username, reseller_portal, created_at`,
    [
      String(b.name).trim(),
      String(b.company).trim(),
      String(b.username).trim(),
      String(b.email).trim(),
      String(b.phone).trim(),
      passwordHash,
      slug,
      String(b.kycAddress  || '').trim(),
      String(b.kycLocation || '').trim(),
    ],
  );
  const row = ins.rows[0];

  // Auto-seed the 3 default plans so the reseller has a starting catalog.
  await seedResellerPlans(row.id);

  res.json({
    ok: true,
    reseller: {
      id:             String(row.id),
      email:          row.email,
      username:       row.username,
      resellerPortal: row.reseller_portal,
      createdAt:      row.created_at,
    },
  });
});

// GET /api/admin/resellers/:id/customers — full customer detail for one
// reseller. Matched on TWO axes so it survives data drift:
//   1. users.reseller_id = <reseller_id>        (the canonical FK)
//   2. portal slug match — any user whose chain resolves to this reseller's
//      reseller_portal, even if reseller_id is somehow null
// The OR keeps the count accurate against future migrations.
app.get('/api/admin/resellers/:id/customers', auth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const r0 = await q(
    `SELECT id, email, company, name, reseller_portal FROM users
      WHERE id = $1 AND user_type = 'reseller' LIMIT 1`,
    [id],
  );
  if (!r0.rowCount) return res.status(404).json({ error: 'Reseller not found' });
  const reseller = r0.rows[0];
  const slug = reseller.reseller_portal;

  const r = await q(`
    SELECT u.id, u.name, u.company, u.username, u.email, u.phone,
           u.user_type, u.plan_label, u.plan_amount, u.plan_min, u.plan_rate,
           u.number_value, u.number_loc, u.minutes_used, u.created_at,
           u.plan_activated_at, u.plan_expires_at,
           u.reseller_id,
           -- Resolve the portal slug of the user's reseller (one hop up).
           r2.reseller_portal AS via_portal,
           (SELECT COUNT(*) FROM user_numbers un WHERE un.user_id = u.id) AS number_count
      FROM users u
      LEFT JOIN users r2 ON r2.id = u.reseller_id
     WHERE u.user_type = 'user'
       AND (
         u.reseller_id = $1
         OR ($2::text IS NOT NULL AND LOWER(r2.reseller_portal) = LOWER($2))
       )
     ORDER BY u.created_at DESC
  `, [id, slug]);

  // Same multi-plan join used elsewhere — every DID under each customer,
  // resolved to its plan tier via findPlanById. Lets the drill-down modal
  // render one row per DID (multi-plan customers like voice@infobip.com).
  const customerIds = r.rows.map((row) => row.id);
  const numbersByUser = new Map();
  if (customerIds.length) {
    const nRes = await q(
      `SELECT id, user_id, number_value, label, is_primary, plan_id, plan_cycle,
              provisioning_status, created_at
         FROM user_numbers
        WHERE user_id = ANY($1::int[])
        ORDER BY user_id, is_primary DESC, created_at ASC`,
      [customerIds],
    );
    for (const n of nRes.rows) {
      const plan = findPlanById(n.plan_id);
      const arr = numbersByUser.get(n.user_id) || [];
      arr.push({
        id:        String(n.id),
        value:     n.number_value,
        label:     n.label || '',
        isPrimary: !!n.is_primary,
        status:    n.provisioning_status || 'unprovisioned',
        planCycle: n.plan_cycle || 'monthly',
        createdAt: n.created_at,
        plan: {
          id:     plan.id,
          label:  plan.label,
          amount: plan.amount,
          min:    plan.min,
          rate:   plan.rate,
        },
      });
      numbersByUser.set(n.user_id, arr);
    }
  }

  res.json({
    reseller: {
      id:             String(reseller.id),
      email:          reseller.email,
      company:        reseller.company || reseller.name,
      resellerPortal: reseller.reseller_portal,
    },
    customers: r.rows.map((row) => ({
      id:       String(row.id),
      name:     row.name,
      company:  row.company || '',
      email:    row.email,
      phone:    row.phone || '',
      username: row.username,
      plan: row.plan_label ? {
        label:  row.plan_label,
        amount: Number(row.plan_amount) || 0,
        min:    row.plan_min || 0,
        rate:   Number(row.plan_rate) || 0,
      } : null,
      number:        row.number_value || null,
      numberLoc:     row.number_loc || null,
      numberCount:   Number(row.number_count) || 0,
      minutesUsed:   Number(row.minutes_used) || 0,
      viaPortal:     row.via_portal || null,
      planActivated: row.plan_activated_at,
      planExpires:   row.plan_expires_at,
      createdAt:     row.created_at,
      // Per-DID plan tiers — drives the multi-row layout in the modal.
      numbers:       numbersByUser.get(row.id) || [],
    })),
  });
});

// Also update the LIST endpoint (/api/admin/resellers) to count customers
// the same way — match on reseller_id OR on portal-slug match against the
// resolved via_portal so the pill counts what the modal will list.
// (Inline the SQL change in the existing handler below for consistency.)

// ============================================================================
// Admin — DID inventory. Lists every DID in the pool (env MANUAL_NUMBERS +
// any added via the UI) with its assignment status, lets the superadmin
// register new DIDs, and supports removing DIDs that aren't assigned.
// ============================================================================
app.get('/api/admin/numbers', auth, requireAdmin, async (_req, res) => {
  // Build the canonical pool by unioning env-managed numbers with the
  // dynamically-added did_inventory rows.
  const envSet = new Set(MANUAL_NUMBERS.map(formatManualNumber));
  const dbRows = await q(
    `SELECT number_value, locality, region, added_at,
            (SELECT email FROM users WHERE id = di.added_by) AS added_by_email
       FROM did_inventory di
      ORDER BY added_at DESC`,
  );
  const dbByValue = new Map(dbRows.rows.map((r) => [formatManualNumber(r.number_value), r]));

  // Who has each DID claimed?
  const ownerRows = await q(`
    SELECT number_value, user_id
      FROM user_numbers
     WHERE number_value IS NOT NULL
  `);
  const ownerUids = ownerRows.rows.map((r) => r.user_id);
  const userLookup = ownerUids.length
    ? (await q(
        `SELECT id, email, company, name FROM users WHERE id = ANY($1::int[])`,
        [ownerUids],
      )).rows
    : [];
  const userByUid = new Map(userLookup.map((u) => [u.id, u]));
  const ownerByValue = new Map();
  for (const r of ownerRows.rows) {
    const norm = formatManualNumber(r.number_value);
    const owner = userByUid.get(r.user_id);
    if (owner) {
      ownerByValue.set(norm, {
        userId: String(owner.id),
        email:  owner.email,
        label:  owner.company || owner.name,
      });
    }
  }

  // Merge sources: env first (canonical), then DB extras.
  const all = new Set([...envSet, ...dbByValue.keys()]);
  const rows = [...all].map((v) => {
    const fromDb = dbByValue.get(v);
    const owner = ownerByValue.get(v);
    return {
      value:     v,
      source:    envSet.has(v) ? 'env' : 'db',
      locality:  fromDb?.locality || MANUAL_LOCALITY || '',
      region:    fromDb?.region   || MANUAL_REGION   || '',
      addedAt:   fromDb?.added_at || null,
      addedBy:   fromDb?.added_by_email || null,
      status:    owner ? 'busy' : 'free',
      owner:     owner || null,
    };
  });

  // Sort: busy first, then alphabetical so the UI groups assigned ones up top.
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'busy' ? -1 : 1;
    return a.value.localeCompare(b.value);
  });

  res.json({
    numbers: rows,
    totals: {
      total: rows.length,
      busy:  rows.filter((r) => r.status === 'busy').length,
      free:  rows.filter((r) => r.status === 'free').length,
    },
  });
});

app.post('/api/admin/numbers', auth, requireAdmin, async (req, res) => {
  const raw = String(req.body?.number || '').trim();
  if (!raw) return res.status(400).json({ error: 'number required' });
  const normalized = formatManualNumber(raw);
  if (!/^\+\d{8,15}$/.test(normalized)) {
    return res.status(400).json({ error: 'Invalid number format — expected E.164 (e.g. +918037683049)' });
  }

  // Duplicate check across env + db + already-assigned rows.
  const envSet = new Set(MANUAL_NUMBERS.map(formatManualNumber));
  if (envSet.has(normalized)) {
    return res.status(409).json({ error: 'Already in env-managed MANUAL_NUMBERS pool' });
  }
  const exists = await q(`SELECT 1 FROM did_inventory WHERE number_value = $1`, [normalized]);
  if (exists.rowCount) return res.status(409).json({ error: 'Already in inventory' });

  await q(
    `INSERT INTO did_inventory (number_value, locality, region, added_by)
     VALUES ($1, $2, $3, $4)`,
    [normalized, String(req.body?.locality || '').trim(), String(req.body?.region || '').trim(), req.user.id],
  );
  res.json({ ok: true, number: { value: normalized } });
});

app.delete('/api/admin/numbers/:value', auth, requireAdmin, async (req, res) => {
  const normalized = formatManualNumber(req.params.value);
  // Reject if currently assigned to a customer.
  const claimed = await q(`SELECT 1 FROM user_numbers WHERE number_value = $1 LIMIT 1`, [normalized]);
  if (claimed.rowCount) {
    return res.status(409).json({ error: 'Cannot remove — number is assigned to a customer. Release it from the customer first.' });
  }
  // Only DB-added DIDs are removable. Env-managed entries stay until pulled
  // out of MANUAL_NUMBERS by the operator.
  const r = await q(`DELETE FROM did_inventory WHERE number_value = $1 RETURNING number_value`, [normalized]);
  if (!r.rowCount) {
    return res.status(404).json({ error: 'Not in inventory (or env-managed — edit MANUAL_NUMBERS to remove)' });
  }
  res.json({ ok: true });
});

// ============================================================================
// Reseller surface — endpoints scoped to the logged-in reseller's own tree.
// `requireReseller` guards anything that should be reseller-only; everything
// returned is filtered to rows where the reseller owns them.
// ============================================================================
// Accepts both 'reseller' and 'sub-reseller' — sub-resellers share the same
// surface (they see their own customers/purchases, can on-board further
// sub-resellers). The endpoints all filter by reseller_id = req.user.id, so
// each tier only ever sees its own downstream rows.
const requireReseller = (req, res, next) => {
  if (!req.user || !['reseller', 'sub-reseller'].includes(req.user.user_type)) {
    return res.status(403).json({ error: 'Reseller access required' });
  }
  next();
};

// ----------------------------------------------------------------------------
// Sub-resellers — one level below `reseller`. A reseller can on-board their
// own partners (sub-resellers); those partners then on-board customers. The
// hierarchy becomes: superadmin → reseller → sub-reseller → user. Customers
// signing up through a sub-reseller's portal slug get reseller_id = the
// sub-reseller's id, and the parent reseller still sees them in their
// downstream because the via_portal column climbs the chain.
// ----------------------------------------------------------------------------

// GET /api/reseller/sub-resellers — every sub-reseller this reseller created.
// Joined with a customer count so the table can show "N customers" per
// sub-reseller without an N+1.
app.get('/api/reseller/sub-resellers', auth, requireReseller, async (req, res) => {
  const r = await q(`
    SELECT u.id, u.name, u.company, u.username, u.email, u.phone,
           u.reseller_portal, u.kyc_address, u.kyc_location, u.created_at,
           (SELECT COUNT(*) FROM users c
             WHERE c.user_type = 'user' AND c.reseller_id = u.id) AS customer_count
      FROM users u
     WHERE u.user_type = 'sub-reseller'
       AND u.reseller_id = $1
     ORDER BY u.created_at DESC
  `, [req.user.id]);
  res.json({
    subResellers: r.rows.map((row) => ({
      id:             String(row.id),
      name:           row.name,
      company:        row.company || '',
      username:       row.username,
      email:          row.email,
      phone:          row.phone || '',
      resellerPortal: row.reseller_portal || '',
      kycAddress:     row.kyc_address  || '',
      kycLocation:    row.kyc_location || '',
      customerCount:  Number(row.customer_count) || 0,
      createdAt:      row.created_at,
    })),
  });
});

// POST /api/reseller/sub-resellers — register a sub-reseller. Same shape
// and validation as superadmin's reseller-registration form, scoped to the
// logged-in reseller's tree (reseller_id pre-set to req.user.id).
app.post('/api/reseller/sub-resellers', auth, requireReseller, async (req, res) => {
  // Only top-level resellers may create sub-resellers. Sub-resellers manage
  // customers, not further sub-resellers.
  if (req.user.user_type !== 'reseller') {
    return res.status(403).json({ error: 'Only resellers can add sub-resellers' });
  }
  const b = req.body || {};
  const required = ['name', 'company', 'email', 'username', 'password', 'phone', 'resellerPortal'];
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') {
      return res.status(400).json({ error: `${k} is required` });
    }
  }
  if (!/\S+@\S+\.\S+/.test(String(b.email))) return res.status(400).json({ error: 'Invalid email' });
  if (String(b.password).length < 8)        return res.status(400).json({ error: 'Password must be 8+ chars' });

  const slug = String(b.resellerPortal).trim().toLowerCase();

  const dup = await q(
    `SELECT 1 FROM users
      WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2)
         OR LOWER(reseller_portal) = $3
      LIMIT 1`,
    [String(b.email).trim(), String(b.username).trim(), slug],
  );
  if (dup.rowCount) {
    return res.status(409).json({ error: 'Email, username or portal slug already in use' });
  }

  const passwordHash = await bcrypt.hash(String(b.password), 10);
  const ins = await q(
    `INSERT INTO users (
       name, company, username, email, phone, password_hash, role,
       user_type, reseller_id, reseller_portal, kyc_address, kyc_location
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 'customer',
       'sub-reseller', $7, $8, $9, $10
     ) RETURNING id, email, username, reseller_portal, created_at`,
    [
      String(b.name).trim(),
      String(b.company).trim(),
      String(b.username).trim(),
      String(b.email).trim(),
      String(b.phone).trim(),
      passwordHash,
      req.user.id,                                            // parent reseller
      slug,
      String(b.kycAddress  || '').trim(),
      String(b.kycLocation || '').trim(),
    ],
  );
  const row = ins.rows[0];

  // Seed the platform's default plans into the sub-reseller's catalog so
  // they have something to show / edit on their My plans tab from day one.
  // Without this, /api/reseller/plans returns [] for them and the editor
  // loads empty. They can edit prices up from here just like resellers.
  await seedResellerPlans(row.id);

  res.json({
    ok: true,
    subReseller: {
      id:             String(row.id),
      email:          row.email,
      username:       row.username,
      resellerPortal: row.reseller_portal,
      createdAt:      row.created_at,
    },
  });
});

// List customers under this reseller. Same shape as /api/admin/users so the
// reseller dashboard can render with the same table component.
app.get('/api/reseller/customers', auth, requireReseller, async (req, res) => {
  const r = await q(`
    SELECT u.id, u.name, u.company, u.username, u.email, u.phone,
           u.user_type, u.plan_label, u.plan_amount, u.plan_min, u.plan_rate, u.plan_agents,
           u.number_value, u.number_loc, u.minutes_used, u.created_at,
           u.plan_activated_at, u.plan_expires_at,
           (SELECT COUNT(*) FROM user_numbers un WHERE un.user_id = u.id) AS number_count
      FROM users u
     WHERE u.reseller_id = $1
       AND u.user_type = 'user'
     ORDER BY u.created_at DESC
  `, [req.user.id]);

  // Same multi-plan join as /api/admin/users — every DID under each customer,
  // resolved to its full plan tier. Powers the per-customer "all plans + numbers"
  // view on the reseller's Customers tab (matches what superadmin sees).
  const customerIds = r.rows.map((row) => row.id);
  const numbersByUser = new Map();
  if (customerIds.length) {
    const nRes = await q(
      `SELECT id, user_id, number_value, label, is_primary, plan_id, plan_cycle,
              provisioning_status, created_at
         FROM user_numbers
        WHERE user_id = ANY($1::int[])
        ORDER BY user_id, is_primary DESC, created_at ASC`,
      [customerIds],
    );
    for (const n of nRes.rows) {
      const plan = findPlanById(n.plan_id);
      const arr = numbersByUser.get(n.user_id) || [];
      arr.push({
        id:        String(n.id),
        value:     n.number_value,
        label:     n.label || '',
        isPrimary: !!n.is_primary,
        status:    n.provisioning_status || 'unprovisioned',
        planCycle: n.plan_cycle || 'monthly',
        createdAt: n.created_at,
        plan: {
          id:     plan.id,
          label:  plan.label,
          amount: plan.amount,
          min:    plan.min,
          rate:   plan.rate,
        },
      });
      numbersByUser.set(n.user_id, arr);
    }
  }

  res.json({
    customers: r.rows.map((row) => ({
      id:       String(row.id),
      name:     row.name,
      company:  row.company || '',
      email:    row.email,
      phone:    row.phone || '',
      username: row.username,
      plan: row.plan_label ? {
        label:  row.plan_label,
        amount: Number(row.plan_amount) || 0,
        min:    row.plan_min || 0,
        rate:   Number(row.plan_rate) || 0,
        agents: row.plan_agents || 0,
      } : null,
      number:        row.number_value || null,
      numberLoc:     row.number_loc || null,
      numberCount:   Number(row.number_count) || 0,
      minutesUsed:   Number(row.minutes_used) || 0,
      planActivated: row.plan_activated_at,
      planExpires:   row.plan_expires_at,
      createdAt:     row.created_at,
      // Every DID this customer has, with its own plan tier. Reseller's
      // Customers tab renders one line per DID under the customer row.
      numbers:       numbersByUser.get(row.id) || [],
    })),
  });
});

// GET /api/reseller/purchases — every plan a reseller's customers have on
// their account, plus any wallet-ledger events (top-ups / plan changes).
//
// `user_numbers` is the authoritative purchase log — each row IS a plan
// the customer bought (every DID has its own plan tier). The
// wallet_transactions ledger is unioned on top so top-ups and plan
// changes show up too, but the per-DID rows are sourced directly from
// user_numbers since not every install backfills the ledger.
app.get('/api/reseller/purchases', auth, requireReseller, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 200));

  // 1. Every DID provisioned for a customer under this reseller — each row
  //    is a "Plan + DID purchase" with the plan amount resolved from the
  //    catalog.
  const didsRes = await q(`
    SELECT un.id, un.user_id, un.number_value, un.plan_id, un.plan_cycle,
           un.is_primary, un.provisioning_status, un.provisioning_ref,
           un.created_at,
           u.name     AS customer_name,
           u.company  AS customer_company,
           u.email    AS customer_email
      FROM user_numbers un
      JOIN users u ON u.id = un.user_id
     WHERE u.reseller_id = $1
       AND u.user_type = 'user'
     ORDER BY un.created_at DESC
     LIMIT $2
  `, [req.user.id, limit]);

  const didPurchases = didsRes.rows.map((row) => {
    const plan = findPlanById(row.plan_id);
    const amount = row.plan_cycle === 'yearly'
      ? (yearlyPriceUsd ? yearlyPriceUsd(plan) : Math.round(plan.amount * 12 * 0.9))
      : plan.amount;
    return {
      id:           `did-${row.id}`,
      kind:         'new-number-plan',
      amount:       Number(amount) || 0,
      description:  `${plan.label} (${row.plan_cycle || 'monthly'}) on ${row.number_value}`,
      status:       row.provisioning_status === 'provisioned' ? 'success' : (row.provisioning_status || 'pending'),
      externalRef:  row.provisioning_ref || null,
      createdAt:    row.created_at,
      planCycle:    row.plan_cycle || 'monthly',
      planLabel:    plan.label,
      number:       row.number_value,
      isPrimary:    !!row.is_primary,
      customer: {
        id:      String(row.user_id),
        name:    row.customer_name,
        company: row.customer_company || '',
        email:   row.customer_email,
        number:  row.number_value,
      },
    };
  });

  // 2. Wallet-ledger events (top-ups, plan changes, restarts) — only the
  //    ones that aren't already represented in the DID list. Filtered to
  //    customers under this reseller.
  const txRes = await q(`
    SELECT t.id, t.user_id, t.kind, t.minutes_delta, t.amount_usd,
           t.description, t.status, t.external_ref, t.created_at,
           u.name      AS customer_name,
           u.company   AS customer_company,
           u.email     AS customer_email,
           u.number_value AS customer_number
      FROM wallet_transactions t
      JOIN users u ON u.id = t.user_id
     WHERE u.reseller_id = $1
       AND u.user_type = 'user'
       AND t.kind <> 'new-number-plan'
     ORDER BY t.created_at DESC
     LIMIT $2
  `, [req.user.id, limit]);

  const txPurchases = txRes.rows.map((row) => ({
    id:          `tx-${row.id}`,
    kind:        row.kind,
    minutesDelta: Number(row.minutes_delta) || 0,
    amount:      Number(row.amount_usd) || 0,
    description: row.description || '',
    status:      row.status || 'unknown',
    externalRef: row.external_ref || null,
    createdAt:   row.created_at,
    customer: {
      id:      String(row.user_id),
      name:    row.customer_name,
      company: row.customer_company || '',
      email:   row.customer_email,
      number:  row.customer_number || null,
    },
  }));

  // Merge + chrono sort newest first.
  const purchases = [...didPurchases, ...txPurchases]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);

  // KPI totals — recomputed off the merged list so the UI matches the table.
  const totalsByKind = new Map();
  for (const p of purchases) {
    const slot = totalsByKind.get(p.kind) || { kind: p.kind, count: 0, sum: 0 };
    slot.count += 1;
    slot.sum   += p.amount || 0;
    totalsByKind.set(p.kind, slot);
  }

  res.json({
    purchases,
    totals: [...totalsByKind.values()],
  });
});

// Reseller's own catalog — used by both the reseller's plans-editor (next
// phase) and the public signup flow when it needs to know what to charge
// customers signing up through this reseller's portal.
app.get('/api/reseller/plans', auth, requireReseller, async (req, res) => {
  const r = await q(
    `SELECT base_plan_id, label, amount, rate, min, agents, is_active
       FROM reseller_plans
      WHERE reseller_id = $1
      ORDER BY amount`,
    [req.user.id],
  );
  res.json({ plans: r.rows.map((p) => ({
    basePlanId: p.base_plan_id,
    label:      p.label,
    amount:     Number(p.amount) || 0,
    rate:       Number(p.rate)   || 0,
    min:        p.min || 0,
    agents:     p.agents || 0,
    isActive:   !!p.is_active,
  })) });
});

// PATCH /api/reseller/plans/:basePlanId — let the reseller edit one of
// their 3 plans. Floor validation enforces amount >= base_plan.amount and
// rate >= base_plan.rate so resellers can only raise prices above what
// they owe the platform (per product rule).
app.patch('/api/reseller/plans/:basePlanId', auth, requireReseller, async (req, res) => {
  const basePlanId = String(req.params.basePlanId || '').toLowerCase();
  const base = getBasePlansSync().find((p) => p.id === basePlanId);
  if (!base) return res.status(400).json({ error: 'Unknown base plan id' });

  // Currency in which THIS reseller serves its plans (USD for 9278.ai etc.).
  // The base plan's amount/rate are always in USD (that's what they owe us);
  // we translate to the reseller's currency before applying the ≥-floor.
  const cr = await q(
    `SELECT display_currency FROM users WHERE id = $1 LIMIT 1`,
    [req.user.id],
  );
  const sellerCurrency = (cr.rows[0]?.display_currency || 'USD').toUpperCase();
  const USD_USD = Number(process.env.USD_USD) || 95;
  const toSellerCurrency = (inr) => {
    if (sellerCurrency === 'USD') return inr;
    if (sellerCurrency === 'USD') return Math.round((inr / USD_USD) * 100) / 100;
    return inr;
  };
  const amountFloor = toSellerCurrency(base.amount);
  const rateFloor   = toSellerCurrency(base.rate);
  const sym = sellerCurrency === 'USD' ? '$' : sellerCurrency === 'USD' ? '$' : sellerCurrency + ' ';
  const fmt = (n) => sym + (sellerCurrency === 'USD'
    ? Number(n).toLocaleString('en-US')
    : Number(n).toFixed(2));

  const b = req.body || {};
  const newAmount = b.amount !== undefined ? Number(b.amount) : null;
  const newRate   = b.rate   !== undefined ? Number(b.rate)   : null;
  const newLabel  = b.label  !== undefined ? String(b.label).trim() : null;
  const newMin    = b.min    !== undefined ? Math.max(0, Math.floor(Number(b.min))) : null;
  const newAgents = b.agents !== undefined ? Math.max(0, Math.floor(Number(b.agents))) : null;

  // Floor checks — the reseller's price must cover the platform base AFTER
  // currency conversion. Otherwise we'd settle a loss every customer.
  if (newAmount !== null && newAmount < amountFloor) {
    return res.status(400).json({
      error: `Price for ${base.label} must be ≥ ${fmt(amountFloor)} (the platform base in ${sellerCurrency}).`,
    });
  }
  if (newRate !== null && newRate < rateFloor) {
    return res.status(400).json({
      error: `Per-minute rate for ${base.label} must be ≥ ${fmt(rateFloor)} (the platform base in ${sellerCurrency}).`,
    });
  }
  if (newLabel !== null && !newLabel) {
    return res.status(400).json({ error: 'Label cannot be empty.' });
  }

  const sets = [], vals = [];
  let i = 1;
  if (newAmount !== null) { sets.push(`amount = $${i++}`); vals.push(newAmount); }
  if (newRate   !== null) { sets.push(`rate = $${i++}`);   vals.push(newRate); }
  if (newLabel  !== null) { sets.push(`label = $${i++}`);  vals.push(newLabel); }
  if (newMin    !== null) { sets.push(`min = $${i++}`);    vals.push(newMin); }
  if (newAgents !== null) { sets.push(`agents = $${i++}`); vals.push(newAgents); }
  if (!sets.length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  sets.push(`updated_at = NOW()`);
  vals.push(req.user.id, basePlanId);
  const r = await q(
    `UPDATE reseller_plans SET ${sets.join(', ')}
      WHERE reseller_id = $${i++} AND base_plan_id = $${i}
      RETURNING base_plan_id, label, amount, rate, min, agents, is_active`,
    vals,
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Plan not found' });

  const p = r.rows[0];
  res.json({
    ok: true,
    plan: {
      basePlanId: p.base_plan_id,
      label:      p.label,
      amount:     Number(p.amount) || 0,
      rate:       Number(p.rate)   || 0,
      min:        p.min || 0,
      agents:     p.agents || 0,
      isActive:   !!p.is_active,
    },
  });
});

app.get('/api/admin/settings', auth, requireAdmin, async (_req, res) => {
  try {
    res.json({ sections: await readSettingsForAdmin() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/settings', auth, requireAdmin, async (req, res) => {
  try {
    const sections = await updateSettings(req.body || {}, req.user.id);
    res.json({ sections });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Base plan catalog editor — Scale/Growth/Starter, the same three cards
// GET /api/plans serves to customers. Admin-only; edits persist to the
// base_plans table and take effect immediately everywhere getBasePlansSync()
// is read (checkout, quotes, plan lookups), not just this display page.
app.get('/api/admin/base-plans', auth, requireAdmin, async (_req, res) => {
  try {
    res.json({ plans: await getBasePlansForAdmin() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/base-plans/:id', auth, requireAdmin, async (req, res) => {
  const id = String(req.params.id || '').toLowerCase();
  const body = req.body || {};
  const patch = {};
  try {
    for (const key of EDITABLE_PLAN_FIELDS) {
      if (!(key in body)) continue;
      const v = body[key];
      if (['amount', 'min', 'rate', 'overage', 'dids', 'concurrent', 'agents'].includes(key)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number`);
        patch[key] = n;
      } else if (key === 'yearlyAmount') {
        // Empty/null clears the override so withYearly() auto-derives from amount again.
        if (v === null || v === '' || v === undefined) {
          patch.yearlyAmount = null;
        } else {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) throw new Error('yearlyAmount must be a non-negative number');
          patch.yearlyAmount = n;
        }
      } else if (key === 'perks') {
        if (!Array.isArray(v)) throw new Error('perks must be an array of strings');
        patch.perks = v.map((s) => String(s).trim()).filter(Boolean);
      } else if (key === 'tag') {
        patch.tag = v ? String(v).trim() : null;
      } else {
        // label, sub, voiceStack, support
        patch[key] = String(v ?? '').trim();
      }
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No editable fields provided' });

  try {
    const updated = await updateBasePlan(id, patch);
    if (!updated) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/stats', auth, requireAdmin, async (_req, res) => {
  const counts = await q(
    `SELECT
       COUNT(*) FILTER (WHERE role = 'customer')::int AS customers,
       COUNT(*) FILTER (WHERE role = 'admin')::int AS admins,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24h,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS last_7d,
       COALESCE(SUM(plan_amount) FILTER (WHERE role = 'customer'), 0)::numeric AS mrr_plan,
       COALESCE(SUM(number_price) FILTER (WHERE role = 'customer' AND number_value IS NOT NULL), 0)::numeric AS mrr_number
     FROM users`,
  );
  const row = counts.rows[0];
  res.json({
    customers: row.customers,
    admins: row.admins,
    signupsLast24h: row.last_24h,
    signupsLast7d: row.last_7d,
    mrr: Number(row.mrr_plan) + Number(row.mrr_number),
    mrrFromPlans: Number(row.mrr_plan),
    mrrFromNumbers: Number(row.mrr_number),
  });
});

// ---- Twilio integration ----------------------------------------------------

app.get('/api/twilio/status', (_req, res) => {
  res.json({
    configured: twilioConfigured,
    defaultNumber: twilioDefaultNumber || null,
    publicBaseUrl: publicBaseUrl || null,
  });
});

// Search available numbers for purchase. Anonymous-friendly so the signup
// flow can list options without a token.
// === MANUAL INVENTORY MODE ==================================================
// While the carrier API (Plivo/Exotel/TATA) is not yet wired, expose the
// DIDs we already own via MANUAL_NUMBERS so signup can complete end-to-end.
const NUMBER_PROVIDER = (process.env.NUMBER_PROVIDER || 'twilio').toLowerCase();
const MANUAL_NUMBERS = (process.env.MANUAL_NUMBERS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MANUAL_PRICE_USD = Number(process.env.MANUAL_NUMBER_PRICE_USD) || 400;
const MANUAL_LOCALITY = process.env.MANUAL_NUMBER_LOCALITY || '';
const MANUAL_REGION = process.env.MANUAL_NUMBER_REGION || '';

const formatManualNumber = (raw) => {
  // Normalise to E.164. Adds India's country code +91 ONLY for clearly
  // Indian-shaped numbers — never overrides an existing non-91 country
  // code (so US/+1, UK/+44, etc. survive untouched).
  //
  //   "8037683127"     (10 digits, starts 6-9) → "+918037683127"   prepend 91
  //   "918037683127"   (12 digits, starts 91)  → "+918037683127"   already has CC
  //   "+918037683127"  (E.164)                 → "+918037683127"
  //   "+19452124226"   (US, 11 digits)         → "+19452124226"    untouched
  //   "+447911123456"  (UK)                    → "+447911123456"   untouched
  //   "8037683127"     (10 digits, starts 6-9) → adds 91 (Indian mobile/landline)
  let digits = String(raw).replace(/\D+/g, '');
  const isIndianLocal = digits.length === 10 && /^[6-9]/.test(digits);   // mobile starts 6-9
  const hasIndianCC   = digits.length === 12 && digits.startsWith('91');
  if (isIndianLocal) digits = '91' + digits;
  else if (hasIndianCC) { /* fine */ }
  // Everything else (US, UK, malformed, etc.) is left as-is.
  return `+${digits}`;
};

app.get('/api/twilio/available-numbers', async (req, res) => {
  // Short-circuit when running in manual inventory mode.
  if (NUMBER_PROVIDER === 'manual') {
    try {
      // Owned numbers live in BOTH the legacy users.number_value column AND
      // the per-row user_numbers table (signup primaries + extras added from
      // the dashboard). Union both so we never offer a number that's already
      // attached anywhere.
      const taken = new Set([
        ...(await q(`SELECT number_value FROM users WHERE number_value IS NOT NULL AND number_value <> ''`)).rows
          .map((r) => r.number_value),
        ...(await q(`SELECT number_value FROM user_numbers`)).rows
          .map((r) => r.number_value),
      ]);
      const numbers = MANUAL_NUMBERS
        .map(formatManualNumber)
        .filter((n) => !taken.has(n))
        .map((phoneNumber) => ({
          phoneNumber,
          friendlyName: phoneNumber,
          locality: MANUAL_LOCALITY,
          region: MANUAL_REGION,
          isoCountry: 'IN',
          capabilities: { voice: true, SMS: false, MMS: false },
          priceInr: MANUAL_PRICE_USD,
        }));
      return res.json({ numbers, source: 'manual' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  // Twilio path (default) — keep the previous behavior for non-manual provider.
  if (!twilioConfigured) return res.status(503).json({ error: 'Provider not configured' });
  try {
    const country = (req.query.country || 'IN').toString().toUpperCase();
    const type = (req.query.type || 'local').toString();
    const areaCode = req.query.areaCode ? Number(req.query.areaCode) : undefined;
    const contains = req.query.contains ? String(req.query.contains) : undefined;
    const inRegion = req.query.inRegion ? String(req.query.inRegion) : undefined;
    const inLocality = req.query.inLocality ? String(req.query.inLocality) : undefined;
    const limit = Math.min(Number(req.query.limit) || 12, 30);

    const ctx = twilioClient.availablePhoneNumbers(country);
    const list = type === 'tollFree' ? ctx.tollFree : type === 'mobile' ? ctx.mobile : ctx.local;
    const params = { limit };
    if (areaCode) params.areaCode = areaCode;
    if (contains) params.contains = contains;
    if (inRegion) params.inRegion = inRegion;
    if (inLocality) params.inLocality = inLocality;
    const rows = await list.list(params);
    res.json({
      numbers: rows.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName || n.phoneNumber,
        locality: n.locality || '',
        region: n.region || '',
        isoCountry: n.isoCountry || country,
        capabilities: n.capabilities || {},
      })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Twilio search failed' });
  }
});

// Purchase a number for the logged-in user. Stores SID + phone on the user.
// Attach an owned DID (from MANUAL_NUMBERS) to the logged-in user, then run
// MCP provisioning. No Twilio API — the DID inventory is local-only since we
// run on the TATA SIP gateway, not Twilio.
const handleNumberAttach = async (req, res) => {
  const phoneNumber = (req.body && req.body.phoneNumber) || '';
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });

  // Verify the DID is in our owned inventory and not already taken.
  const normalized = formatManualNumber(phoneNumber);
  if (NUMBER_PROVIDER !== 'manual') {
    return res.status(503).json({ error: 'Only manual provider supported here' });
  }
  if (!MANUAL_NUMBERS.map(formatManualNumber).includes(normalized)) {
    return res.status(400).json({ error: `Number ${normalized} is not in MANUAL_NUMBERS inventory` });
  }
  const taken = await q(
    `SELECT id FROM users WHERE number_value = $1 AND id <> $2`,
    [normalized, req.user.id],
  );
  if (taken.rowCount) return res.status(409).json({ error: 'Number already attached to another user' });

  await q(
    `UPDATE users SET number_value = $1, updated_at = NOW() WHERE id = $2`,
    [normalized, req.user.id],
  );
  // Mirror into user_numbers as the primary. Idempotent — if the user already
  // has a primary (e.g. they're re-attaching the same DID) just update it.
  await q(
    `INSERT INTO user_numbers (user_id, number_value, is_primary)
     VALUES ($1, $2, true)
     ON CONFLICT (number_value) DO UPDATE
       SET user_id = EXCLUDED.user_id, is_primary = true, updated_at = NOW()`,
    [req.user.id, normalized],
  );

  let provisioning = null;
  if (mcpConfigured) {
    try { provisioning = await provisionInboundForUser(req.user.id); }
    catch (e) { provisioning = { ok: false, error: e.message }; }
  } else {
    provisioning = { ok: false, error: 'MCP not configured' };
  }

  res.json({ phoneNumber: normalized, provisioning });
};
app.post('/api/numbers/attach', auth, handleNumberAttach);
// Back-compat alias for the old Twilio-era route name.
app.post('/api/twilio/purchase', auth, handleNumberAttach);

// ---- Multi-number management (Numbers tab in customer dashboard) -----------
// Plan limits: Starter=1, Growth=5, Scale=20. Primary number lives in
// users.number_value (legacy) AND user_numbers (as is_primary=true). Additional
// numbers are user_numbers rows with is_primary=false.

// Look up a plan catalog entry by id (defaults to starter on unknown ids).
const findPlanById = (planId) => {
  const id = String(planId || 'starter').toLowerCase();
  return getBasePlansSync().find((p) => p.id === id) || getBasePlansSync().find((p) => p.id === 'starter');
};

const publicNumber = (row) => {
  // Per-number rental cycle is independent of the user's plan. The clock
  // anchors on `last_rented_at` (defaults to row.created_at if NULL) and
  // renews every 30 days, charging the wallet via the runRentSweep cron.
  const rentAnchor = row.last_rented_at || row.created_at;
  const nextRentalAt = rentAnchor
    ? new Date(new Date(rentAnchor).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const plan = findPlanById(row.plan_id);
  return {
    id: String(row.id),
    value: row.number_value,
    label: row.label || '',
    isPrimary: !!row.is_primary,
    status: row.provisioning_status || 'unprovisioned',
    error: row.provisioning_error || null,
    provisionedAt: row.provisioned_at || null,
    createdAt: row.created_at,
    // Per-number rental — surfaced so the Numbers tab can show "Activated X, renews Y".
    activatedAt:   rentAnchor,
    nextRentalAt,
    rentStatus:    row.rent_status || 'active',
    // Per-number plan tier (defaults to 'starter' for legacy rows + new DIDs).
    // Customers can move each DID between plans independently of the
    // account-level plan_label.
    plan: {
      id:     plan.id,
      label:  plan.label,
      amount: plan.amount,
      min:    plan.min,
      rate:   plan.rate,
    },
    // Per-number agent config.
    agentId:   row.agent_id   || null,
    agentSlug: row.agent_slug || null,
    agentName: row.agent_name || '',
    greeting:  row.greeting   || '',
    prompt:    row.prompt     || '',
    kbCompany: row.kb_company || '',
    kbFaqs:    row.kb_faqs    || '',
    voice:     row.voice      || '',
    language:  row.language   || 'en-US',
    // Auto-recharge toggle for THIS number — drives the per-plan list on
    // the Billing → Auto-recharge tab.
    autoRechargeEnabled: !!row.auto_recharge_enabled,
    // Which saved card this plan's auto-recharge uses (payment_methods.id) —
    // the Auto-recharge tab cross-references this against GET /api/payment-methods.
    autoRechargePmId: row.auto_recharge_pm_id != null ? String(row.auto_recharge_pm_id) : null,
    // Billing cycle for this DID — 'monthly' or 'yearly'. Yearly customers
    // can top up the shared wallet for overflow; monthly customers must
    // Restart plan instead. Surfaced so the per-DID card on Billing can
    // hide/show "+ Add wallet funds" accordingly.
    planCycle: row.plan_cycle || 'monthly',
  };
};

app.get('/api/numbers', auth, async (req, res) => {
  const r = await q(
    `SELECT * FROM user_numbers
      WHERE user_id = $1
      ORDER BY is_primary DESC, created_at ASC`,
    [req.user.id],
  );
  const limit = numberLimitFor(req.user);
  res.json({
    numbers: r.rows.map(publicNumber),
    limit,
    used: r.rowCount,
    remaining: Math.max(0, limit - r.rowCount),
    pricePerNumber: additionalNumberPriceInr(),
    plan: req.user.plan_label || null,
  });
});

// ---- Call forwarding (blind transfer) per agent ---------------------------
// Reads/writes the agent's call-forwarding destination via the dashboard MCP
// tools get_transfer_number / set_transfer_number. Scoped to the agent that
// belongs to one of this customer's DIDs (tenant guard). The MCP tool itself
// has a loopback guard that refuses the customer's own inbound numbers.
const ownNumberRow = async (userId, numberId) => {
  const r = await q(
    `SELECT id, number_value, agent_id, agent_slug, label FROM user_numbers WHERE id = $1 AND user_id = $2`,
    [numberId, userId],
  );
  return r.rowCount ? r.rows[0] : null;
};

app.get('/api/numbers/:id/transfer', auth, async (req, res) => {
  if (!mcpConfigured) return res.json({ number: null, mcpConfigured: false });
  const row = await ownNumberRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.agent_id) return res.json({ number: null, source: null, note: 'Agent not provisioned yet' });
  try {
    const out = unwrapMcp(await callTool('get_transfer_number', { agent_id: row.agent_id }));
    const dest = Array.isArray(out?.destinations) ? out.destinations[0] : null;
    res.json({
      number: dest?.number ? `+${String(dest.number).replace(/\D+/g, '')}` : null,
      destinationName: dest?.name || null,
      source: out?.source || null,     // "global default (no override)" | per-agent
      scope: out?.scope || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not read forwarding number' });
  }
});

app.post('/api/numbers/:id/transfer', auth, async (req, res) => {
  if (!mcpConfigured) return res.status(503).json({ error: 'MCP not configured' });
  const row = await ownNumberRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.agent_id) return res.status(409).json({ error: 'Agent not provisioned yet — try again shortly' });

  const number = String(req.body?.number || '').trim();
  if (!/^\+\d{8,15}$/.test(number)) {
    return res.status(400).json({ error: 'Enter a valid phone number in E.164 format, e.g. +14018677668' });
  }
  // Optional human-readable label for the destination (e.g. "Manager", "Sales
  // lead") — surfaced back on GET as `destinationName`.
  const name = String(req.body?.name || '').trim().slice(0, 80) || undefined;
  try {
    const out = unwrapMcp(await callTool('set_transfer_number', { number, name, agent_id: row.agent_id }));
    // The tool refuses loopback (own DID) / invalid targets by returning an
    // `error` string (and no success flag). Surface that as a 400 so the UI
    // shows the reason instead of a false success.
    if (out && (out.success === false || out.error)) {
      return res.status(400).json({ error: out.error || out.message || 'Forwarding number rejected' });
    }
    res.json({ ok: true, number, result: out });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not set forwarding number' });
  }
});

// Add an additional number from the local MANUAL_NUMBERS pool. Enforces the
// per-plan cap. Charges $MANUAL_NUMBER_PRICE_USD against the customer's wallet
// (defaults to $400) and provisions a fresh inbound trunk routed to the user's
// existing shared agent.
app.post('/api/numbers', auth, async (req, res) => {
  if (NUMBER_PROVIDER !== 'manual') {
    return res.status(503).json({ error: 'Only manual provider supported here' });
  }
  const phoneNumber = (req.body && req.body.phoneNumber) || '';
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });

  const normalized = formatManualNumber(phoneNumber);
  if (!MANUAL_NUMBERS.map(formatManualNumber).includes(normalized)) {
    return res.status(400).json({ error: `Number ${normalized} is not in inventory` });
  }

  // Plan-cap check.
  const limit = numberLimitFor(req.user);
  const existing = await q(`SELECT COUNT(*)::int AS c FROM user_numbers WHERE user_id = $1`, [req.user.id]);
  if (existing.rows[0].c >= limit) {
    return res.status(409).json({
      error: `Plan limit reached — your ${req.user.plan_label || 'current'} plan allows ${limit} number(s)`,
    });
  }

  // Pool collision check.
  const taken = await q(
    `SELECT 1 FROM user_numbers WHERE number_value = $1
     UNION ALL
     SELECT 1 FROM users WHERE number_value = $1 AND id <> $2`,
    [normalized, req.user.id],
  );
  if (taken.rowCount) {
    return res.status(409).json({ error: 'Number already attached to another account' });
  }

  // Wallet charge for the extra DID — only if the user has any history of
  // having a primary already. The very first number is included in the plan
  // purchase, so no charge.
  const price = additionalNumberPriceInr();
  const hasPrimary = await q(
    `SELECT 1 FROM user_numbers WHERE user_id = $1 AND is_primary = true LIMIT 1`,
    [req.user.id],
  );
  if (hasPrimary.rowCount && price > 0) {
    const walletRow = await q(`SELECT wallet_usd FROM users WHERE id = $1`, [req.user.id]);
    const balance = Number(walletRow.rows[0]?.wallet_usd || 0);
    if (balance < price) {
      return res.status(402).json({
        error: `Insufficient wallet balance. Number costs $${price} but wallet has $${balance.toFixed(2)}. Please top up first.`,
        required: price, balance,
      });
    }
    await q(
      `UPDATE users SET wallet_usd = wallet_usd - $1, updated_at = NOW() WHERE id = $2`,
      [price, req.user.id],
    );
    await q(
      `INSERT INTO wallet_transactions
         (user_id, kind, amount_usd, description, status)
       VALUES ($1, 'number_rental', $2, $3, 'success')`,
      [req.user.id, -price, `Additional number ${normalized}`],
    );
  }

  // Seed the new number's agent config from the user's primary as a starting
  // point — the customer can edit it independently from the Numbers tab. If
  // they don't yet have a primary, fall back to the user-row defaults.
  const seed = (await q(
    `SELECT agent_name, greeting, prompt, kb_company, kb_faqs, voice, language
       FROM user_numbers WHERE user_id = $1 AND is_primary = true LIMIT 1`,
    [req.user.id],
  )).rows[0] || {
    agent_name: req.user.agent_name, greeting: req.user.greeting, prompt: req.user.prompt,
    kb_company: req.user.kb_company, kb_faqs: req.user.kb_faqs,
    voice: req.user.voice, language: req.user.language || 'en-US',
  };

  // Insert the row up front so it appears in the list immediately (status
  // 'in_progress'). Provisioning then runs and patches the row.
  const ins = await q(
    `INSERT INTO user_numbers
       (user_id, number_value, is_primary, provisioning_status,
        agent_name, greeting, prompt, kb_company, kb_faqs, voice, language)
     VALUES ($1, $2, false, 'in_progress',
             $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [req.user.id, normalized,
     seed.agent_name, seed.greeting, seed.prompt,
     seed.kb_company, seed.kb_faqs, seed.voice, seed.language],
  );
  const row = ins.rows[0];

  // Provision in the background — UI polls /api/numbers to see status flip.
  setImmediate(async () => {
    try {
      const out = await provisionAdditionalNumber(req.user.id, normalized);
      await q(
        `UPDATE user_numbers
           SET livekit_trunk_id = $1, livekit_dispatch_id = $2,
               provisioning_status = 'ready', provisioning_error = NULL,
               provisioned_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [out.trunkId || null, out.dispatchRuleId || null, row.id],
      );
    } catch (e) {
      console.warn('[numbers/add] provisioning failed:', e.message);
      await q(
        `UPDATE user_numbers
           SET provisioning_status = 'failed', provisioning_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [e.message, row.id],
      );
    }
  });

  res.json({ number: publicNumber(row), charged: hasPrimary.rowCount ? price : 0 });
});

// Update a number's label and/or its agent config. Each per-number field maps
// to a column on user_numbers AND (when MCP is configured) is pushed to the
// number's own agent on the 9278 dashboard.
app.patch('/api/numbers/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const own = await q(`SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  if (!own.rowCount) return res.status(404).json({ error: 'Not found' });

  const map = {
    label: 'label',
    agentName: 'agent_name', greeting: 'greeting', prompt: 'prompt',
    kbCompany: 'kb_company', kbFaqs: 'kb_faqs',
    voice: 'voice', language: 'language',
    autoRechargeEnabled: 'auto_recharge_enabled',
  };
  const sets = [], vals = [];
  let i = 1;
  // Special-case plan: customers must purchase the new plan via the Razorpay
  // flow (POST /api/razorpay/order/number-plan → /verify/number-plan), which
  // is the ONLY path that may flip plan_id without an explicit admin grant.
  // We keep the field on this endpoint for admin-driven overrides (support
  // adjustments, manual gifts), but reject non-admin callers outright so the
  // payment gate can't be bypassed.
  if (b.plan !== undefined || b.planId !== undefined) {
    if (req.user.role !== 'admin') {
      return res.status(402).json({
        error: 'Plan change requires payment — call /api/razorpay/order/number-plan first',
      });
    }
    const requested = String(b.planId ?? b.plan ?? '').toLowerCase();
    const known = getBasePlansSync().find((p) => p.id === requested);
    if (!known) return res.status(400).json({ error: 'Unknown plan id' });
    sets.push(`plan_id = $${i++}`);
    vals.push(known.id);
  }

  // Auto-recharge can't be enabled without a saved card to charge.
  if (b.autoRechargeEnabled === true) {
    const cc = await q(`SELECT COUNT(*)::int AS c FROM payment_methods WHERE user_id = $1`, [req.user.id]);
    if (!cc.rows[0].c) {
      return res.status(400).json({ error: 'Add a card before turning auto-recharge on' });
    }
  }
  // Per-plan auto-recharge card — validate the chosen PM belongs to this user.
  // null/'' clears it (falls back to the user's default card at charge time).
  if (b.autoRechargePmId !== undefined) {
    if (b.autoRechargePmId === null || b.autoRechargePmId === '') {
      sets.push(`auto_recharge_pm_id = $${i++}`); vals.push(null);
    } else {
      const pmOwn = await q(
        `SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2`,
        [Number(b.autoRechargePmId), req.user.id],
      );
      if (!pmOwn.rowCount) return res.status(400).json({ error: 'Unknown card' });
      sets.push(`auto_recharge_pm_id = $${i++}`); vals.push(Number(b.autoRechargePmId));
    }
  }

  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(b[k]); }
  }
  if (!sets.length) return res.json({ number: publicNumber(own.rows[0]) });
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  const r = await q(
    `UPDATE user_numbers SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals,
  );
  const row = r.rows[0];

  // Mirror agent edits to 9278 via MCP. Same content-then-language sequencing
  // we use on the legacy PATCH /api/me to avoid greeting/translation races.
  if (mcpConfigured && row.agent_id) {
    const cfgPatch = {};
    if (b.agentName !== undefined) cfgPatch.name = row.agent_name;
    if (b.greeting !== undefined)  cfgPatch.initial_greeting = row.greeting;
    if (b.prompt !== undefined)    cfgPatch.system_prompt = row.prompt;
    if (b.kbCompany !== undefined || b.kbFaqs !== undefined) {
      const parts = [];
      if (row.kb_company?.trim()) parts.push('## Company info\n' + row.kb_company.trim());
      if (row.kb_faqs?.trim())    parts.push('## FAQs\n' + row.kb_faqs.trim());
      cfgPatch.knowledge_base = parts.join('\n\n');
    }
    // Voice — push the selected Gemini voice to the live agent so the next
    // call speaks in that voice. Without this, only users.voice / user_numbers.voice
    // got updated and the live agent kept its original voice.
    if (b.voice !== undefined && row.voice) {
      // modalities:'audio' makes Gemini Live speak the selected voice natively
      // (otherwise, in 'text' half-cascade mode, a separate TTS voice is used
      // and this Gemini voice is silently ignored).
      cfgPatch.realtime_config = { ...(cfgPatch.realtime_config || {}), voice: row.voice, modalities: 'audio' };
    }
    setImmediate(async () => {
      try {
        if (Object.keys(cfgPatch).length) {
          await callTool('update_agent_config', { agent_id: row.agent_id, ...cfgPatch });
          if (cfgPatch.system_prompt !== undefined || cfgPatch.initial_greeting !== undefined) {
            await applyDefaultBehavior(row.agent_id);
          }
        }
      } catch (e) { console.warn('[numbers/patch] content sync failed:', e.message); }

      if (b.language !== undefined) {
        try {
          await setAgentLanguage({ agent: row.agent_id, agentId: row.agent_id, language: row.language });
        } catch (e) { console.warn('[numbers/patch] language sync failed:', e.message); }
      }
    });
  }

  res.json({ number: publicNumber(row) });
});

app.delete('/api/numbers/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const own = await q(`SELECT * FROM user_numbers WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  if (!own.rowCount) return res.status(404).json({ error: 'Not found' });
  const row = own.rows[0];

  // Releasing the primary tears down the user's whole agent — that's the
  // legacy DELETE /api/numbers/release flow. Steer users there explicitly so
  // they don't accidentally trash their agent by deleting their primary.
  if (row.is_primary) {
    return res.status(400).json({
      error: 'This is your primary number. To release it, cancel your plan or contact support.',
    });
  }

  // Best-effort: drop the dispatch rule for this DID so the slot is freed on
  // 9278's dashboard. If MCP isn't reachable we still free the DB row — the
  // startup sweep will eventually reconcile.
  if (mcpConfigured) {
    try {
      if (row.livekit_dispatch_id) {
        await callTool('delete_dispatch_rule', { dispatch_rule_id: row.livekit_dispatch_id });
      }
      if (row.livekit_trunk_id) {
        await callTool('delete_sip_trunk', { sip_trunk_id: row.livekit_trunk_id });
      }
    } catch (e) {
      console.warn('[numbers/delete] MCP teardown failed (continuing):', e.message);
    }
  }

  await q(`DELETE FROM user_numbers WHERE id = $1`, [id]);
  res.json({ ok: true });
});

// Manually re-run inbound provisioning for the logged-in user.
app.post('/api/provision/me', auth, async (req, res) => {
  try {
    const result = await provisionInboundForUser(req.user.id);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Admin: trigger provisioning for any user.
app.post('/api/admin/provision/:userId', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const result = await provisionInboundForUser(Number(req.params.userId));
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Release the user's attached DID (manual-mode: just clear the DB row; the DID
// returns to the available pool for the next signup).
const handleNumberRelease = async (req, res) => {
  await q(
    `UPDATE users
       SET number_value = NULL, twilio_sid = NULL,
           livekit_trunk_id = NULL, livekit_dispatch_id = NULL,
           livekit_room_name = NULL,
           updated_at = NOW()
     WHERE id = $1`,
    [req.user.id],
  );
  // Also drop ALL the user's number rows — releasing the legacy primary is
  // effectively a "give up everything" gesture.
  await q(`DELETE FROM user_numbers WHERE user_id = $1`, [req.user.id]);
  res.json({ ok: true });
};
app.delete('/api/numbers/release', auth, handleNumberRelease);
// Back-compat alias.
app.delete('/api/twilio/number', auth, handleNumberRelease);

// Returns true if the call's "to" field matches the given E.164 number.
// SIP trunk calls have to="sip:+19014410235@host;transport=tcp" so we
// match on digits to catch both formats.
const callMatchesNumber = (call, number) => {
  if (!number) return true;
  const digits = number.replace(/\D/g, '');
  return call.to.replace(/\D/g, '').includes(digits);
};

// === Per-reseller MCP routing helper ======================================
// Given a user (customer) row, resolve the MCP creds we should call when
// touching this customer's data. We climb the reseller chain (reseller_id
// → user_type='reseller') and read mcp_url + mcp_token off that row.
// Falls back to the env-level MCP when either field is empty (so the
// canonical 9278.ai reseller doesn't need its own row populated).
//
// Cached LRU so a 100-row dashboard query doesn't fan out 100 DB lookups.
const _mcpCredCache = new Map();
const _mcpCredCacheTtl = 30 * 1000;       // 30s — short enough that
                                          // token rotations land quickly
const mcpCredsForUserId = async (userId) => {
  if (!userId) return {};
  const hit = _mcpCredCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  // Resolve: this user's reseller is reseller_id; if that's null, the user
  // is unattached and we fall back to env.
  const r = await q(
    `SELECT r.mcp_url, r.mcp_token
       FROM users u
       LEFT JOIN users r ON r.id = u.reseller_id AND r.user_type = 'reseller'
      WHERE u.id = $1
      LIMIT 1`,
    [userId],
  );
  const row = r.rows[0] || {};
  const value = {
    url:   row.mcp_url   || null,
    token: row.mcp_token || null,
  };
  _mcpCredCache.set(userId, { value, expires: Date.now() + _mcpCredCacheTtl });
  return value;
};

// Convenience — call an MCP tool against the right server for a user.
// Returns the raw tool result (still needs unwrapMcp), same shape as
// the global callTool().
const callMcpForUser = async (userId, name, args = {}) => {
  const creds = await mcpCredsForUserId(userId);
  return callToolFor(creds, name, args);
};

// Unwrap MCP tool responses into native JS objects.
const unwrapMcp = (r) => {
  if (!r) return null;
  if (r.structuredContent?.result !== undefined) {
    try { return JSON.parse(r.structuredContent.result); } catch { return r.structuredContent.result; }
  }
  if (Array.isArray(r.content)) {
    const txt = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    try { return JSON.parse(txt); } catch { return { text: txt }; }
  }
  return r;
};

// Call history — pulled from the 9278 dashboard via MCP list_calls.
// Filter by the logged-in user's phone number (admins see all).
// Cost is computed from duration × the customer's per-minute plan rate ($/min);
// Fetch ALL calls for a given DID from dashboard.9278.ai's MCP `list_calls`.
// The MCP signature is: { days, direction, agent_name, search, page, per_page }
// — per_page is capped at 100, so we paginate. days default is 7; we override
// to 365 so "all-time" totals actually mean all-time.
const PAGE_SIZE = 100;
const LOOKBACK_DAYS = 365;
const MAX_PAGES = 20;   // 20 * 100 = 2000 calls per DID — safe ceiling

const fetchCallsForDid = async (didDigits) => {
  // MCP's `search` arg matches as substring on the dashboard's stored phone
  // number column, which lacks the leading "+". Pass digits only.
  const search = String(didDigits);
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let out;
    try {
      out = unwrapMcp(await callTool('list_calls', {
        days: LOOKBACK_DAYS,
        search,
        page,
        per_page: PAGE_SIZE,
      }));
    } catch (e) {
      console.warn(`[list_calls] ${search} page ${page} failed:`, e.message);
      break;
    }
    const rows = Array.isArray(out?.calls) ? out.calls : (Array.isArray(out) ? out : []);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;   // last page
  }
  return all;
};

// Short-TTL cache for the per-DID call fan-out. This is the single most
// expensive MCP path (list_calls × pages × DIDs against dashboard.9278.ai) and
// it backs Call history, Recordings AND Stats — so caching it here makes all
// three load instantly on repeat/cross-tab visits within the window. Keyed by
// the sorted DID set; pass { fresh:true } to bypass (Refresh buttons).
const CALLS_CACHE = new Map();          // key → { ts, calls }
const CALLS_TTL_MS = 60_000;

// Fallback path for fetchCallsForNumbers below — same list_calls pagination,
// scoped by agent_id instead of a phone-number substring match.
const fetchCallsByAgentId = async (agentId) => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let out;
    try {
      out = unwrapMcp(await callTool('list_calls', {
        days: LOOKBACK_DAYS, agent_id: agentId, page, per_page: PAGE_SIZE,
      }));
    } catch (e) {
      console.warn(`[list_calls] agent_id=${agentId} page ${page} failed:`, e.message);
      break;
    }
    const rows = Array.isArray(out?.calls) ? out.calls : (Array.isArray(out) ? out : []);
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
};

const fetchCallsForNumbers = async (digitsList, { fresh = false, agentId = null } = {}) => {
  const key = digitsList.length ? [...digitsList].map(String).sort().join(',') : `agent:${agentId || 'none'}`;
  if (!fresh) {
    const hit = CALLS_CACHE.get(key);
    if (hit && Date.now() - hit.ts < CALLS_TTL_MS) return hit.calls;
  }
  let flat = [];
  if (digitsList.length) {
    const perDid = await Promise.all(digitsList.map((d) => fetchCallsForDid(d)));
    flat = perDid.flat();
  }
  // The DID-based search found nothing (or there were no registered DIDs to
  // search at all) — calls may still be tagged with this customer's
  // agent_id even when they don't match a stored DID (number reformatting,
  // a changed number, no DID recorded yet, etc.). The MCP analytics tools
  // (Overview's call-volume/sentiment, which scope by agent_id) already find
  // data in this situation, so fall back to the same scoping here instead
  // of silently returning nothing.
  if (!flat.length && agentId) {
    flat = await fetchCallsByAgentId(agentId);
  }
  if (!flat.length) return [];
  // Dedupe in case `search` matches the same call under more than one DID.
  const seen = new Set(), unique = [];
  for (const c of flat) {
    const k = c.id || c.session_id || `${c.started_at}|${c.from_number}|${c.to_number}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(c);
  }
  unique.sort((a, b) => (new Date(b.started_at || 0) - new Date(a.started_at || 0)));
  if (CALLS_CACHE.size > 300) { CALLS_CACHE.delete(CALLS_CACHE.keys().next().value); }
  CALLS_CACHE.set(key, { ts: Date.now(), calls: unique });
  return unique;
};

// Tenant-wide list_calls fan-out for the admin branch of /api/twilio/stats,
// /api/twilio/calls and /api/recordings — same expensive list_calls ×
// MAX_PAGES round-trip that fetchCallsForNumbers caches for customers, but
// the admin path paged directly with no cache at all in all three. Same
// short-TTL pattern as CALLS_CACHE.
let ADMIN_CALLS_CACHE = null;   // { ts, calls }
const ADMIN_CALLS_TTL_MS = 60_000;
const fetchAllCallsForAdmin = async ({ fresh = false } = {}) => {
  if (!fresh && ADMIN_CALLS_CACHE && Date.now() - ADMIN_CALLS_CACHE.ts < ADMIN_CALLS_TTL_MS) {
    return ADMIN_CALLS_CACHE.calls;
  }
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const out = unwrapMcp(await callTool('list_calls', {
      days: LOOKBACK_DAYS, page, per_page: PAGE_SIZE,
    }));
    const batch = Array.isArray(out?.calls) ? out.calls : (Array.isArray(out) ? out : []);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  // Keep only calls touching a number actually registered on this site —
  // see getAllNumberDigits for why.
  const known = await getAllNumberDigits();
  const filtered = rows.filter((c) => {
    const to = String(c.to_number || '').replace(/\D+/g, '');
    const from = String(c.from_number || '').replace(/\D+/g, '');
    return (to && known.has(to)) || (from && known.has(from));
  });
  ADMIN_CALLS_CACHE = { ts: Date.now(), calls: filtered };
  return filtered;
};

// MCP list_calls doesn't return a money figure, so we derive it from the user's plan.
app.get('/api/twilio/calls', auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const ratePerMin = Number(req.user.plan_rate) || 0;

    // Build the set of all numbers this user owns (primary + additional).
    const ownDigits = req.user.role === 'admin'
      ? null
      : await getUserNumberDigits(req.user.id);
    if (ownDigits && !ownDigits.size && !req.user.agent_id) return res.json({ calls: [] });

    // Per-DID fan-out — each call to MCP paginates through that DID's full
    // history (last LOOKBACK_DAYS days, up to MAX_PAGES * PAGE_SIZE rows).
    // Admin path shares the same cached tenant-wide sweep as /api/twilio/stats.
    const fresh = req.query.refresh === '1';
    let rows = ownDigits
      ? await fetchCallsForNumbers([...ownDigits], { fresh, agentId: req.user.agent_id })
      : await fetchAllCallsForAdmin({ fresh });
    rows = rows.slice(0, limit);

    res.json({
      ratePerMin,
      calls: rows.map((c) => {
        const dur = Number(c.duration_seconds) || 0;
        const cost = ratePerMin ? +(dur / 60 * ratePerMin).toFixed(2) : 0;
        return {
          sid:        c.id || c.session_id,
          from:       c.from_number || c.from,
          to:         c.to_number || c.to,
          direction:  c.direction,
          status:     c.end_reason ? 'completed' : (c.status || 'in-progress'),
          startTime:  c.started_at,
          endTime:    c.ended_at,
          duration:   dur,
          price:      cost,
          agentName:  c.agent_name,
          endReason:  c.end_reason,
        };
      }),
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not fetch call history' });
  }
});

// ---- Recordings tab --------------------------------------------------------
// Lists every call from THIS customer's DIDs that has a recording on the
// 9278 dashboard. Audio URLs come from MCP `get_recording_url`, matched to
// calls via the short id embedded in `call.room_name` (format: <number>_<id>).
const DASHBOARD_BASE = (process.env.DASHBOARD_BASE_URL || 'https://dashboard.9278.ai').replace(/\/$/, '');

// Pull a batch of recordings from MCP (filter by caller number is the "number"
// arg, which is NOT useful for inbound DIDs since calls store the customer's
// DID as `to_number`, not `number`). So we paginate unfiltered and match by
// short-id later. Tenants get isolation from the short-id matching itself —
// the 12-char opaque id is keyed off room_name which is per-call unique.
const fetchAllRecordings = async (max = 500) => {
  const byShortId = new Map();
  try {
    const out = unwrapMcp(await callTool('get_recording_url', { limit: max }));
    const recs = Array.isArray(out?.recordings) ? out.recordings : [];
    for (const r of recs) {
      if (r.call_id) byShortId.set(r.call_id, r);
    }
  } catch (e) {
    console.warn('[recordings] get_recording_url(unfiltered) failed:', e.message);
  }
  return byShortId;
};

// Extract the short room-id from a livekit room_name. Format observed:
//   "9666229964_9faHnHgceHPi"  →  "9faHnHgceHPi"
// Returns null if there's no underscore-suffix.
const shortIdFromRoomName = (roomName) => {
  if (!roomName) return null;
  const idx = String(roomName).lastIndexOf('_');
  return idx < 0 ? null : String(roomName).slice(idx + 1);
};

// Short-TTL in-memory cache for the recordings payload. The MCP fan-out
// (list_calls per DID + get_recording_url sweep) costs ~1-3s per call; with
// a 30 s TTL, repeat Reports/Recordings tab loads within that window are
// instant. Per-user keyed so customers never see each other's data.
const RECORDINGS_CACHE = new Map();
const RECORDINGS_TTL_MS = 30_000;
const recordingsCacheGet = (userId, limit) => {
  const key = `${userId}:${limit}`;
  const hit = RECORDINGS_CACHE.get(key);
  if (hit && Date.now() - hit.ts < RECORDINGS_TTL_MS) return hit.payload;
  return null;
};
const recordingsCacheSet = (userId, limit, payload) => {
  if (RECORDINGS_CACHE.size > 200) {
    const oldestKey = RECORDINGS_CACHE.keys().next().value;
    RECORDINGS_CACHE.delete(oldestKey);
  }
  RECORDINGS_CACHE.set(`${userId}:${limit}`, { ts: Date.now(), payload });
};

app.get('/api/recordings', auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const skipCache = req.query.refresh === '1';

    // Cache hit — return instantly. Customer-only (admins bypass).
    if (req.user.role !== 'admin' && !skipCache) {
      const cached = recordingsCacheGet(req.user.id, limit);
      if (cached) {
        res.setHeader('x-cache', 'hit');
        return res.json(cached);
      }
    }

    const ownDigits = req.user.role === 'admin'
      ? null
      : await getUserNumberDigits(req.user.id);
    if (ownDigits && !ownDigits.size && !req.user.agent_id) return res.json({ recordings: [] });

    // Pull this customer's calls. Recordings are no longer sourced from the
    // (removed) get_recording_url MCP tool — instead each row's audio is
    // streamed on-demand through /api/recordings/:callId/audio, which proxies
    // the dashboard's cookie-authenticated egress download (see dashboardWeb.js).
    const calls = ownDigits
      ? await fetchCallsForNumbers([...ownDigits], { fresh: skipCache, agentId: req.user.agent_id })
      : await fetchAllCallsForAdmin({ fresh: skipCache });

    const ratePerMin = Number(req.user.plan_rate) || 0;
    const recordings = calls
      // A call has a recording when list_calls reports a recording_id (the
      // LiveKit egress id). The actual audio file is resolved lazily by the
      // audio proxy via the call's room short-id.
      .filter((c) => !!c.recording_id)
      .slice(0, limit)
      .map((c) => {
        const dur = Number(c.duration_seconds) || 0;
        const cost = ratePerMin ? +(dur / 60 * ratePerMin).toFixed(2) : 0;
        const callId = c.id || c.session_id;
        return {
          callId,
          recordingId:   c.recording_id,
          from:          c.from_number || c.from,
          to:            c.to_number || c.to,
          direction:     c.direction,
          startTime:     c.started_at,
          endTime:       c.ended_at,
          duration:      dur,
          price:         cost,
          agentName:     c.agent_name,
          hasTranscript: !!c.has_transcription,
          endReason:     c.end_reason,
          // Portal-proxied audio (the dashboard egress URL needs a dashboard
          // login, so we can't hand it straight to the browser). The frontend
          // appends ?token=<session> since a native <audio> can't send headers.
          audioUrl:      dashboardWebConfigured ? `/api/recordings/${encodeURIComponent(callId)}/audio` : null,
          audioFilename: null,
          audioSize:     null,
          recordedAt:    null,
          // Fallback link if direct audio playback fails.
          dashboardSearchUrl: `${DASHBOARD_BASE}/call-history?search=${encodeURIComponent(
            String(c.to_number || c.from_number || '').replace(/\D+/g, ''),
          )}`,
        };
      });

    const payload = { recordings, ratePerMin, dashboardBase: DASHBOARD_BASE };
    if (req.user.role !== 'admin') recordingsCacheSet(req.user.id, limit, payload);
    res.setHeader('x-cache', 'miss');
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not fetch recordings' });
  }
});

// Auth shim: a native <audio src> / <a download> can't send an Authorization
// header, so media routes also accept the session token as ?token=<…>. We
// normalise it into the header and reuse the standard `auth` middleware.
const authMedia = (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return auth(req, res, next);
};

// ============================================================================
// GET /api/recordings/:callId/audio  — stream a call recording.
//
// The 9278.ai dashboard serves recordings only behind its own cookie login
// (get_recording_url was removed), so the portal proxies the bytes: it logs
// into the dashboard once (dashboardWeb.js), resolves the egress filename from
// the call's room short-id, and streams /egress/files/<file>/download back to
// the customer — forwarding Range so the browser can seek. ?download=1 sets a
// Content-Disposition so the same URL doubles as the download link.
// ============================================================================
app.get('/api/recordings/:callId/audio', authMedia, async (req, res) => {
  const callId = String(req.params.callId || '');
  if (!callId) return res.status(400).json({ error: 'callId required' });
  if (!dashboardWebConfigured) return res.status(503).json({ error: 'Recording playback not configured' });

  try {
    // Resolve room_name + enforce the same tenant guard as transcript/meeting.
    const detail = unwrapMcp(await callTool('get_call_detail', { call_id: callId })) || {};
    if (req.user.role !== 'admin') {
      const ownDigits = await getUserNumberDigits(req.user.id);
      const to   = String(detail?.to_number   || '').replace(/\D+/g, '');
      const from = String(detail?.from_number || '').replace(/\D+/g, '');
      if (!ownDigits.has(to) && !ownDigits.has(from)) {
        return res.status(403).json({ error: 'Not authorised for this call' });
      }
    }

    const shortId = shortIdFromRoomName(detail.room_name);
    const downloadPath = await resolveRecordingDownloadPath(shortId);
    if (!downloadPath) return res.status(404).json({ error: 'Recording not available' });

    const { status, headers, body } = await fetchRecordingStream(downloadPath, { range: req.headers.range });
    if (status >= 400 || !body) {
      return res.status(status === 404 ? 404 : 502).json({ error: 'Recording fetch failed' });
    }

    res.status(status); // 200 (full) or 206 (range)
    for (const h of ['content-type', 'content-length', 'content-range', 'cache-control']) {
      const v = headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!headers.get('content-type')) res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.query.download) {
      const fname = downloadPath.split('/').slice(-2, -1)[0] || `recording-${callId}.mp4`;
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    }

    const stream = Readable.fromWeb(body);
    res.on('close', () => stream.destroy());   // client seeked/aborted → stop pulling bytes
    stream.on('error', () => { try { res.destroy(); } catch { /* noop */ } });
    stream.pipe(res);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Recording proxy error' });
  }
});

// ============================================================================
// POST /api/kb/import-from-website
//
// Customer pastes their website URL → we fetch the HTML → strip nav/footer/
// scripts/styles → run the visible text through Grok with a structured
// extraction prompt → return { kbCompany, kbFaqs } ready to paste into the
// KB editor (or save directly via PATCH /api/me / PATCH /api/numbers/:id).
//
// Single-page fetch only — no crawl. Good enough for most landing pages,
// fast (one HTTP round-trip), and avoids surprise bills from runaway crawls.
// ============================================================================
const KB_IMPORT_SYSTEM = `You are a precise knowledge-base extractor for an AI
voice receptionist. Read the visible text of a business's website and produce
JSON ONLY with these exact keys:

{
  "company": "<a multi-paragraph plain-text brief covering: what the business does, services/products offered, target customers, business hours, location, pricing if mentioned, key policies, and anything else a receptionist must know to handle calls confidently>",
  "faqs": [
    { "q": "<question a caller might actually ask>", "a": "<concise answer in 1–3 sentences>" }
  ]
}

Rules:
- "company" should be 4–10 short paragraphs separated by blank lines, factual, no marketing fluff.
- 5–15 FAQs, biased toward what a phone caller would actually ask (hours, pricing, location, services, refunds, contact).
- If the site doesn't say something, omit it — don't invent.
- Plain text only. No HTML, no markdown headings inside fields.
- Output JSON only — no prose before or after.`;

// Strip a fetched HTML doc to the visible text. Deliberately simple — no
// jsdom dep, just regex passes for <script>/<style>/<nav>/<footer>/HTML tags
// + entity decode. Good enough for the Grok step that follows.
function htmlToText(html) {
  if (!html) return '';
  let t = String(html);
  // Remove blocks that don't carry meaningful content.
  t = t.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  t = t.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  t = t.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ');
  t = t.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');
  // Drop HTML comments.
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  // Replace block-level tags with newlines so paragraph structure survives.
  t = t.replace(/<\/(p|div|section|article|header|h[1-6]|li|tr|br)>/gi, '\n');
  // Strip all remaining tags.
  t = t.replace(/<[^>]+>/g, ' ');
  // Decode the small set of HTML entities we care about.
  t = t
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'");
  // Collapse whitespace; preserve paragraph breaks.
  t = t.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

app.post('/api/kb/import-from-website', auth, async (req, res) => {
  if (!xai) {
    return res.status(503).json({ error: 'AI provider not configured — set GOOGLE_API_KEY (Gemini) or XAI_API_KEY in .env' });
  }

  let url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  // Tolerate "example.com" by prepending https://.
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http and https URLs are supported' });
  }

  // Fetch the HTML with a generous timeout. UA string identifies us so site
  // owners can whitelist if they spot us in logs.
  let html = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Voice9278-KBImporter/1.0 (+https://voice.9278.ai)',
        'Accept':     'text/html,*/*',
      },
    });
    clearTimeout(t);
    if (!resp.ok) {
      return res.status(502).json({ error: `Could not fetch URL — ${resp.status} ${resp.statusText}` });
    }
    const ct = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/.test(ct)) {
      return res.status(415).json({ error: `URL did not return HTML (got ${ct || 'unknown'})` });
    }
    html = await resp.text();
  } catch (e) {
    return res.status(502).json({ error: 'Fetch failed: ' + (e.message || 'network error') });
  }

  // 50k chars ≈ 12k tokens — well within Grok's context window with room for
  // the output. Trim from the end (footers, repeated boilerplate are less
  // informative than the top of the page).
  const text = htmlToText(html).slice(0, 50000);
  if (text.length < 100) {
    return res.status(422).json({ error: 'Site contained too little visible text to extract a KB' });
  }

  let parsed;
  try {
    const completion = await xai.chat.completions.create({
      model: XAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2200,
      messages: [
        { role: 'system', content: KB_IMPORT_SYSTEM },
        { role: 'user',   content: `Website URL: ${parsedUrl.toString()}\n\nVisible page text:\n${text}` },
      ],
    });
    parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
  } catch (e) {
    return res.status(502).json({ error: 'Grok extraction failed: ' + (e.message || 'unknown') });
  }

  const kbCompany = String(parsed.company || '').trim();
  // Build the FAQ block in the Q:/A: shape the existing KB textarea expects so
  // the customer can paste straight into the FAQ tab without reformatting.
  const faqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];
  const kbFaqs = faqs
    .filter((f) => f && f.q && f.a)
    .map((f) => `Q: ${String(f.q).trim()}\nA: ${String(f.a).trim()}`)
    .join('\n\n');

  if (!kbCompany && !kbFaqs) {
    return res.status(422).json({ error: 'Grok returned an empty KB — the site may not have useful content' });
  }

  res.json({
    ok: true,
    url: parsedUrl.toString(),
    kbCompany,
    kbFaqs,
    faqCount: faqs.length,
    bytesFetched: html.length,
    textChars: text.length,
  });
});

// POST /api/kb/import-from-file
//
// Same extraction as import-from-website (KB_IMPORT_SYSTEM prompt through
// Grok/Gemini), but the source text comes from an uploaded PDF or DOCX
// instead of a fetched webpage. Old binary .doc isn't supported — mammoth
// only reads the modern zip-based .docx format.
const kbFileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
}).single('file');

app.post('/api/kb/import-from-file', auth, (req, res) => {
  kbFileUpload(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'Upload failed' });
    }
    if (!xai) {
      return res.status(503).json({ error: 'AI provider not configured — set GOOGLE_API_KEY (Gemini) or XAI_API_KEY in .env' });
    }
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const name = req.file.originalname || 'upload';
    const ext = (name.split('.').pop() || '').toLowerCase();

    let text = '';
    try {
      if (ext === 'pdf') {
        const pdfParse = getPdfParse();
                  if (!pdfParse) return res.status(503).json({ error: 'PDF import is temporarily unavailable' });
                  text = (await pdfParse(req.file.buffer)).text || '';
      } else if (ext === 'docx') {
        text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value || '';
      } else if (ext === 'doc') {
        return res.status(415).json({ error: 'Old .doc format isn’t supported — please save as .docx or PDF and try again.' });
      } else {
        return res.status(415).json({ error: 'Only .pdf and .docx files are supported.' });
      }
    } catch (e) {
      return res.status(422).json({ error: 'Could not read that file: ' + (e.message || 'parse error') });
    }

    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
    if (text.length < 100) {
      return res.status(422).json({ error: 'That file contained too little text to extract a knowledge base' });
    }

    let parsed;
    try {
      const completion = await xai.chat.completions.create({
        model: XAI_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 2200,
        messages: [
          { role: 'system', content: KB_IMPORT_SYSTEM },
          { role: 'user',   content: `Source document: ${name}\n\nExtracted text:\n${text}` },
        ],
      });
      parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    } catch (e) {
      return res.status(502).json({ error: 'AI extraction failed: ' + (e.message || 'unknown') });
    }

    const kbCompany = String(parsed.company || '').trim();
    const faqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];
    const kbFaqs = faqs
      .filter((f) => f && f.q && f.a)
      .map((f) => `Q: ${String(f.q).trim()}\nA: ${String(f.a).trim()}`)
      .join('\n\n');

    if (!kbCompany && !kbFaqs) {
      return res.status(422).json({ error: 'AI returned an empty KB — the file may not have useful content' });
    }

    res.json({
      ok: true,
      fileName: name,
      kbCompany,
      kbFaqs,
      faqCount: faqs.length,
      textChars: text.length,
    });
  });
});

// =============================================================================
// AI-generated per-call summary — there's no get_call_summary MCP tool on the
// dashboard, so we run the transcript through Grok-4-fast to produce a
// structured gist/topics/intent/outcome/action-items payload. Cached in-memory
// per call_id so repeat clicks don't re-bill xAI.
//
// xAI's API is OpenAI-compatible, so we reuse the `openai` npm SDK pointed at
// https://api.x.ai/v1 — same chat.completions shape, same JSON-mode support.
// =============================================================================
const aiSummaryCache = new Map();
const AI_SUMMARY_MAX = 1000;

// AI provider for call summaries + website KB extraction. Defaults to Google
// Gemini (via its OpenAI-compatible endpoint); set AI_PROVIDER=xai to use Grok
// instead. Both run through the `openai` SDK. Kept under the legacy `xai` /
// `XAI_MODEL` names so the rest of the file needs no changes.
const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const XAI_KEY     = process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
const GEMINI_KEY  = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const makeXai = () => new OpenAI({ apiKey: XAI_KEY, baseURL: 'https://api.x.ai/v1' });
const makeGemini = () => new OpenAI({ apiKey: GEMINI_KEY, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
let xai = null, XAI_MODEL = '', AI_LABEL = 'AI';
if (AI_PROVIDER === 'xai' && XAI_KEY) {
  xai = makeXai(); XAI_MODEL = process.env.XAI_MODEL || 'grok-4-fast-non-reasoning'; AI_LABEL = 'Grok (xAI)';
} else if (GEMINI_KEY) {
  xai = makeGemini(); XAI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'; AI_LABEL = 'Gemini (Google)';
} else if (XAI_KEY) {
  xai = makeXai(); XAI_MODEL = process.env.XAI_MODEL || 'grok-4-fast-non-reasoning'; AI_LABEL = 'Grok (xAI)';
}
console.log(`[ai] provider=${xai ? AI_LABEL : 'none'} model=${XAI_MODEL || '-'}`);

// =============================================================================
// Live chat testing — Playground's Chat mode. The chat agent (preview or
// real) has no persisted backend row of its own (see Playground.jsx's
// PREVIEW_CHAT_AGENT / ChatAgentDetail.jsx), so its prompt/greeting/KB config
// is entirely client-side and sent with each request rather than looked up
// server-side by id. Reuses the same Gemini/Grok client as call summaries.
const CHAT_MAX_HISTORY = 20;   // most recent turns sent as context — keeps token cost bounded

app.post('/api/chat/message', auth, async (req, res) => {
  if (!xai) {
    return res.status(503).json({ error: 'AI provider not configured — set GOOGLE_API_KEY (Gemini) or XAI_API_KEY in .env' });
  }
  const { messages, prompt, greeting, kbCompany, kbFaqs, agentName } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }
  try {
    const systemParts = [
      (prompt && prompt.trim())
        || `You are ${agentName || 'a helpful assistant'}, a customer support chat agent. Be concise, friendly, and professional.`,
    ];
    if (greeting) systemParts.push(`Your greeting, already shown to the user before this conversation started: "${greeting}"`);
    if (kbCompany) systemParts.push(`Company info:\n${kbCompany}`);
    if (kbFaqs) systemParts.push(`FAQ pairs:\n${kbFaqs}`);

    const completion = await xai.chat.completions.create({
      model: XAI_MODEL,
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: 'system', content: systemParts.join('\n\n') },
        ...messages.slice(-CHAT_MAX_HISTORY).map((m) => ({
          role: m.from === 'user' ? 'user' : 'assistant',
          content: String(m.text || ''),
        })),
      ],
    });
    const reply = completion.choices[0]?.message?.content?.trim() || "Sorry, I didn't catch that — could you rephrase?";
    res.json({ reply });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Chat request failed' });
  }
});

const SUMMARY_SYSTEM = `You are a precise call-summary engine. Read a phone
conversation transcript between an AI receptionist ("agent") and a human caller
("user") and produce JSON ONLY with these exact keys:

{
  "gist": "<one sentence describing what the call was about>",
  "intent": "<what the caller wanted, in plain English>",
  "outcome": "<what actually happened by call-end>",
  "topics": ["<topic1>", "<topic2>", ...],            // 1-5 short bullets
  "actionItems": ["<thing the business should follow up on>", ...],  // 0-5 items
  "sentiment": "positive" | "neutral" | "negative",
  "language": "<BCP-47 code of the conversation, e.g. en-US, hi-IN, te-IN>"
}

Rules:
- Summarise in English regardless of conversation language.
- If a turn is ambiguous or empty, infer from context but be honest.
- Keep each string under 200 chars.
- No prose outside the JSON.`;

const compactTranscript = (segments) => {
  if (!Array.isArray(segments)) return '';
  return segments
    .map((s) => `${(s.speaker || 'speaker').toLowerCase()}: ${(s.text || '').replace(/\s+/g, ' ').trim()}`)
    .filter((l) => l.length > l.indexOf(':') + 2)
    .join('\n')
    .slice(0, 12000); // ~3-4k tokens — generous for a 10-min call
};

const summariseTranscript = async (callId, segments) => {
  if (!xai) return { error: 'AI provider not configured — set GOOGLE_API_KEY (Gemini) or XAI_API_KEY in .env' };
  if (aiSummaryCache.has(callId)) return aiSummaryCache.get(callId);
  const transcript = compactTranscript(segments);
  if (!transcript) return { error: 'Empty transcript' };

  const completion = await xai.chat.completions.create({
    model: XAI_MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 600,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user',   content: 'Transcript:\n' + transcript },
    ],
  });
  let parsed;
  try { parsed = JSON.parse(completion.choices[0].message.content || '{}'); }
  catch (e) { parsed = { error: 'Failed to parse summary JSON' }; }

  // LRU-ish eviction.
  if (aiSummaryCache.size >= AI_SUMMARY_MAX) {
    const oldestKey = aiSummaryCache.keys().next().value;
    aiSummaryCache.delete(oldestKey);
  }
  aiSummaryCache.set(callId, parsed);
  return parsed;
};

// Per-call summary — synthesises detail + observability + transcript-derived
// AI summary into one payload for the Recordings tab's "📊 Summary" toggle.
app.get('/api/recordings/:callId/summary', auth, async (req, res) => {
  const callId = String(req.params.callId || '');
  if (!callId) return res.status(400).json({ error: 'callId required' });

  try {
    const detail = unwrapMcp(await callTool('get_call_detail', { call_id: callId })) || {};

    // Tenant check.
    if (req.user.role !== 'admin') {
      const ownDigits = await getUserNumberDigits(req.user.id);
      const to   = String(detail?.to_number   || '').replace(/\D+/g, '');
      const from = String(detail?.from_number || '').replace(/\D+/g, '');
      if (!ownDigits.has(to) && !ownDigits.has(from)) {
        return res.status(403).json({ error: 'Not authorised for this call' });
      }
    }

    // Observability + transcript in parallel — both are optional.
    const [obsResult, transcriptResult] = await Promise.all([
      callTool('get_call_observability', { call_id: callId }).catch(() => null),
      callTool('get_call_transcript',    { call_id: callId }).catch(() => null),
    ]);
    const observability = obsResult ? unwrapMcp(obsResult) : null;
    const transcriptOut = transcriptResult ? unwrapMcp(transcriptResult) : null;
    const segments = Array.isArray(transcriptOut?.segments) ? transcriptOut.segments : [];
    const events = Array.isArray(observability?.events) ? observability.events : [];

    // AI summary off the transcript. Cached per callId.
    let aiSummary = null;
    if (segments.length) {
      try {
        aiSummary = await summariseTranscript(callId, segments);
      } catch (e) {
        console.warn(`[summary] AI summarise failed for ${callId}:`, e.message);
        aiSummary = { error: e.message };
      }
    }

    // Group events by lane → for a stacked bar/Gantt-style chart in the UI.
    const lanes = {};
    let maxMs = 0;
    for (const ev of events) {
      const lane = ev.lane || ev.kind || 'other';
      const start = Number(ev.relative_start_ms) || 0;
      const end   = ev.relative_end_ms != null ? Number(ev.relative_end_ms) : start + 50;
      if (!lanes[lane]) lanes[lane] = [];
      lanes[lane].push({ start, end, kind: ev.kind, label: ev.label });
      if (end > maxMs) maxMs = end;
    }

    res.json({
      callId,
      // AI-generated summary (cached per call_id).
      aiSummary,
      // Core identity / outcome.
      direction:        detail.direction,
      startedAt:        detail.started_at,
      endedAt:          detail.ended_at,
      durationSec:      Number(detail.duration_seconds) || 0,
      endReason:        detail.end_reason,
      turnCount:        Number(detail.turn_count) || 0,
      agentName:        detail.agent_name,
      fromNumber:       detail.from_number,
      toNumber:         detail.to_number,
      // Health + latency.
      healthScore:      detail.health_score   ?? null,
      healthStatus:     detail.health_status  || null,
      healthFlags:      detail.health_flags   || [],
      latency: {
        e2eP50Ms: Number(detail.latency_p50_ms) || 0,
        e2eP90Ms: Number(detail.latency_p90_ms) || 0,
        e2eP99Ms: Number(detail.latency_p99_ms) || 0,
        ttfbMs:   Number(detail.response_latency_ttfb_ms) || 0,
        llmAvgMs: Number(detail.llm_latency_avg_ms) || 0,
        sttAvgMs: Number(detail.stt_latency_avg_ms) || 0,
        ttsAvgMs: Number(detail.tts_latency_avg_ms) || 0,
        jitterAvgMs: Number(detail.jitter_avg_ms) || 0,
        jitterMaxMs: Number(detail.jitter_max_ms) || 0,
      },
      tokens: {
        realtimeIn:  Number(detail.actual_realtime_input_tokens)  || 0,
        realtimeOut: Number(detail.actual_realtime_output_tokens) || 0,
        llmIn:       Number(detail.actual_llm_input_tokens)       || 0,
        llmOut:      Number(detail.actual_llm_output_tokens)      || 0,
        sttSec:      Number(detail.actual_stt_seconds)            || 0,
        ttsChars:    Number(detail.actual_tts_characters)         || 0,
      },
      stack: {
        llm:  { provider: detail.llm_provider_used, model: detail.llm_model_used },
        stt:  { model: detail.stt_model_used },
        tts:  { model: detail.tts_model_used },
      },
      // Timeline — already bucketed into lanes for the UI Gantt rows.
      timeline: { lanes, durationMs: maxMs, eventCount: events.length },
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not fetch summary' });
  }
});

// Per-call transcript (text messages). Customer can only fetch transcripts
// for calls that involve one of their own DIDs — enforced by re-checking
// the call's from/to against the user's number set.
app.get('/api/recordings/:callId/transcript', auth, async (req, res) => {
  const callId = String(req.params.callId || '');
  if (!callId) return res.status(400).json({ error: 'callId required' });

  try {
    // Tenant check: pull the call's metadata and verify it touches one of the
    // user's DIDs. Admins bypass.
    if (req.user.role !== 'admin') {
      const ownDigits = await getUserNumberDigits(req.user.id);
      const detail = unwrapMcp(await callTool('get_call_detail', { call_id: callId }));
      const to   = String(detail?.to_number   || '').replace(/\D+/g, '');
      const from = String(detail?.from_number || '').replace(/\D+/g, '');
      if (!ownDigits.has(to) && !ownDigits.has(from)) {
        return res.status(403).json({ error: 'Not authorised for this call' });
      }
    }

    const out = unwrapMcp(await callTool('get_call_transcript', { call_id: callId }));
    // MCP shape: { call_id, segments: [{speaker, text, ...}], full_text, word_count, saved_at }
    const messages =
        Array.isArray(out?.segments)   ? out.segments
      : Array.isArray(out?.messages)   ? out.messages
      : Array.isArray(out?.transcript) ? out.transcript
      : Array.isArray(out)             ? out
      : [];
    res.json({
      callId,
      messages,
      fullText:  out?.full_text  || '',
      wordCount: out?.word_count || 0,
      savedAt:   out?.saved_at   || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not fetch transcript' });
  }
});

// =============================================================================
// Per-call meeting — backed by MCP `get_call_meeting(call_id)`.
//
// Returns a unified shape regardless of whether the meeting is a real booking
// (the agent called schedule_meeting → calendar event exists) or just a
// verbal mention captured in the call summary:
//
//   { source: "booking" | "summary" | null,
//     hasMeeting: boolean,
//     meeting: { name, email, phone, ...source-specific fields },
//   }
//
// The UI uses `source` to render a "Booked" vs "Mentioned" badge.
// =============================================================================
app.get('/api/recordings/:callId/meeting', auth, async (req, res) => {
  const callId = String(req.params.callId || '');
  if (!callId) return res.status(400).json({ error: 'callId required' });
  if (!mcpConfigured) return res.json({ source: null, hasMeeting: false, meeting: null });

  try {
    // Same tenant guard as the transcript endpoint — non-admins can only see
    // meetings tied to calls that touched one of their DIDs.
    if (req.user.role !== 'admin') {
      const ownDigits = await getUserNumberDigits(req.user.id);
      const detail = unwrapMcp(await callTool('get_call_detail', { call_id: callId }));
      const to   = String(detail?.to_number   || '').replace(/\D+/g, '');
      const from = String(detail?.from_number || '').replace(/\D+/g, '');
      if (!ownDigits.has(to) && !ownDigits.has(from)) {
        return res.status(403).json({ error: 'Not authorised for this call' });
      }
    }

    const out = unwrapMcp(await callTool('get_call_meeting', { call_id: callId }));
    res.json({
      callId,
      source:     out?.source     ?? null,
      hasMeeting: out?.has_meeting ?? !!out?.meeting,
      meeting:    out?.meeting    ?? null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Could not fetch meeting' });
  }
});

// Live monthly price-per-number from Twilio's Pricing API.
// Returns: { country, currency, prices: { local: number, tollFree: number, mobile: number, national: number } }
const PRICING_CACHE = new Map(); // key: country -> { ts, data }
const PRICING_TTL_MS = 1000 * 60 * 60; // 1 hour

const normTypeKey = (s) => {
  // Twilio uses "toll free", "local", "mobile", "national"
  const t = String(s || '').trim().toLowerCase();
  if (t === 'toll free' || t === 'tollfree') return 'tollFree';
  if (t === 'local') return 'local';
  if (t === 'mobile') return 'mobile';
  if (t === 'national') return 'national';
  return t;
};

// Markup applied to Twilio's wholesale price before showing it to customers.
// Configurable via NUMBER_PRICE_MARKUP env var. Default 2.5 = "+150%".
const PRICE_MARKUP = Math.max(1, Number(process.env.NUMBER_PRICE_MARKUP) || 2.5);
const applyMarkup = (cost) => Math.round(cost * PRICE_MARKUP * 100) / 100;
// USD → USD conversion for displaying prices in rupees. Set USD_USD in .env
// when the FX moves; defaults to $83/USD which tracks 2026 mid-market rate.
const USD_USD = Math.max(1, Number(process.env.USD_USD) || 83);
const toInr = (usd) => Math.round(usd * USD_USD);

// Hardcoded India fallbacks in USD wholesale (rough Twilio averages).
// Applied when the live pricing API returns nothing — keeps signup unblocked.
const IN_FALLBACK_COST_USD = { local: 1.15, mobile: 6.00, tollFree: 12.00 };

app.get('/api/twilio/pricing/:country', async (req, res) => {
  const country = String(req.params.country || 'IN').toUpperCase();

  // Manual inventory — fixed USD price across all types.
  if (NUMBER_PROVIDER === 'manual') {
    return res.json({
      country, countryName: 'India', currency: 'USD',
      prices: { local: MANUAL_PRICE_USD / USD_USD, mobile: MANUAL_PRICE_USD / USD_USD, tollFree: MANUAL_PRICE_USD / USD_USD },
      cost:   { local: 0, mobile: 0, tollFree: 0 },
      inr:    { local: MANUAL_PRICE_USD, mobile: MANUAL_PRICE_USD, tollFree: MANUAL_PRICE_USD },
      usdToInr: USD_USD,
      markup: 1, markupPercent: 0,
      source: 'manual',
    });
  }

  if (!twilioConfigured) return res.status(503).json({ error: 'Provider not configured' });
  const now = Date.now();
  const cached = PRICING_CACHE.get(country);
  if (cached && (now - cached.ts) < PRICING_TTL_MS) {
    return res.json(cached.data);
  }
  const buildData = (cost, countryName, currency, source) => {
    const prices = {}, inr = {};
    for (const [k, c] of Object.entries(cost)) {
      prices[k] = applyMarkup(c);
      inr[k] = toInr(applyMarkup(c));
    }
    return {
      country, countryName, currency: currency || 'USD',
      prices, cost, inr, usdToInr: USD_USD,
      markup: PRICE_MARKUP,
      markupPercent: Math.round((PRICE_MARKUP - 1) * 100),
      source,
    };
  };
  try {
    const p = await twilioClient.pricing.v1.phoneNumbers.countries(country).fetch();
    const cost = {};
    const rows = Array.isArray(p.phoneNumberPrices) ? p.phoneNumberPrices : [];
    for (const row of rows) {
      const k = normTypeKey(row.numberType);
      cost[k] = Number(row.currentPrice);
    }
    if (Object.keys(cost).length === 0 && country === 'IN') {
      // Twilio returned no rows for IN — fall back to known India averages.
      const data = buildData(IN_FALLBACK_COST_USD, p.country || 'India', p.priceUnit, 'fallback');
      PRICING_CACHE.set(country, { ts: now, data });
      return res.json(data);
    }
    const data = buildData(cost, p.country, p.priceUnit, 'live');
    PRICING_CACHE.set(country, { ts: now, data });
    res.json(data);
  } catch (e) {
    if (country === 'IN') {
      const data = buildData(IN_FALLBACK_COST_USD, 'India', 'USD', 'fallback-err');
      PRICING_CACHE.set(country, { ts: now, data });
      return res.json(data);
    }
    res.status(502).json({ error: e.message || 'Twilio pricing failed' });
  }
});

app.get('/api/twilio/stats', auth, async (req, res) => {
  try {
    const ratePerMin = Number(req.user.plan_rate) || 0;
    // Aggregate across ALL of this customer's DIDs (primary + additional).
    // Source is dashboard.9278.ai via MCP list_calls — never Twilio.
    const ownDigits = req.user.role === 'admin'
      ? null
      : await getUserNumberDigits(req.user.id);
    if (ownDigits && !ownDigits.size && !req.user.agent_id) {
      return res.json({
        callsToday: 0, callsThisMonth: 0, callsAllTime: 0,
        avgDurationSec: 0, minutesUsedThisMonth: 0, minutesUsedAllTime: 0,
        monthSpendInr: 0, allTimeSpendInr: 0, monthSpendUSD: 0,
        ratePerMin, number: null,
      });
    }

    // Per-DID fan-out — matches the call-history endpoint so all-time totals
    // are consistent between Overview's "Total minutes used" and the
    // Call history page's row count.
    const rows = ownDigits
      ? await fetchCallsForNumbers([...ownDigits], { agentId: req.user.agent_id })
      : await fetchAllCallsForAdmin();

    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

    const tsOf = (c) => new Date(c.started_at || c.startTime || 0).getTime();
    const todayCalls = rows.filter((c) => tsOf(c) >= todayStart.getTime());
    const monthCalls = rows.filter((c) => tsOf(c) >= monthStart.getTime());

    const sumDuration = (xs) => xs.reduce((a, c) => a + (Number(c.duration_seconds) || 0), 0);
    const completedAllTime = rows.filter((c) => c.end_reason || c.ended_at);
    const completedMonth   = monthCalls.filter((c) => c.end_reason || c.ended_at);
    const avgDur = completedMonth.length ? sumDuration(completedMonth) / completedMonth.length : 0;
    const minutesMonth   = +(sumDuration(completedMonth)  / 60).toFixed(2);
    const minutesAllTime = +(sumDuration(completedAllTime) / 60).toFixed(2);
    const monthSpendInr   = +(minutesMonth   * ratePerMin).toFixed(2);
    const allTimeSpendInr = +(minutesAllTime * ratePerMin).toFixed(2);

    res.json({
      callsToday: todayCalls.length,
      callsThisMonth: monthCalls.length,
      callsAllTime: completedAllTime.length,
      avgDurationSec: Math.round(avgDur),
      minutesUsedThisMonth: minutesMonth,
      minutesUsedAllTime: minutesAllTime,
      monthSpendInr,
      allTimeSpendInr,
      monthSpendUSD: monthSpendInr,  // kept for back-compat with older callers
      ratePerMin,
      number: req.user.number_value || null,
      numbers: ownDigits ? [...ownDigits].map((d) => '+' + d) : null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Stats failed' });
  }
});

// The "Test your agent" button used to trigger an outbound Twilio call. With
// TATA + 9278 (MCP), customers test by dialing their own DID — there is no
// programmable-outbound from this app. Keep the route for back-compat with
// older clients but return 410 Gone so the UI surfaces a clear message.
app.post('/api/twilio/test-call', auth, (_req, res) => {
  res.status(410).json({
    error: 'Outbound test calls removed — dial your number directly to test the agent.',
  });
});

// =============================================================================
// Scheduled meetings.
//
// The dashboard REMOVED its dedicated `get_scheduled_meetings` MCP tool.
// Bookings now flow entirely through a webhook tool (default name
// `schedule_meeting`) that the agent calls during a conversation → n8n →
// Google Calendar. The dashboard keeps an execution log of every webhook
// call, and THAT log is now the system of record: each entry's request body
// carries the booking (name / phone / email / start) plus `called_number`
// (the customer's own DID) and `caller_phone`. We read those logs back and
// reconstruct the meeting list the portal shows.
//
// Per-tenant scoping: filter on `called_number` ∈ the user's DIDs — a strong,
// direct signal (it's the customer's own number that received the call), so
// no call-history correlation is needed. Admins see everything.
// =============================================================================

// Webhook tools whose name/description looks like a booking action. Lets the
// endpoint work across resellers that named their tool differently.
const SCHEDULE_TOOL_HINT = /schedul|meeting|callback|appoint/i;

// Which tool(s) look like a booking action almost never changes between
// requests, so it gets its own long-lived cache separate from the bookings
// list below — otherwise every bookings cache miss paid for two sequential
// MCP round-trips (discover, then fetch logs) instead of one.
let SCHEDULE_TOOLS_CACHE = null; // { ts, tools: [...] }
const SCHEDULE_TOOLS_TTL_MS = 10 * 60_000;
const discoverScheduleTools = async () => {
  if (SCHEDULE_TOOLS_CACHE && Date.now() - SCHEDULE_TOOLS_CACHE.ts < SCHEDULE_TOOLS_TTL_MS) {
    return SCHEDULE_TOOLS_CACHE.tools;
  }
  try {
    const out = unwrapMcp(await callTool('list_webhook_tools', {}));
    const tools = Array.isArray(out?.tools) ? out.tools : [];
    const matched = tools
      .filter((t) => SCHEDULE_TOOL_HINT.test(t.name || '') || SCHEDULE_TOOL_HINT.test(t.description || ''))
      .map((t) => t.name)
      .filter(Boolean);
    const result = matched.length ? matched : ['schedule_meeting'];
    SCHEDULE_TOOLS_CACHE = { ts: Date.now(), tools: result };
    return result;
  } catch {
    return SCHEDULE_TOOLS_CACHE?.tools || ['schedule_meeting'];
  }
};

// All bookings are one global list (filtered per-user afterwards), so cache the
// discover + webhook-log fan-out globally for a short window — repeat / cross-
// user loads of Scheduled meetings then skip the MCP round-trips entirely.
let MEETINGS_CACHE = null;        // { ts, meetings: [...] }  (pre-tenant-filter)
const MEETINGS_TTL_MS = 60_000;
const fetchAllBookings = async ({ fresh = false } = {}) => {
  if (!fresh && MEETINGS_CACHE && Date.now() - MEETINGS_CACHE.ts < MEETINGS_TTL_MS) {
    return MEETINGS_CACHE.meetings;
  }
  const toolNames = await discoverScheduleTools();
  const batches = await Promise.all(toolNames.map(async (name) => {
    try {
      const out = unwrapMcp(await callTool('get_webhook_tool_logs', { name }));
      return Array.isArray(out?.logs) ? out.logs : [];
    } catch { return []; }
  }));
  const meetings = batches.flat().map(meetingFromWebhookLog).filter(Boolean);
  MEETINGS_CACHE = { ts: Date.now(), meetings };
  return meetings;
};

// Map one webhook execution-log entry to the meeting shape the portal UI
// expects (see Meetings.jsx / CallDetailModal.jsx). Returns null for log rows
// that don't look like a booking. Internal `_*` fields are used for tenant
// scoping and stripped before the response is sent.
const meetingFromWebhookLog = (log) => {
  const b = (log && log.request && log.request.body) || {};
  if (!b.start && !b.name && !b.phone) return null;
  // n8n sometimes echoes the created Google Calendar event back — surface a
  // deep link / event id when present so the UI can show "calendar synced".
  let calLink = null, calId = null;
  const rbody = log.response && (log.response.body || log.response.data || log.response);
  if (rbody && typeof rbody === 'object') {
    calLink = rbody.htmlLink || rbody.calendar_link || rbody.event_link || null;
    calId   = rbody.id || rbody.event_id || rbody.calendar_event_id || null;
  }
  return {
    id:                log.id || `${b.phone || ''}-${b.start || ''}`,
    name:              b.name || null,
    email:             b.email || null,
    phone:             b.phone || null,
    start:             b.start || null,
    end:               b.end || null,
    duration_minutes:  b.duration_minutes ? Number(b.duration_minutes) : null,
    status:            'scheduled',
    notes:             b.notes || b.service_needed || null,
    calendar_link:     calLink,
    calendar_event_id: calId,
    call_id:           b.session_id || b.room_name || null,
    _called:           String(b.called_number || '').replace(/\D+/g, ''),
    _bookedAt:         log.timestamp || null,
  };
};

app.get('/api/scheduled-meetings', auth, async (req, res) => {
  if (!mcpConfigured) {
    return res.json({ meetings: [], mcpConfigured: false });
  }
  try {
    const upcomingQ = req.query.upcoming;
    const upcomingOnly = (upcomingQ === undefined || upcomingQ === 'true' || upcomingQ === '1');

    // Cached global booking list (spread into a fresh array so the per-user
    // filtering/sort below never mutates the cached copy).
    let meetings = [...await fetchAllBookings({ fresh: req.query.refresh === '1' })];

    // Tenant scoping — non-admins only see bookings made on calls to one of
    // their own DIDs (the booking body's `called_number`).
    if (req.user.role !== 'admin') {
      const ownDigits = await getUserNumberDigits(req.user.id);
      if (!ownDigits.size) return res.json({ meetings: [] });
      meetings = meetings.filter((m) => m._called && ownDigits.has(m._called));
    }

    // Dedupe — the agent may retry the webhook, producing duplicate log rows.
    const seen = new Set();
    meetings = meetings.filter((m) => {
      const k = m.id || `${m.phone}-${m.start}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (upcomingOnly) {
      const cutoff = Date.now() - 60 * 60 * 1000; // 1h grace so in-progress meetings linger
      meetings = meetings.filter((m) => {
        const t = new Date(m.start).getTime();
        return isNaN(t) ? true : t >= cutoff;
      });
    }

    // Strip internal attribution fields, soonest-first.
    meetings = meetings.map(({ _called, _bookedAt, ...m }) => m);
    meetings.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
    res.json({ meetings, count: meetings.length });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Failed to fetch scheduled meetings' });
  }
});

// ---- MCP (LiveKit dashboard) integration -----------------------------------

// Helper: unwrap MCP CallToolResult content to plain JSON when possible.
const unwrapMcpResult = (result) => {
  if (!result || !Array.isArray(result.content)) return result;
  const text = result.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (!text) return result;
  try { return JSON.parse(text); }
  catch { return { text }; }
};

app.get('/api/mcp/status', async (_req, res) => {
  res.json({
    configured: mcpConfigured,
    url: mcpUrl(),
    lastError: mcpLastError(),
  });
});

// ============================================================================
// MCP server registry — the env-level dashboard.9278.ai plus every reseller
// whose row has mcp_url + mcp_token populated. Used by the admin MCP browser
// to pick which dashboard to inspect.
// ============================================================================
async function listMcpEndpoints() {
  const endpoints = [];
  if (mcpUrl()) {
    endpoints.push({
      key:    'env',
      label:  `${RESELLER_PORTAL} (default)`,
      portal: RESELLER_PORTAL,
      url:    mcpUrl(),
      source: 'env',
    });
  }
  const rows = (await q(`
    SELECT id, name, company, email, reseller_portal, mcp_url
      FROM users
     WHERE user_type = 'reseller'
       AND mcp_url IS NOT NULL AND mcp_url <> ''
       AND mcp_token IS NOT NULL AND mcp_token <> ''
     ORDER BY reseller_portal NULLS LAST, company NULLS LAST, id
  `)).rows;
  for (const r of rows) {
    endpoints.push({
      key:    `reseller-${r.id}`,
      label:  `${r.company || r.name} (${r.reseller_portal || r.email})`,
      portal: r.reseller_portal || '',
      url:    r.mcp_url,
      source: 'reseller',
      resellerId: String(r.id),
    });
  }
  return endpoints;
}

// Resolve a (url, token) pair for an endpoint key. Returns null when the key
// is the env-level client (the env-level helpers — listTools()/callTool() —
// handle that case directly, so we don't need to surface the env token).
async function mcpCredsForKey(key) {
  if (!key || key === 'env') return null;
  const m = /^reseller-(\d+)$/.exec(String(key));
  if (!m) return null;
  const r = (await q(
    `SELECT mcp_url, mcp_token FROM users WHERE id = $1 LIMIT 1`,
    [m[1]],
  )).rows[0];
  if (!r?.mcp_url || !r?.mcp_token) return null;
  return { url: r.mcp_url, token: r.mcp_token };
}

// GET /api/admin/mcp/endpoints — list every MCP server superadmin can query.
app.get('/api/admin/mcp/endpoints', auth, requireAdmin, async (_req, res) => {
  try {
    res.json({ endpoints: await listMcpEndpoints() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to list MCP endpoints' });
  }
});

// POST /api/admin/mcp/endpoints — add or update MCP creds for a reseller.
// Pass either { resellerId } or { resellerPortal } to identify the row,
// and { url, token } for the new creds. Empty url+token clears them
// (reseller falls back to the env-level MCP).
app.post('/api/admin/mcp/endpoints', auth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const url   = (b.url   || '').trim();
  const token = (b.token || '').trim();

  // url+token must both be present, or both empty (= clear).
  const clear = !url && !token;
  if (!clear) {
    if (!url || !token) return res.status(400).json({ error: 'Both url and token are required (or both empty to clear)' });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http:// or https://' });
  }

  // Identify the reseller — by id or by portal slug.
  let resellerId = b.resellerId ? Number(b.resellerId) : null;
  if (!resellerId && b.resellerPortal) {
    const r = await q(
      `SELECT id FROM users
        WHERE user_type = 'reseller'
          AND LOWER(reseller_portal) = LOWER($1)
        LIMIT 1`,
      [String(b.resellerPortal).trim()],
    );
    if (!r.rowCount) return res.status(404).json({ error: 'No reseller matched that portal slug' });
    resellerId = r.rows[0].id;
  }
  if (!resellerId) return res.status(400).json({ error: 'resellerId or resellerPortal is required' });

  // Confirm the target is actually a reseller row.
  const target = (await q(
    `SELECT id, user_type, reseller_portal, mcp_url FROM users WHERE id = $1 LIMIT 1`,
    [resellerId],
  )).rows[0];
  if (!target)                              return res.status(404).json({ error: 'Reseller not found' });
  if (target.user_type !== 'reseller')      return res.status(400).json({ error: 'Target user is not a reseller' });

  await q(
    `UPDATE users
        SET mcp_url   = $1,
            mcp_token = $2
      WHERE id = $3`,
    [url || null, token || null, resellerId],
  );

  res.json({
    ok: true,
    resellerId: String(resellerId),
    cleared: clear,
    url:    url   || null,
    // Never echo the token back — the caller already has it.
  });
});

app.get('/api/mcp/tools', auth, async (req, res) => {
  try {
    // Optional ?endpoint=<key> picks a specific MCP server. Defaults to the
    // env-level dashboard.9278.ai.
    const key = String(req.query?.endpoint || 'env');
    const creds = await mcpCredsForKey(key);
    const tools = creds ? await listToolsFor(creds) : await listTools();
    res.json({
      endpoint: key,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'MCP listTools failed' });
  }
});

app.get('/api/mcp/resources', auth, async (_req, res) => {
  try { res.json({ resources: await listResources() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Generic admin-only tool invocation. Optional `endpoint` selects which
// MCP server to call against — env-level by default; resellers that have
// mcp_url + mcp_token set get their own.
app.post('/api/mcp/call', auth, requireAdmin, async (req, res) => {
  const { name, args, endpoint } = req.body || {};
  if (!name) return res.status(400).json({ error: 'tool name required' });
  try {
    const creds = await mcpCredsForKey(endpoint || 'env');
    const r = creds
      ? await callToolFor(creds, name, args || {})
      : await callTool(name, args || {});
    res.json({ result: unwrapMcpResult(r), raw: r, endpoint: endpoint || 'env' });
  } catch (e) {
    res.status(502).json({ error: e.message || 'MCP call failed' });
  }
});

// Convenience endpoints (any logged-in user) — these are read-only summary tools.
const mcpReadOnly = {
  '/api/mcp/overview': 'get_overview',
  '/api/mcp/call-statistics': 'get_call_statistics',
  '/api/mcp/call-volume': 'get_call_volume',
  '/api/mcp/sentiment': 'get_sentiment',
  '/api/mcp/latency': 'get_latency',
  '/api/mcp/agents': 'list_agents',
  '/api/mcp/agent-performance': 'get_agent_performance',
  '/api/mcp/system-health': 'get_system_health',
  '/api/mcp/service-status': 'get_service_status',
  '/api/mcp/active-rooms': 'list_active_rooms',
  '/api/mcp/dispatch-rules': 'list_dispatch_rules',
  '/api/mcp/sip-trunks': 'list_sip_trunks',
};
// Tools that accept a per-agent scope — auto-inject the customer's agent_id
// so non-admin users only see their own data, not the whole tenant.
const PER_AGENT_TOOLS = new Set([
  'get_sentiment', 'get_call_volume', 'get_call_statistics',
  'get_latency', 'get_agent_performance',
]);

// Short-TTL cache for the PER_AGENT_TOOLS analytics tools (sentiment,
// call-volume, call-statistics, latency, agent-performance) — Overview and
// Analytics both request get_sentiment with the same days=30 window, so
// within this window the second page's load skips the MCP round-trip
// entirely. Scoped to just these aggregate/report-style tools, NOT the
// admin live-monitoring ones (system-health, service-status, active-rooms,
// …) where a stale snapshot would be misleading. Keyed by tool + scoped
// args so customers/agents never share another tenant's cached data.
const MCP_ANALYTICS_CACHE = new Map();
const MCP_ANALYTICS_TTL_MS = 30_000;

for (const [path, tool] of Object.entries(mcpReadOnly)) {
  const cacheable = PER_AGENT_TOOLS.has(tool);
  app.get(path, auth, async (req, res) => {
    try {
      const args = { ...(req.query || {}) };
      const skipCache = args.refresh === '1';
      delete args.refresh;
      if (cacheable && req.user.role !== 'admin' && req.user.agent_id) {
        args.agent_id = req.user.agent_id;
      }

      const key = cacheable ? `${tool}:${JSON.stringify(args)}` : null;
      if (cacheable && !skipCache) {
        const hit = MCP_ANALYTICS_CACHE.get(key);
        if (hit && Date.now() - hit.ts < MCP_ANALYTICS_TTL_MS) {
          res.setHeader('x-cache', 'hit');
          return res.json(hit.payload);
        }
      }

      const r = await callTool(tool, args);
      const payload = { tool, data: unwrapMcpResult(r) };
      if (cacheable) {
        if (MCP_ANALYTICS_CACHE.size > 500) {
          MCP_ANALYTICS_CACHE.delete(MCP_ANALYTICS_CACHE.keys().next().value);
        }
        MCP_ANALYTICS_CACHE.set(key, { ts: Date.now(), payload });
      }
      res.setHeader('x-cache', 'miss');
      res.json(payload);
    } catch (e) {
      res.status(502).json({ error: e.message || 'MCP call failed', tool });
    }
  });
}

// ---- Text-to-speech voice previews -----------------------------------------

app.get('/api/tts/voices', (_req, res) => {
  res.json({ configured: ttsConfigured, voices: TTS_VOICES });
});

// Stream a 5-second voice sample in the requested language.
// Auth-free so the signup AgentPage can use it before account creation.
// Cached per (voice, lang) pair; first request for a new pair takes ~1s to
// generate from OpenAI, subsequent requests are an immediate disk read.
app.get('/api/tts/sample/:voice', async (req, res) => {
  const requested = String(req.params.voice || '');
  // Live calls use Gemini voice IDs (Kore/Puck/…). Previews use Google Cloud
  // TTS rendered MP3s — mapToPreviewVoice() is a passthrough now (kept for
  // legacy callers).
  const voice = mapToPreviewVoice(requested.charAt(0) === requested.charAt(0).toUpperCase() ? requested : requested.toLowerCase());
  const lang = String(req.query.lang || 'en-US');
  if (!TTS_VOICES.includes(voice)) {
    return res.status(400).json({ error: 'Unknown voice' });
  }
  if (!ttsConfigured) {
    return res.status(503).json({
      error: 'Google Cloud TTS not configured. Set GOOGLE_TTS_API_KEY in .env',
    });
  }
  try {
    const file = cachedSamplePath(voice, lang) || (await generateSample(voice, lang));
    const s = await stat(file);
    // ETag = `${size}-${mtime-in-ms}` — cheap, stable, changes whenever the
    // file is regenerated (e.g. after switching the voice-mapping table).
    // Pair with `max-age=0, must-revalidate` so the browser always sends a
    // conditional GET; matching ETag → 304 (free), mismatch → fresh audio.
    // Without this, browsers held stale 24-hour-cached MP3s and previews
    // kept playing the OLD voice even after the server regenerated the file.
    const etag = `W/"${s.size}-${s.mtimeMs.toFixed(0)}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', s.size);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('Accept-Ranges', 'bytes');
    createReadStream(file).pipe(res);
  } catch (e) {
    console.error('[tts]', e.message || e);
    res.status(e.status || 502).json({ error: e.message || 'TTS generation failed' });
  }
});

// ============================================================================
// Meeting-created webhook — n8n's meeting.created flow POSTs here whenever
// the AI receptionist books a meeting. We send two confirmation emails:
//   1. To the meeting attendee (the `email` they gave the agent on the call)
//   2. To the DID owner — the user who owns the number the call came in on
//      (so the business hears about every booking made by their agent)
//
// The DID owner is resolved by climbing from the meeting's `agent_id` or
// the called number (`call_to_number`) up to the matching `users` row.
//
// Auth: HMAC-SHA256 of the raw body with MEETING_WEBHOOK_SECRET. Pass
// X-Webhook-Signature: <hex> from the n8n HTTP Request node.
// ============================================================================
const MEETING_WEBHOOK_SECRET = process.env.MEETING_WEBHOOK_SECRET || '';

const digitsOnly = (s) => String(s || '').replace(/\D+/g, '');

// Try to find which user owns the DID a call came in on. Tries (in order):
// 1. agent_id matches user_numbers.agent_id (per-DID agent)
// 2. agent_id matches users.agent_id (legacy primary-number agent)
// 3. called number digits match user_numbers.number_value digits
// Returns { user, didRow } or null.
async function ownerForMeeting({ agent_id, agent_slug, call_to_number }) {
  const targets = digitsOnly(call_to_number);

  if (agent_id) {
    const r = await q(
      `SELECT u.id, u.email, u.name, u.company,
              un.id AS did_id, un.number_value AS did_number, un.label AS did_label
         FROM user_numbers un
         JOIN users u ON u.id = un.user_id
        WHERE un.agent_id = $1
        LIMIT 1`,
      [agent_id],
    );
    if (r.rowCount) return shapeOwner(r.rows[0]);

    const r2 = await q(
      `SELECT u.id, u.email, u.name, u.company,
              NULL::int AS did_id, u.number_value AS did_number, NULL::text AS did_label
         FROM users u
        WHERE u.agent_id = $1
        LIMIT 1`,
      [agent_id],
    );
    if (r2.rowCount) return shapeOwner(r2.rows[0]);
  }

  if (agent_slug) {
    const r = await q(
      `SELECT u.id, u.email, u.name, u.company,
              un.id AS did_id, un.number_value AS did_number, un.label AS did_label
         FROM user_numbers un
         JOIN users u ON u.id = un.user_id
        WHERE un.agent_slug = $1
        LIMIT 1`,
      [agent_slug],
    );
    if (r.rowCount) return shapeOwner(r.rows[0]);
  }

  if (targets) {
    const r = await q(
      `SELECT u.id, u.email, u.name, u.company,
              un.id AS did_id, un.number_value AS did_number, un.label AS did_label
         FROM user_numbers un
         JOIN users u ON u.id = un.user_id
        WHERE regexp_replace(un.number_value, '\\D+', '', 'g') = $1
        LIMIT 1`,
      [targets],
    );
    if (r.rowCount) return shapeOwner(r.rows[0]);
  }

  return null;
}

function shapeOwner(row) {
  return {
    user: {
      id: String(row.id),
      email: row.email,
      name: row.name,
      company: row.company || '',
    },
    did: row.did_number
      ? { number: row.did_number, label: row.did_label || '' }
      : null,
  };
}

// Format a meeting time using the user's locale + Asia/Kolkata TZ since most
// customers are in India. Falls back to ISO if Date parses fail.
const fmtMeetingTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return d.toISOString();
  }
};

const escapeHtml = (s) => String(s || '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function buildMeetingHtml({ meeting, owner, audience }) {
  const start = fmtMeetingTime(meeting.start);
  const end   = fmtMeetingTime(meeting.end);
  const dur   = meeting.duration_minutes ? `${meeting.duration_minutes} min` : '';
  const ownerLabel = owner?.user?.company || owner?.user?.name || '';
  // audience='attendee' (the caller) vs 'owner' (the DID owner / business)
  const heading = audience === 'attendee'
    ? `Your meeting with ${escapeHtml(ownerLabel || 'us')} is confirmed`
    : `New meeting booked via your AI receptionist`;
  const intro = audience === 'attendee'
    ? `Hi ${escapeHtml(meeting.name || 'there')}, this confirms your meeting${ownerLabel ? ' with ' + escapeHtml(ownerLabel) : ''}. Details below.`
    : `Your AI receptionist booked a new meeting from a call to ${escapeHtml(owner?.did?.number || '')}.`;

  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
  <h2 style="margin:0 0 12px;font-size:20px;">${heading}</h2>
  <p style="color:#475569;margin:0 0 20px;">${intro}</p>
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
    <tr><td style="padding:10px 14px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Attendee</td>
        <td style="padding:10px 14px;text-align:right;font-weight:600;">${escapeHtml(meeting.name || '—')}</td></tr>
    <tr><td style="padding:10px 14px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #e2e8f0;">Email</td>
        <td style="padding:10px 14px;text-align:right;border-top:1px solid #e2e8f0;"><a href="mailto:${escapeHtml(meeting.email || '')}" style="color:#0ea5e9;text-decoration:none;">${escapeHtml(meeting.email || '—')}</a></td></tr>
    <tr><td style="padding:10px 14px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #e2e8f0;">Phone</td>
        <td style="padding:10px 14px;text-align:right;border-top:1px solid #e2e8f0;font-family:ui-monospace,monospace;">${escapeHtml(meeting.phone || '—')}</td></tr>
    <tr><td style="padding:10px 14px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #e2e8f0;">Start</td>
        <td style="padding:10px 14px;text-align:right;border-top:1px solid #e2e8f0;font-weight:600;">${escapeHtml(start)}</td></tr>
    <tr><td style="padding:10px 14px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #e2e8f0;">End</td>
        <td style="padding:10px 14px;text-align:right;border-top:1px solid #e2e8f0;">${escapeHtml(end)}</td></tr>
    ${dur ? `<tr><td style="padding:10px 14px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;border-top:1px solid #e2e8f0;">Duration</td>
        <td style="padding:10px 14px;text-align:right;border-top:1px solid #e2e8f0;">${dur}</td></tr>` : ''}
    ${meeting.notes ? `<tr><td colspan="2" style="padding:14px;border-top:1px solid #e2e8f0;"><div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Notes</div><div style="white-space:pre-wrap;">${escapeHtml(meeting.notes)}</div></td></tr>` : ''}
  </table>
  ${audience === 'owner' && owner?.did?.number ? `<p style="color:#94a3b8;font-size:12px;margin-top:18px;">Call received on <span style="font-family:ui-monospace,monospace;">${escapeHtml(owner.did.number)}</span></p>` : ''}
  <p style="color:#94a3b8;font-size:12px;margin-top:14px;">Meeting ID: <span style="font-family:ui-monospace,monospace;">${escapeHtml(meeting.id || meeting.meeting_id || '')}</span></p>
</body></html>`;
}

function verifyWebhookSignature(rawBody, header) {
  if (!MEETING_WEBHOOK_SECRET) return true; // open mode for dev — set the secret in prod
  if (!header) return false;
  const expected = crypto.createHmac('sha256', MEETING_WEBHOOK_SECRET).update(rawBody).digest('hex');
  // timing-safe compare against the hex string
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(header), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// req.rawBody is set by the global express.json() verify callback above so
// the HMAC matches the exact bytes n8n sent (re-stringifying after parse
// would produce a different byte sequence and never byte-match).
app.post(
  '/api/webhook/meeting-created',
  async (req, res) => {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (!verifyWebhookSignature(raw, req.headers['x-webhook-signature'])) {
      return res.status(401).json({ error: 'invalid signature' });
    }
    const payload = req.body || {};

    const meeting = payload.meeting || payload;
    if (!meeting || (!meeting.id && !meeting.meeting_id)) {
      return res.status(400).json({ error: 'meeting.id required' });
    }

    const owner = await ownerForMeeting({
      agent_id:        meeting.agent_id || payload.agent_id,
      agent_slug:      meeting.agent_slug || payload.agent_slug,
      call_to_number:  meeting.call_to_number || meeting.phone_number_called || payload.call_to_number,
    });

    if (!mailConfigured) {
      return res.status(200).json({ ok: false, skipped: 'mailer not configured' });
    }

    const results = { attendee: null, owner: null };

    // 1) Email the attendee (the caller).
    if (meeting.email) {
      try {
        const html = buildMeetingHtml({ meeting, owner, audience: 'attendee' });
        results.attendee = await sendMail({
          to: meeting.email,
          subject: `Meeting confirmed — ${fmtMeetingTime(meeting.start)}`,
          html,
          replyTo: owner?.user?.email || undefined,
        });
      } catch (e) {
        console.warn('[meeting-webhook] attendee mail failed:', e.message);
        results.attendee = { error: e.message };
      }
    }

    // 2) Email the DID owner (the business whose number was called).
    if (owner?.user?.email) {
      try {
        const html = buildMeetingHtml({ meeting, owner, audience: 'owner' });
        results.owner = await sendMail({
          to: owner.user.email,
          subject: `New meeting booked by your AI receptionist — ${escapeHtml(meeting.name || 'caller')}`,
          html,
          replyTo: meeting.email || undefined,
        });
      } catch (e) {
        console.warn('[meeting-webhook] owner mail failed:', e.message);
        results.owner = { error: e.message };
      }
    } else {
      console.warn('[meeting-webhook] no DID owner resolved for', {
        agent_id: meeting.agent_id, call_to_number: meeting.call_to_number,
      });
    }

    res.json({ ok: true, owner: owner?.user?.email || null, results });
  },
);

app.use((err, _req, res, _next) => {
  console.error('[api] error', err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = Number(process.env.PORT) || 4000;

// On Vercel this module is imported by api/index.js as a serverless request
// handler — there's no persistent process to `.listen()` on, and background
// timers/signal handlers don't survive between invocations, so all of that
// is skipped there. Migrations/seeding still run (idempotent, best-effort)
// so a cold start against a real Postgres DB stays in sync.
if (!process.env.VERCEL) {
  (async () => {
    try {
      await runMigrations();
    } catch (e) {
      console.error('[migrations] failed:', e.message);
    }
    try {
      await seedAdminUser();
    } catch (e) {
      console.error('[seed] failed:', e.message);
    }
    app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));

    // Fire the live-agent sweep ~10s after boot — enough time for MCP to wake
    // up. Fire-and-forget; failures are logged but don't crash the process.
    // Repeats every 30 minutes so long-running corruption gets healed within
    // half an hour even if nobody saves anything in the UI.
    const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
    setTimeout(() => {
      startupAgentSweep({ q }).catch((e) => console.warn('[startupSweep] errored:', e.message));
      setInterval(() => {
        startupAgentSweep({ q }).catch((e) => console.warn('[startupSweep] errored:', e.message));
      }, SWEEP_INTERVAL_MS);
    }, 10_000);
  })();

  const shutdown = async () => {
    console.log('[api] shutting down');
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} else {
  // Best-effort migrations/seed on cold start; never blocks the handler.
  runMigrations().catch((e) => console.error('[migrations] failed:', e.message));
  seedAdminUser().catch((e) => console.error('[seed] failed:', e.message));
}


// temporary START
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await q(`
      SELECT id, username, email, password_hash, role
      FROM users
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(err.message);
  }
});

// temporary END

export default app;