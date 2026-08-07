// Headless client for dashboard.9278.ai. Logs in with email/password,
// keeps the session cookie, fetches CSRF tokens from each form page, and
// posts back to the same form-actions the dashboard UI uses.
//
// Trunk and agent operations now go through MCP (/mcp-ext) — see provision.js.
// This file is kept only for createDispatchRule: MCP create_dispatch_rule
// accepts the request but silently drops room_config.agents, so the
// dashboard-voice-agent worker never auto-joins the room. The form-POST below
// is the only way to bind agent_name into room_config.agents.

import 'dotenv/config';

const BASE = (process.env.DASHBOARD_BASE_URL || '').replace(/\/$/, '');
const EMAIL = process.env.DASHBOARD_EMAIL || '';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

export const dashboardConfigured = !!(BASE && EMAIL && PASSWORD);

let session = null;          // { cookie: 'name=value; name2=value2; ...', loggedInAt }
let loggingIn = null;        // dedupes concurrent login attempts

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;   // re-login every 6h to be safe

const cookieToHeader = (setCookieHeaders) => {
  // Take only name=value (drop attributes), keep the latest occurrence per name.
  const jar = new Map();
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i < 0) continue;
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
};

const mergeCookies = (existing, incomingHeaders) => {
  if (!incomingHeaders.length) return existing;
  const merged = new Map();
  for (const pair of (existing || '').split('; ').filter(Boolean)) {
    const i = pair.indexOf('=');
    if (i > 0) merged.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  for (const raw of incomingHeaders) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i < 0) continue;
    merged.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
};

// Pull all Set-Cookie headers (Node's fetch returns them via headers.getSetCookie()).
const getSetCookies = (headers) => {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const v = headers.get('set-cookie');
  return v ? [v] : [];
};

const extractCsrf = (html) => {
  const m = html.match(/name=["']csrf_token["']\s+value=["']([^"']+)["']/);
  return m ? m[1] : null;
};

async function performLogin() {
  if (!dashboardConfigured) throw new Error('Dashboard credentials not configured');

  // 1) GET /login -> cookie + csrf_token from the form
  const loginUrl = `${BASE}/login`;
  const r1 = await fetch(loginUrl, { redirect: 'manual' });
  let cookies = cookieToHeader(getSetCookies(r1.headers));
  const html = await r1.text();
  const csrf = extractCsrf(html);
  if (!csrf) throw new Error('Could not find csrf_token on login page');

  // 2) POST /login with csrf_token, email, password and the same cookies
  const body = new URLSearchParams({
    csrf_token: csrf,
    email: EMAIL,
    password: PASSWORD,
  }).toString();
  const r2 = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': loginUrl,
    },
    body,
    redirect: 'manual',
  });
  cookies = mergeCookies(cookies, getSetCookies(r2.headers));

  if (r2.status !== 303 && r2.status !== 302) {
    throw new Error(`Dashboard login failed (HTTP ${r2.status})`);
  }
  if (!cookies.includes('access_token=')) {
    throw new Error('Dashboard login did not return access_token cookie');
  }

  session = { cookie: cookies, loggedInAt: Date.now() };
  console.log('[dashboard] logged in as', EMAIL);
  return session;
}

async function ensureSession() {
  if (!dashboardConfigured) throw new Error('Dashboard credentials not configured');
  if (session && Date.now() - session.loggedInAt < SESSION_TTL_MS) return session;
  if (!loggingIn) {
    loggingIn = performLogin().finally(() => { loggingIn = null; });
  }
  await loggingIn;
  return session;
}

const dashboardFetch = async (path, opts = {}) => {
  await ensureSession();
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = {
    ...(opts.headers || {}),
    'Cookie': session.cookie,
  };
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  // If session expired (303 to /login), re-login once and retry.
  const loc = res.headers.get('location') || '';
  if (res.status === 303 && /\/login/.test(loc)) {
    session = null;
    await ensureSession();
    const headers2 = { ...(opts.headers || {}), 'Cookie': session.cookie };
    return fetch(url, { ...opts, headers: headers2, redirect: 'manual' });
  }
  return res;
};

// Fetch a page and pull csrf_token from its DOM. Used by every POST below
// because the dashboard issues a fresh per-page CSRF token.
async function getCsrf(path) {
  const res = await dashboardFetch(path, { method: 'GET' });
  const html = await res.text();
  const csrf = extractCsrf(html);
  if (!csrf) throw new Error(`No csrf_token found on ${path}`);
  return csrf;
}

