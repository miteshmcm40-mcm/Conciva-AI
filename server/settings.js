// Admin-editable settings layer. Values stored in the `settings` Postgres
// table override the env vars from .env. The settings UI in /admin/settings
// reads + writes through this module.

import 'dotenv/config';
import { q } from './db.js';

// Schema describing every editable setting. Anything NOT in this list is
// rejected by the API to prevent admins from mutating arbitrary keys.
//
// `secret: true`  → value masked when read by the UI (only first/last few chars)
// `restartHint`   → message shown to admin when a restart is needed for a change
//                    to take effect (e.g. SDK clients are constructed at startup)
export const SETTINGS_SCHEMA = [
  {
    section: 'twilio', sectionLabel: '📞 Twilio',
    fields: [
      { key: 'TWILIO_ACCOUNT_SID',     label: 'Account SID',     placeholder: 'AC...', secret: false, restartHint: true },
      { key: 'TWILIO_AUTH_TOKEN',      label: 'Auth token',      placeholder: '••••', secret: true,  restartHint: true },
      { key: 'TWILIO_API_KEY_SID',     label: 'API key SID',     placeholder: 'SK...', secret: false, restartHint: true },
      { key: 'TWILIO_API_KEY_SECRET',  label: 'API key secret',  placeholder: '••••', secret: true,  restartHint: true },
      { key: 'TWILIO_DEFAULT_NUMBER',  label: 'Default outbound caller', placeholder: '+1...', secret: false },
      { key: 'PUBLIC_BASE_URL',        label: 'Public base URL (Twilio webhooks)', placeholder: 'https://...', secret: false },
    ],
  },
  {
    section: 'mcp', sectionLabel: '🤖 9278 MCP',
    fields: [
      { key: 'MCP_URL',   label: 'MCP endpoint URL', placeholder: 'https://dashboard.9278.ai/mcp', secret: false, restartHint: true },
      { key: 'MCP_TOKEN', label: 'Bearer token',     placeholder: 'sk-mcp-...', secret: true,  restartHint: true },
    ],
  },
  {
    section: 'dashboard', sectionLabel: '🪟 9278 Dashboard (form-post login)',
    fields: [
      { key: 'DASHBOARD_BASE_URL', label: 'Dashboard URL', placeholder: 'https://dashboard.9278.ai', secret: false, restartHint: true },
      { key: 'DASHBOARD_EMAIL',    label: 'Login email',   placeholder: 'admin@…', secret: false, restartHint: true },
      { key: 'DASHBOARD_PASSWORD', label: 'Login password', placeholder: '••••', secret: true,  restartHint: true },
    ],
  },
  {
    section: 'razorpay', sectionLabel: '💳 Razorpay',
    fields: [
      { key: 'RAZORPAY_KEY_ID',         label: 'Key ID',         placeholder: 'rzp_live_…',   secret: false, restartHint: true },
      { key: 'RAZORPAY_KEY_SECRET',     label: 'Key Secret',     placeholder: '••••',         secret: true,  restartHint: true },
      { key: 'RAZORPAY_WEBHOOK_SECRET', label: 'Webhook secret', placeholder: 'whsec_…',      secret: true,  restartHint: true },
    ],
  },
  {
    section: 'grok', sectionLabel: '🤖 Grok (xAI) — call summaries + live agent LLM',
    fields: [
      { key: 'XAI_API_KEY', label: 'xAI API key', placeholder: 'xai-…', secret: true, restartHint: true },
      { key: 'XAI_MODEL',   label: 'Model (default grok-4-fast-non-reasoning)', placeholder: 'grok-4-fast-non-reasoning', secret: false, restartHint: true },
    ],
  },
  {
    section: 'smtp', sectionLabel: '✉ Email (SMTP) — meeting confirmations',
    fields: [
      { key: 'SMTP_HOST',              label: 'SMTP host',         placeholder: 'smtp.gmail.com',                 secret: false, restartHint: true },
      { key: 'SMTP_PORT',              label: 'SMTP port',         placeholder: '587',                            secret: false, restartHint: true },
      { key: 'SMTP_USER',              label: 'SMTP username',     placeholder: 'noreply@9278.ai',                secret: false, restartHint: true },
      { key: 'SMTP_PASS',              label: 'SMTP password',     placeholder: '••••',                           secret: true,  restartHint: true },
      { key: 'SMTP_FROM',              label: 'From address',      placeholder: 'Voice Portal <noreply@9278.ai>', secret: false, restartHint: true },
      { key: 'MEETING_WEBHOOK_SECRET', label: 'Meeting webhook signing secret (HMAC-SHA256)', placeholder: 'long random string', secret: true, restartHint: true },
    ],
  },
  {
    section: 'google-tts', sectionLabel: '🔊 Google Cloud TTS (voice previews)',
    fields: [
      { key: 'GOOGLE_TTS_API_KEY', label: 'Google Cloud API key',           placeholder: 'AIza…',         secret: true,  restartHint: true },
      { key: 'TTS_PREVIEW_TEXT',   label: 'Preview line read by each voice', placeholder: 'Hi there! …',  secret: false },
    ],
  },
  {
    section: 'pricing', sectionLabel: '💲 Number pricing',
    fields: [
      { key: 'NUMBER_PRICE_MARKUP', label: 'Markup multiplier (2.5 = +150%)', placeholder: '2.5', secret: false, restartHint: true },
    ],
  },
];

