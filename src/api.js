import { getDemoResponse } from './demoData.js';

const TOKEN_KEY = '9278.token';

// Base URL for the backend API. Empty in dev (the Vite proxy forwards /api to
// the local Express server) and on any host that runs the backend at the same
// origin. Set VITE_API_BASE to an absolute URL (e.g. https://api.example.com)
// when the frontend is deployed separately from the backend — as on Vercel,
// which serves only the static build and has no Node server.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const getToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
};

const DEMO_MODE = true;

// Paths that must always reach the real Express backend (and therefore a
// real email/DB), even while DEMO_MODE fakes everything else — otherwise an
// OTP "sent" by the demo layer is never actually emailed anywhere, and
// sign-in accepts literally any input as long as something is typed. Only
// worth using once server/index.js is actually running and reachable at
// API_BASE (and SMTP_* is set in its .env — see server/mail.js), or these
// calls will fail with a network/connection error instead of a fake success.
const REAL_BACKEND_PATHS = new Set([
  '/api/signin',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/auth/resend-otp',
]);

// Once someone has actually completed the real signup flow above, their
// session token is a real one (not the constant 'demo-token' the bootstrap
// auto-login uses) — from that point on, /api/me and /api/signout should
// also hit the real backend, or the next time anything re-checks the
// session (reload, nav) it silently gets overwritten by the fake DEMO_USER
// again. The demo auto-login path is untouched: it always uses the literal
// token 'demo-token', so this never affects it.
const REAL_SESSION_PATHS = new Set(['/api/me', '/api/signout']);
const hasRealSession = () => {
  const t = getToken();
  return !!t && t !== 'demo-token';
};

// Collapses concurrent identical GET requests into a single network call —
// covers React StrictMode's dev-only double-invoke and any two components
// that happen to request the same path in the same tick. Only GETs are safe
// to share (mutations must never be deduped), and the entry is cleared as
// soon as it settles, so it never masks a genuinely fresh request later.
const inflightGets = new Map();

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const forceReal = REAL_BACKEND_PATHS.has(path) || (REAL_SESSION_PATHS.has(path) && hasRealSession());
  if (DEMO_MODE && !forceReal) {
    return getDemoResponse(path, { method, body });
  }

  const isGet = method === 'GET';
  const key = isGet ? `${auth ? '1' : '0'}:${path}` : null;
  if (isGet && inflightGets.has(key)) return inflightGets.get(key);

  const request = (async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const t = getToken();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  })();

  if (isGet) {
    inflightGets.set(key, request);
    request.finally(() => inflightGets.delete(key));
  }
  return request;
}