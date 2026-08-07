import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext.jsx';
import Logo from './Logo.jsx';

export default function Header() {
  const { currentUser, signoutUser } = useApp();
  const { pathname } = useLocation();
  // Customer/admin dashboards have their own top-right user widget (TopBar)
  // and their own sidebar with branding, so the global header would be a
  // duplicate "Sign out" + avatar chip. Hide it there.
  // Signin/Signup are public but each fills the page with its own form and
  // has its own cross-link to the other, so the global header would just be
  // redundant chrome above it — hide it there too. Same for the homepage,
  // which has its own full nav bar (logo, links, Log In / Get Started).
  if (
    pathname === '/' ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/reseller') ||
    pathname.startsWith('/signin') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/privacy')
  ) return null;
  // Pick the natural home per tier — superadmin/admin → /admin, reseller →
  // /reseller, otherwise customer dashboard. Used by the unreachable logo
  // click here on public pages, but kept aligned with the rest of the app.
  const home = !currentUser
    ? '/'
    : currentUser.userType === 'reseller'
      ? '/reseller'
      : (currentUser.role === 'admin' || currentUser.userType === 'superadmin')
        ? '/admin'
        : '/dashboard';
  const initials = (currentUser?.name || currentUser?.email || '?')
    .split(/[\s@]/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

  return (
    <header className="glass sticky top-0 z-30">
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link to={home} className="cursor-pointer flex items-center" aria-label="Home">
          <Logo />
        </Link>

        <div className="flex items-center gap-2">
          {currentUser ? (
            <>
              <div className="hidden sm:flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border border-slate-200 bg-white shadow-sm">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                  style={{
                    background: 'linear-gradient(135deg, var(--grad-start), var(--grad-end))',
                  }}
                >
                  {initials}
                </div>
                <div className="leading-tight text-right">
                  <div className="text-xs font-semibold text-slate-900">{currentUser.name || currentUser.username}</div>
                  <div className="text-[10px] text-mute">
                    {currentUser.role === 'admin' ? 'Admin' : (currentUser.company || 'Customer')}
                  </div>
                </div>
              </div>
              <button
                onClick={signoutUser}
                className="px-3 py-1.5 rounded-full text-xs font-semibold border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-sm"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/dashboard/overview" className="btn-teal text-sm py-2 px-4">
                Open dashboard →
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}