const KNOWN_KEYS = new Set(SETTINGS_SCHEMA.flatMap((s) => s.fields.map((f) => f.key)));
const SECRET_KEYS = new Set(SETTINGS_SCHEMA.flatMap((s) => s.fields.filter((f) => f.secret).map((f) => f.key)));

// In-memory cache so we don't hit Postgres on every config read.
let overrideCache = null; // Map<key, value> from DB
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5_000;

async function loadOverrides() {
  if (overrideCache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return overrideCache;
  const r = await q(`SELECT key, value FROM settings`);
  const map = new Map();
  for (const row of r.rows) map.set(row.key, row.value);
  overrideCache = map;
  cacheLoadedAt = Date.now();
  return map;
}
const invalidateCache = () => { overrideCache = null; };

// `getSetting('RAZORPAY_KEY_ID')` → DB override if present, else process.env.
// Anything that wants the live value should call this instead of reading
// process.env directly. Modules constructed at startup (Razorpay, MCP
// clients) keep using their cached values until a restart — the settings UI
// surfaces a "restart required" badge for those.
export async function getSetting(key) {
  if (!KNOWN_KEYS.has(key)) return process.env[key] ?? '';
  const overrides = await loadOverrides();
  if (overrides.has(key)) return overrides.get(key);
  return process.env[key] ?? '';
}

const maskSecret = (v) => {
  if (!v) return '';
  if (v.length <= 8) return '••••';
  return v.slice(0, 4) + '…' + v.slice(-4);
};

// Build the full schema + values for the admin UI. Secrets are masked.
export async function readForAdmin() {
  const overrides = await loadOverrides();
  return SETTINGS_SCHEMA.map((sec) => ({
    section: sec.section,
    sectionLabel: sec.sectionLabel,
    fields: sec.fields.map((f) => {
      const dbVal = overrides.has(f.key) ? overrides.get(f.key) : null;
      const envVal = process.env[f.key] ?? '';
      const live = dbVal ?? envVal;
      return {
        key: f.key,
        label: f.label,
        placeholder: f.placeholder || '',
        secret: !!f.secret,
        restartHint: !!f.restartHint,
        present: !!live,
        source: dbVal != null ? 'db' : (envVal ? 'env' : 'unset'),
        masked: f.secret ? maskSecret(live) : live,
      };
    }),
  }));
}

export async function updateSettings(patch, byUserId = null) {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid payload');
  const ops = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!KNOWN_KEYS.has(k)) throw new Error(`Unknown setting: ${k}`);
    if (typeof v !== 'string') throw new Error(`Setting ${k} must be a string`);
    ops.push([k, v]);
  }
  for (const [k, v] of ops) {
    if (v === '') {
      // Empty → remove DB override (falls back to env).
      await q(`DELETE FROM settings WHERE key = $1`, [k]);
    } else {
      await q(
        `INSERT INTO settings (key, value, is_secret, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               is_secret = EXCLUDED.is_secret,
               updated_at = NOW(),
               updated_by = EXCLUDED.updated_by`,
        [k, v, SECRET_KEYS.has(k), byUserId],
      );
    }
  }
  invalidateCache();
  return readForAdmin();
}
