import { lazy, Suspense, Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext.jsx';
import Header from './components/Header.jsx';
import Home from './surfaces/Home.jsx';
import Terms from './surfaces/Terms.jsx';
import Privacy from './surfaces/Privacy.jsx';
import Signin from './surfaces/Signin.jsx';
import Signup from './surfaces/Signup.jsx';

// Each surface (and everything it pulls in — a few dozen sub-pages apiece)
// is its own chunk, loaded only once a signed-in user actually lands on it.
// A visitor never needs Admin's or Reseller's code, and vice versa.
const Customer = lazy(() => import('./surfaces/customer/Customer.jsx'));
const Admin = lazy(() => import('./surfaces/admin/Admin.jsx'));
const Reseller = lazy(() => import('./surfaces/reseller/Reseller.jsx'));

function Loading() {
  return <main className="px-6 py-24 text-center text-mute text-sm">Loading session…</main>;
}

// Without this, an error thrown while rendering a page (or a failed lazy
// chunk load) just unmounts everything with no visible feedback — the
// screen goes blank and, depending on the error, the console may not even
// show anything actionable. This surfaces it directly instead.
class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: '' };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[RouteErrorBoundary]', error, info);
    this.setState({ componentStack: info?.componentStack || '' });
  }
  render() {
    if (this.state.error) {
      return (
        <main className="px-6 py-24 max-w-2xl mx-auto text-center">
          <h1 className="text-lg font-bold text-slate-900">Something went wrong loading this page.</h1>
          <p className="mt-2 text-sm text-mute">{this.state.error?.message || String(this.state.error)}</p>
          {this.state.componentStack && (
            <pre className="mt-4 max-w-full overflow-x-auto rounded-lg bg-slate-50 border border-slate-200 p-3 text-left text-xs text-slate-600 whitespace-pre-wrap">
              {this.state.componentStack}
            </pre>
          )}
          <button
            type="button"
            onClick={() => { this.setState({ error: null, componentStack: '' }); window.location.reload(); }}
            className="mt-5 btn-teal text-sm py-2 px-4"
          >
            Reload page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

// The seeded/legacy admin row can have role='admin' while userType still
// sits at the users.user_type column's default ('user') if it was never set
// explicitly on insert — effectiveTier folds that legacy field in so a
// route's tier check agrees with homeFor() instead of fighting it (that
// mismatch used to send this exact account into an infinite /admin <->
// /admin redirect loop).
const effectiveTier = (user) => {
  if (!user) return null;
  if (user.userType === 'superadmin' || user.userType === 'admin') return user.userType;
  if (user.role === 'admin') return 'admin';
  return user.userType || 'user';
};

// Where each tier lands after signin. Source of truth — used by GuestOnly,
// RequireAuth, and any other "go home" jump.
const homeFor = (user) => {
  if (!user) return '/dashboard';
  const tier = effectiveTier(user);
  if (tier === 'superadmin' || tier === 'admin') return '/admin';
  // Sub-resellers share the same surface as resellers — they see their own
  // customers / purchases / plans, and can on-board further sub-resellers.
  if (tier === 'reseller' || tier === 'sub-reseller') return '/reseller';
  return '/dashboard';
};

function RequireAuth({ children, allow }) {
  const { currentUser, bootstrapping } = useApp();
  const location = useLocation();
  if (bootstrapping) return <Loading />;
  if (!currentUser) {
    return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  // `allow` is a Set of tiers this route accepts. If the user's tier isn't in
  // it, bounce to their natural home.
  if (allow && !allow.has(effectiveTier(currentUser))) {
    return <Navigate to={homeFor(currentUser)} replace />;
  }
  return children;
}

function GuestOnly({ children }) {
  const { currentUser, bootstrapping } = useApp();
  if (bootstrapping) return <Loading />;
  if (currentUser) return <Navigate to={homeFor(currentUser)} replace />;
  return children;
}

function AppRoutes() {
  const { bootstrapping } = useApp();
  if (bootstrapping) return <Loading />;
  return (
    <RouteErrorBoundary>
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/" element={<Home />} />

      {/* Legal pages — public, accessible from any footer link. */}
      <Route path="/terms"   element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />

      <Route path="/signin" element={<GuestOnly><Signin /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
      <Route path="/signup/:step" element={<Navigate to="/signup" replace />} />

      {/* Customer dashboard: /dashboard/<tab> — tier 'user' (and superadmins
          impersonating, which is admin-routed elsewhere). */}
      <Route path="/dashboard" element={<Navigate to="/dashboard/overview" replace />} />
      <Route
        path="/dashboard/:tab"
        element={
          <RequireAuth allow={new Set(['user', 'superadmin'])}>
            <Customer />
          </RequireAuth>
        }
      />

      {/* Reseller dashboard: /reseller/<tab> — tier 'reseller'. */}
      <Route path="/reseller" element={<Navigate to="/reseller/customers" replace />} />
      <Route
        path="/reseller/:tab"
        element={
          <RequireAuth allow={new Set(['reseller', 'sub-reseller', 'superadmin'])}>
            <Reseller />
          </RequireAuth>
        }
      />

      {/* Admin: /admin/<tab> — tiers 'superadmin' and 'admin'. The legacy
          role='admin' field on admin@9278.ai is still honoured. */}
      <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
      <Route
        path="/admin/:tab"
        element={
          <RequireAuth allow={new Set(['superadmin', 'admin'])}>
            <Admin />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </RouteErrorBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Header />
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  );
}