const formPost = async (path, fields, csrfFromPath) => {
  const csrf = await getCsrf(csrfFromPath || path);
  const body = new URLSearchParams({ csrf_token: csrf, ...fields }).toString();
  const res = await dashboardFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}${csrfFromPath || path}`,
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
};

// ---- Public API ------------------------------------------------------------

export async function loginToDashboard() {
  return ensureSession();
}

// Create an inbound SIP trunk on the 9278 dashboard.
// Returns the new trunk ID (e.g., "ST_xxxxxxxx").
export async function createInboundTrunk({
  name,
  numbers,                 // string array of E.164 numbers (with or without +)
  numberFormat = 'no_plus', // matches the existing Twilio trunks
  allowedAddresses = TWILIO_SIP_IPS,
  allowedNumbers = '',
  username = '',
  password = '',
  metadata = '',
} = {}) {
  const payload = {
    trunk_name: name,
    number_format: numberFormat,
    numbers: (numbers || []).map((n) => String(n).replace(/^\+/, '')).join(', '),
    allowed_addresses: Array.isArray(allowedAddresses) ? allowedAddresses.join(', ') : (allowedAddresses || ''),
    allowed_numbers: Array.isArray(allowedNumbers) ? allowedNumbers.join(', ') : (allowedNumbers || ''),
    username, password, metadata,
    json_data: '',
  };
  const r = await formPost('/telephony/inbound/trunk/create', payload, '/telephony/inbound');
  if (r.status !== 303 && r.status !== 302 && r.status !== 200) {
    throw new Error(`createInboundTrunk failed (HTTP ${r.status}): ${r.text.slice(0, 300)}`);
  }
  // Find by number first (unique), fall back to name.
  const targetNumber = (numbers[0] || '').replace(/^\+/, '').replace(/\D/g, '');
  const trunks = await listInboundTrunks();
  const byNumber = trunks.find((t) =>
    t.numbers.some((n) => n.replace(/^\+/, '').replace(/\D/g, '') === targetNumber),
  );
  if (byNumber) return byNumber;
  const byName = trunks.find((t) => t.name === name);
  if (byName) return byName;
  throw new Error('Created trunk not found in list after POST');
}

// Delete an inbound trunk by ID.
export async function deleteInboundTrunk(trunkId) {
  const r = await formPost(
    '/telephony/inbound/trunk/delete',
    { sip_trunk_id: trunkId },
    '/telephony/inbound',
  );
  return { status: r.status };
}

export async function listInboundTrunks() {
  const r = await dashboardFetch('/telephony/inbound', { method: 'GET' });
  const html = await r.text();
  // The dashboard renders edit-buttons with data-* attributes for each trunk:
  //   data-trunk-id="ST_xxx" data-trunk-name="..." data-trunk-numbers="+1..."
  // We grab those instead of trying to scrape free text. The first match per ID
  // is taken (edit + delete buttons repeat the same attributes).
  const seen = new Map();
  const re = /data-trunk-id="(ST_[A-Za-z0-9]+)"[\s\S]{0,500}?data-trunk-name="([^"]+)"(?:[\s\S]{0,500}?data-trunk-numbers="([^"]*)")?/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.set(m[1], {
      id: m[1],
      name: decodeHtmlEntities(m[2]),
      numbers: decodeHtmlEntities(m[3] || '').split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return [...seen.values()];
}

const decodeHtmlEntities = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'");

// Create a dispatch rule. Defaults to per-caller individual rooms so
// concurrent callers don't share audio.
export async function createDispatchRule({
  name,
  trunkIds,                 // array of trunk IDs (we always send one)
  agentSlug,                // e.g. 'softtop-sales-agent'
  roomName,                 // for direct
  ruleType = 'individual',  // 'individual' | 'direct' | 'callee'
  pin = '',
  hidePhoneNumber = false,
  autoRecord = false,
  metadata = '',
  agentMetadata = '',
} = {}) {
  const fields = {
    rule_name: name,
    trunk_ids: trunkIds.join(','),
    dispatch_rule_type: ruleType,
    room_name: roomName || '',
    room_prefix: '',
    pin,
    hide_phone_number: hidePhoneNumber ? 'on' : '',
    auto_record: autoRecord ? 'on' : '',
    agent_name: agentSlug || '',
    time_profile_id: '',
    agent_metadata: agentMetadata,
    metadata,
    plain_json: '',
  };
  const r = await formPost('/telephony/rules/create', fields, '/telephony/rules');
  if (r.status !== 303 && r.status !== 302 && r.status !== 200) {
    throw new Error(`createDispatchRule failed (HTTP ${r.status}): ${r.text.slice(0, 300)}`);
  }
  // Look up the new rule ID from the list page.
  const rules = await listDispatchRules();
  const found = rules.find((x) => x.name === name);
  return found || { id: null, name };
}

export async function listDispatchRules() {
  const r = await dashboardFetch('/telephony/rules', { method: 'GET' });
  const html = await r.text();
  const seen = new Map();
  const re = /data-rule-id="(SDR_[A-Za-z0-9]+)"[\s\S]{0,800}?data-rule-name="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.set(m[1], { id: m[1], name: decodeHtmlEntities(m[2]) });
  }
  // Fallback: also grab any SDR_ ids that didn't pair (rare).
  for (const idMatch of html.matchAll(/(SDR_[A-Za-z0-9]+)/g)) {
    if (!seen.has(idMatch[1])) seen.set(idMatch[1], { id: idMatch[1], name: idMatch[1] });
  }
  return [...seen.values()];
}

// Twilio's published SIP IPs (regions). Same list the existing trunks use.
export const TWILIO_SIP_IPS = [
  '54.172.60.0/30',
  '54.244.51.0/30',
  '54.171.127.192/30',
  '54.65.63.192/30',
  '54.169.127.128/30',
  '54.252.254.64/30',
  '177.71.206.192/30',
  '54.232.85.80/30',
  '35.156.191.128/30',
];
