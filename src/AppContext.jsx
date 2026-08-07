import { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';

const AppContext = createContext(null);

// Stale-while-revalidate cache for the bootstrap user — without it, EVERY
// protected page (including one whose own data is already SWR-cached, e.g.
// Overview) still sits behind RequireAuth's blocking <Loading/> until
// GET /api/me resolves, on every single open. Keyed by token (not userId,
// since we don't know the userId until we've read this) and session-scoped
// to match the token's own per-tab lifetime (see api.js) — a stale entry
// from a since-replaced token is simply ignored. The bootstrap effect below
// still always calls /api/me in the background and self-heals (updates or
// signs out) once it resolves; this only removes the blocking wait on the
// common case of a still-valid session.
const BOOT_CACHE_KEY = 'kallus.bootstrap.user';
const readBootCache = (token) => {
  if (!token) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(BOOT_CACHE_KEY) || 'null');
    return parsed && parsed.token === token ? parsed.user : null;
  } catch {
    return null;
  }
};
const writeBootCache = (token, user) => {
  try { sessionStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ token, user })); } catch {}
};
const clearBootCache = () => { try { sessionStorage.removeItem(BOOT_CACHE_KEY); } catch {} };

// Distinguishes "never signed in yet" from "just explicitly signed out" —
// without this, the demo auto-login below (which fires whenever there's no
// token) can't tell the difference and immediately re-logs the user back in
// the moment anything re-checks the session, silently undoing signoutUser.
const LOGGED_OUT_KEY = 'kallus.explicitLogout';
const markExplicitLogout = () => { try { sessionStorage.setItem(LOGGED_OUT_KEY, '1'); } catch {} };
const clearExplicitLogout = () => { try { sessionStorage.removeItem(LOGGED_OUT_KEY); } catch {} };
const wasExplicitLogout = () => { try { return sessionStorage.getItem(LOGGED_OUT_KEY) === '1'; } catch { return false; } };

const emptySignup = () => ({
  plan: null, planAmount: 0, planMin: 0, planRate: 0, planAgents: 0, planLabel: '',
  planCycle: 'monthly',
  number: null, numberPrice: 5, numberLoc: '',
  voice: 'Kore', language: 'en-US',
  agentName: '', greeting: '', prompt: '',
  kbCompany: '', kbFaqs: '',
  meName: '', meCompany: '', meUsername: '', meEmail: '', mePhone: '', mePwd: '',
});

