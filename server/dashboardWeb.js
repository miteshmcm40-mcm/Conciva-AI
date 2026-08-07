import 'dotenv/config';

// ============================================================================
// Dashboard WEB-session client (distinct from the MCP client in mcp.js).
//
// The 9278.ai dashboard removed the `get_recording_url` MCP tool, so there is
// no longer a way to obtain a signed, publicly-playable recording URL. Audio
// files live behind the dashboard's cookie-authenticated web route:
//
//     GET /egress/files/<filename>/download   →  206 video/mp4 (Range-capable)
//
// and the filename for a given call is discoverable via:
//
//     GET /egress/stored?search=<roomShortId>  →  HTML table with a
//                                                  /egress/files/.../download link
//
// Both require a logged-in dashboard session (cookie `access_token`). This
// module logs in once with DASHBOARD_EMAIL / DASHBOARD_PASSWORD, caches the
// cookie, and re-logs-in on expiry. The portal then PROXIES the audio bytes to
// the customer (who has no dashboard login) — see /api/recordings/:callId/audio.
// ============================================================================

const BASE = (process.env.DASHBOARD_BASE_URL || 'https://dashboard.9278.ai').replace(/\/$/, '');
const EMAIL = process.env.DASHBOARD_EMAIL || '';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

export const dashboardWebConfigured = !!(EMAIL && PASSWORD);

let cookie = null;          // "access_token=…" (the cached session)
let loginInFlight = null;   // de-dupes concurrent login attempts

const setCookiesOf = (res) =>
  (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0]);

// Perform a fresh login and cache the session cookie. Concurrent callers share
// the same in-flight promise so we never hammer /login.
const login = async () => {
  if (!dashboardWebConfigured) throw new Error('Dashboard web login not configured (set DASHBOARD_EMAIL / DASHBOARD_PASSWORD)');
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    try {
      // 1. GET /login → CSRF token (+ any pre-session cookies).
      const r1 = await fetch(`${BASE}/login`, { redirect: 'manual' });
      const preCookies = setCookiesOf(r1);
      const html = await r1.text();
      const csrf = (html.match(/name="csrf_token"[^>]*value="([^"]*)"/i) || [])[1] || '';

      // 2. POST credentials.
      const body = new URLSearchParams({ csrf_token: csrf, email: EMAIL, password: PASSWORD });
      const r2 = await fetch(`${BASE}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: preCookies.join('; ') },
        body,
      });
      const sessionCookies = setCookiesOf(r2);
      if (!sessionCookies.length) {
        throw new Error(`Dashboard login failed (status ${r2.status}) — check DASHBOARD_EMAIL / DASHBOARD_PASSWORD`);
      }
      cookie = sessionCookies.join('; ');
      return cookie;
    } finally {
      loginInFlight = null;
    }
  })();
  return loginInFlight;
};

// fetch() against the dashboard with the cached session cookie. On a response
// that smells like an expired session (redirect to /login, or 401/403), it
// re-logs-in once and retries.
const authedFetch = async (path, opts = {}, _retried = false) => {
  if (!cookie) await login();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    redirect: 'manual',
    headers: { ...(opts.headers || {}), Cookie: cookie },
  });
  const loc = res.headers.get('location') || '';
  const expired = res.status === 401 || res.status === 403 ||
                  ((res.status === 302 || res.status === 303) && /\/login/.test(loc));
  if (expired && !_retried) {
    cookie = null;
    await login();
    return authedFetch(path, opts, true);
  }
  return res;
};

// Cache: room short-id → "/egress/files/<filename>/download" (or null if none).
const fileCache = new Map();
const FILE_TTL_MS = 5 * 60 * 1000;

// Resolve the egress download path for a call's room short-id by searching the
// dashboard's stored-recordings list. Returns the path (string) or null.
export const resolveRecordingDownloadPath = async (shortId) => {
  if (!shortId) return null;
  const hit = fileCache.get(shortId);
  if (hit && Date.now() - hit.ts < FILE_TTL_MS) return hit.path;

  const res = await authedFetch(`/egress/stored?page=1&per_page=10&search=${encodeURIComponent(shortId)}`);
  let path = null;
  if (res.ok) {
    const html = await res.text();
    // The search can match more than one file; pick the link whose filename
    // actually contains this short-id (defensive against fuzzy matches).
    const links = [...html.matchAll(/\/egress\/files\/([^"]+?\.mp4)\/download/gi)].map((m) => m[1]);
    const filename = links.find((f) => f.includes(shortId)) || links[0] || null;
    if (filename) path = `/egress/files/${filename}/download`;
  }
  fileCache.set(shortId, { ts: Date.now(), path });
  return path;
};

// Stream a recording's bytes from the dashboard. Forwards an optional Range
// header and returns { status, headers, body } where body is a web
// ReadableStream (or null). Caller pipes it to the Express response.
export const fetchRecordingStream = async (downloadPath, { range } = {}) => {
  const headers = {};
  if (range) headers.Range = range;
  const res = await authedFetch(downloadPath, { headers });
  return { status: res.status, headers: res.headers, body: res.body };
};