export function AppProvider({ children }) {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(() => readBootCache(getToken()));
  // Only block on the network when there's a token but no cached user for
  // it yet (first-ever load in this tab) — a cache hit skips the wait, a
  // missing token skips it too (nothing to bootstrap).
  const [bootstrapping, setBootstrapping] = useState(() => {
    const t = getToken();
    return !!t && !readBootCache(t);
  });
  const [signup, setSignup] = useState(emptySignup);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const urlToken = url.searchParams.get('token');
        if (urlToken) {
          setToken(urlToken);
          url.searchParams.delete('token');
          window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
        }
      } catch { /* non-browser env — ignore */ }

      const t = getToken();
      if (!t) {
        const onPublicPage = /^\/(signin|signup)(\/|$)/.test(window.location.pathname)
          || window.location.pathname === '/';
        if (wasExplicitLogout() || onPublicPage) {
          // Respect an explicit sign-out, and don't hijack someone who's
          // deliberately landed on the homepage, /signin, or /signup (typed
          // URL, refresh, bookmark) — land them on a real signed-out state
          // instead of silently establishing the demo session and bouncing
          // them to the dashboard before they ever see the page.
          if (!cancelled) setBootstrapping(false);
          return;
        }
        setToken('demo-token');
        const { user } = await api('/api/me');
        if (!cancelled) {
          setCurrentUser(user);
          writeBootCache('demo-token', user);
          setBootstrapping(false);
          navigate('/dashboard/overview', { replace: true });
        }
        return;
      }

      try {
        const { user } = await api('/api/me');
        if (cancelled) return;
        setCurrentUser(user);
        writeBootCache(t, user);
      } catch {
        setToken('');
        clearBootCache();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const updateSignup = (patch) => setSignup((s) => ({ ...s, ...patch }));

  // Used by the Stripe checkout success handler to put the user straight
  // into a signed-in state after the payment is verified.
  const establishSession = ({ token, user }) => {
    setToken(token);
    setCurrentUser(user);
    writeBootCache(token, user);
    clearExplicitLogout();
    setAuthError('');
  };

  const homeFor = (user) => (
    user?.userType === 'superadmin' || user?.userType === 'admin' ? '/admin' : '/dashboard'
  );

  const signinUser = async ({ identifier, password }) => {
    let result;
    try {
      result = await api('/api/signin', { method: 'POST', body: { identifier, password }, auth: false });
    } catch (err) {
      setAuthError(err.message || 'Sign-in failed');
      return false;
    }
    const { token, user } = result;
    setToken(token);
    setCurrentUser(user);
    writeBootCache(token, user);
    clearExplicitLogout();
    setAuthError('');
    // Honor ?next= so route guards round-trip correctly.
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    navigate(next && next.startsWith('/') ? next : homeFor(user), { replace: true });
    return true;
  };

  // --- Self-signup with email OTP verification --------------------------
  // Step 1: send-otp validates the form and emails a 6-digit code (no user
  // row exists yet). Step 2: verify-otp confirms the code, which is what
  // actually creates the account and starts a session — mirrors signinUser's
  // ?next= handling so a signup started from a deep link still lands there.
  const signupSendOtp = async ({ name, company, email, password }) => {
    try {
      const result = await api('/api/auth/send-otp', {
        method: 'POST',
        body: { name, company, email, password },
        auth: false,
      });
      setAuthError('');
      return { ok: true, ...result };
    } catch (err) {
      setAuthError(err.message || 'Could not send verification code');
      return { ok: false };
    }
  };

  const signupVerifyOtp = async ({ email, otp }) => {
    let result;
    try {
      result = await api('/api/auth/verify-otp', { method: 'POST', body: { email, otp }, auth: false });
    } catch (err) {
      setAuthError(err.message || 'Verification failed');
      return false;
    }
    const { token, user } = result;
    setToken(token);
    setCurrentUser(user);
    writeBootCache(token, user);
    clearExplicitLogout();
    setAuthError('');
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    navigate(next && next.startsWith('/') ? next : homeFor(user), { replace: true });
    return true;
  };

  const signupResendOtp = async ({ email }) => {
    try {
      const result = await api('/api/auth/resend-otp', { method: 'POST', body: { email }, auth: false });
      setAuthError('');
      return { ok: true, ...result };
    } catch (err) {
      setAuthError(err.message || 'Could not resend code');
      return { ok: false };
    }
  };

  const signoutUser = async () => {
    try { await api('/api/signout', { method: 'POST' }); } catch {}
    setToken('');
    clearBootCache();
    markExplicitLogout();
    setCurrentUser(null);
    navigate('/signin', { replace: true });
  };

  // === Idle auto-logout ====================================================
  // Sign the user out after IDLE_MS of no activity. `lastActivity` lives in
  // localStorage so the timer survives reloads and is shared across tabs.
  // The server enforces the same window (sliding session expiry), so a token
  // can't be reused after idling even if this timer never runs.
  const IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — long enough to never interrupt normal use
  const IDLE_KEY = '9278.lastActivity';

  const idleLogout = async () => {
    try { await api('/api/signout', { method: 'POST' }); } catch {}
    try { localStorage.removeItem(IDLE_KEY); } catch {}
    setToken('');
    clearBootCache();
    markExplicitLogout();
    setCurrentUser(null);
    navigate('/signin?timeout=1', { replace: true });
  };

  useEffect(() => {
    if (!currentUser) return;
    const stamp = () => { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch {} };
    stamp();   // seed on login / mount

    let lastStamp = Date.now();
    let lastPing  = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastStamp > 5000) { lastStamp = now; stamp(); }   // throttle LS writes to 5s
      // Keepalive: slide the server session while the user is active even if
      // they're only reading (no other API calls). At most once / 5 min.
      if (now - lastPing > 5 * 60 * 1000) {
        lastPing = now;
        api('/api/session/ping', { method: 'POST' }).catch(() => {});
      }
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const tick = setInterval(() => {
      let last = 0;
      try { last = Number(localStorage.getItem(IDLE_KEY)) || 0; } catch {}
      if (last && Date.now() - last >= IDLE_MS) idleLogout();
    }, 30 * 1000);   // check every 30s

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const updateCurrentUser = async (patch) => {
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: patch });
      setCurrentUser(user);
      writeBootCache(getToken(), user);
      return true;
    } catch (e) {
      setAuthError(e.message || 'Update failed');
      return false;
    }
  };

  const changePassword = async ({ current, next }) => {
    try {
      await api('/api/me/password', { method: 'POST', body: { current, next } });
      setAuthError('');
      return true;
    } catch (e) {
      setAuthError(e.message || 'Password change failed');
      return false;
    }
  };

  const deleteCurrentAccount = async () => {
    try { await api('/api/twilio/number', { method: 'DELETE' }); } catch {}
    try { await api('/api/me', { method: 'DELETE' }); } catch {}
    setToken('');
    clearBootCache();
    markExplicitLogout();
    setCurrentUser(null);
    navigate('/signin', { replace: true });
  };

  return (
    <AppContext.Provider
      value={{
        bootstrapping,
        signup, updateSignup,
        establishSession,
        currentUser,
        signinUser, signoutUser, updateCurrentUser, changePassword, deleteCurrentAccount,
        signupSendOtp, signupVerifyOtp, signupResendOtp,
        authError, setAuthError,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);