import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, FlaskConical, CreditCard, Zap,
  Receipt, User, UserCircle, Menu, Wrench, Ticket, DoorOpen, Tag,
  List, Terminal, Server, Check, Copy, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { readCache, writeCache } from '../../utils/swrCache.js';
import { AddNumberModal } from '../customer/Numbers.jsx';
import Logo from '../../components/Logo.jsx';
import Footer from '../../components/Footer.jsx';
import BookingIcon from '../../components/BookingIcon.jsx';

// Every tab body is its own chunk — a visitor on Overview never downloads
// Settings/Bulk-import/Plans code, and vice versa.
const Signups = lazy(() => import('./Signups.jsx'));
const Customers = lazy(() => import('./Customers.jsx'));
const CustomersAtRisk = lazy(() => import('./CustomersAtRisk.jsx'));
const Resellers = lazy(() => import('./Resellers.jsx'));
const Numbers = lazy(() => import('./Numbers.jsx'));
const Payments = lazy(() => import('./Payments.jsx'));
const Bulk = lazy(() => import('./Bulk.jsx'));
const Logs = lazy(() => import('./Logs.jsx'));
const Plans = lazy(() => import('./Plans.jsx'));
const Settings = lazy(() => import('./Settings.jsx'));
const Account = lazy(() => import('../customer/Account.jsx'));
const Reports = lazy(() => import('./Reports.jsx'));
const Overview = lazy(() => import('../customer/Overview.jsx'));
const AgentsList = lazy(() => import('../customer/AgentsList.jsx'));
const AgentDetail = lazy(() => import('../customer/AgentDetail.jsx'));
const ChatAgentDetail = lazy(() => import('../customer/ChatAgentDetail.jsx'));
const Templates = lazy(() => import('../customer/Templates.jsx'));
const Analytics = lazy(() => import('../customer/Analytics.jsx'));
const Transactions = lazy(() => import('../customer/Transactions.jsx'));
const Pricing = lazy(() => import('../customer/Pricing.jsx'));
const BookingHistory = lazy(() => import('../customer/BookingHistory.jsx'));
const Tickets = lazy(() => import('../customer/Tickets.jsx'));
const TicketDetail = lazy(() => import('../customer/TicketDetail.jsx'));
const Tools = lazy(() => import('../customer/Tools.jsx'));

// Sidebar nav — unified across Admin/Customer to a common shape. Each entry
// maps onto the closest existing admin page; some concepts still don't have
// a dedicated admin screen and share a page with a nearby entry instead.
// Split around "Call Activity" so the collapsible group renders inline,
// right where the flat "Call Activity" entry used to sit (between Analytics
// and Reports) instead of at the end of the list.
const NAV_TABS_BEFORE_CALLS = [
  { id: 'overview',    label: 'Signups',        Icon: LayoutDashboard },
  { id: 'agents',      label: 'Customers',      Icon: User },
  { id: 'playground',  label: 'Subscription Alerts', Icon: FlaskConical },
  { id: 'resellers',   label: 'Resellers',      Icon: UserCircle },
  { id: 'analytics',   label: 'Payments & revenue', Icon: CreditCard },
];
const NAV_TABS_AFTER_CALLS = [
  { id: 'health',       label: 'System health',     Icon: Server },
  { id: 'billing',      label: 'Billing & minutes', Icon: CreditCard },
  { id: 'pricing',      label: 'Plans & pricing',   Icon: Tag },
  { id: 'transactions', label: 'Transactions',      Icon: Receipt },
  // Platform-wide ops tools — previously legacy-only (URL-reachable but not
  // in the visible nav); promoted back per explicit request since they were
  // the two things missing that this tier actually needs day to day.
  { id: 'numbers',      label: 'Numbers Inventory', Icon: List },
  { id: 'mcp',          label: 'MCP Browser',       Icon: Terminal },
  // "Profile" and "Account" used to be two tabs whose labels were swapped
  // relative to what they rendered (Profile -> <Account />, Account ->
  // <Settings />). Now Account is the single place for your own profile,
  // password, and danger zone; the credentials page keeps its own honest
  // "Settings" label.
  { id: 'account',      label: 'Account',           Icon: User },
  { id: 'settings',     label: 'Settings',          Icon: UserCircle },
];
const NAV_TABS = [...NAV_TABS_BEFORE_CALLS, ...NAV_TABS_AFTER_CALLS];

// "Call Activity" is a collapsible sidebar group: its own page (Logs) plus
// three sub-pages that nest under it. "Tools" reuses the same card-grid
// Tools page as the customer dashboard; the MCP tool browser stays
// reachable at its legacy /admin/mcp link (distinct from the "Playground"
// nav entry above, which is the agent test/tune page shared with Customer).
const ACTIVITY_LOG = { id: 'logs', label: 'Activity Log', Icon: Zap };

// Legacy Call Activity routes remain valid for existing deep links.
const CALL_ACTIVITY = { id: 'calls', label: 'Call Activity', Icon: Zap };
const CALL_ACTIVITY_CHILDREN = [
  { id: 'booking-history', label: 'Booking History', Icon: BookingIcon },
  { id: 'tools',           label: 'Tools',           Icon: Wrench },
  { id: 'tickets',         label: 'Tickets',         Icon: Ticket },
];

// Legacy tab ids from the previous Operations/Reports/Setup layout — kept
// valid (but not shown in the sidebar) so any existing bookmark or deep link
// still resolves to the right page instead of 404ing. Text-only (no icon —
// they never render in the Side loop, just the mobile page-title fallback).
const LEGACY_TABS = [
  { id: 'signups',      label: 'Signups' },
  { id: 'customers',    label: 'Customers' },
  { id: 'resellers',    label: 'Resellers' },
  { id: 'payments',     label: 'Payments & revenue' },
  { id: 'bulk',         label: 'Bulk import' },
  { id: 'logs',         label: 'Activity logs' },
  { id: 'usage',        label: 'Usage analytics' },
  { id: 'reports',      label: 'Reports' },
  { id: 'plans',        label: 'Plans & pricing' },
  // 'profile' was its own nav tab until Account absorbed it — keep the id
  // valid so old links/bookmarks land on Account instead of bouncing to
  // Overview. ('settings' is a real nav tab now, so it's no longer listed
  // here.)
  { id: 'profile',      label: 'Account' },
  // Reached by clicking a row on the Agents list — not a nav item itself.
  { id: 'agent-detail',      label: 'Agent' },
  { id: 'agent-detail-chat', label: 'Chat Agent' },
  { id: 'templates',         label: 'Browse Templates' },
  // Reached by clicking a row on the Tickets list — not a nav item itself.
  { id: 'ticket-detail',     label: 'Ticket' },
];

const VALID_TABS = new Set([
  // NAV_TABS
  'overview', 'agents', 'playground', 'analytics',
  'reports', 'billing', 'pricing', 'transactions', 'account', 
  'numbers', 'mcp', 'settings',
  // CALL_ACTIVITY
  'calls',
  // CALL_ACTIVITY_CHILDREN
  'booking-history', 'tools', 'tickets',
  // LEGACY_TABS
  'signups', 'customers', 'resellers', 'payments', 'bulk', 
  'logs', 'usage', 'health', 'plans', 'profile', 
  'agent-detail', 'agent-detail-chat', 'templates', 'ticket-detail'
]);

export default function Admin() {
  const { currentUser, signoutUser } = useApp();
  const { tab } = useParams();
  const [navOpen, setNavOpen] = useState(false);
  // Sidebar collapse — admin-only, per explicit request (superadmin keeps
  // the sidebar fixed). isAdminTier gates every piece of the feature below.
  const isAdminTier = currentUser?.userType === 'admin';
  const [navCollapsed, setNavCollapsed] = useState(false);   // desktop-only: hides the sidebar entirely
  const [showAddPlan, setShowAddPlan] = useState(false);
  const callActivityActive = tab === CALL_ACTIVITY.id || CALL_ACTIVITY_CHILDREN.some((t) => t.id === tab);
  const [callActivityOpen, setCallActivityOpen] = useState(callActivityActive);

  useEffect(() => { setNavOpen(false); }, [tab]);

  const [scrollPct, setScrollPct] = useState(0);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setScrollPct(max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [tab]);
  useEffect(() => { if (callActivityActive) setCallActivityOpen(true); }, [callActivityActive]);

  if (!VALID_TABS.has(tab)) return <Navigate to="/admin/overview" replace />;

  const Side = ({ list }) => list.map((t) => (
    <Link
      key={t.id}
      to={`/admin/${t.id}`}
      className={tab === t.id ? 'active' : ''}
    >
      {t.Icon && <t.Icon size={16} strokeWidth={2} />} {t.label}
    </Link>
  ));

  const activeTab = [...NAV_TABS, CALL_ACTIVITY, ...CALL_ACTIVITY_CHILDREN, ...LEGACY_TABS].find((t) => t.id === tab);
  const activeLabel = activeTab?.label || '';
  const ActiveIcon = activeTab?.Icon;

  return (
    <div className={`dashboard-shell ${isAdminTier && navCollapsed ? 'nav-collapsed' : ''}`}>
      {navOpen && <div className="mobile-nav-backdrop" onClick={() => setNavOpen(false)} />}

      <aside className={`sidenav ${navOpen ? 'is-open' : ''}`}>
        <div className="h-16 flex items-center gap-1.5 px-3 bg-white sticky top-0 z-30">
          <Link to="/admin/overview" className="flex items-center gap-2 min-w-0" aria-label="Conciva AI home">
            <Logo size={48} />
          </Link>
          {isAdminTier && (
            <button
              type="button"
              className="hidden lg:inline-flex ml-auto shrink-0 w-6 h-6 items-center justify-center rounded-md text-mute hover:bg-slate-100 hover:text-slate-900 text-xs"
              onClick={() => setNavCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              «
            </button>
          )}
        </div>
        <div className="px-4 pb-3 border-t border-slate-100 pt-3">
          {/* The role appeared twice here — a plain "ADMIN" caption above the
              email and a pill below it. Keep the pill (it carries the actual
              role, not a hardcoded label) and move it above the email. */}
          <span className="pill pill-teal inline-block">{currentUser?.role || 'Admin'}</span>
          <div className="text-sm font-semibold text-slate-900 mt-2 break-all">{currentUser?.email || ''}</div>
        </div>
        <div className="sidenav-section">Manage</div>
        <Side list={NAV_TABS_BEFORE_CALLS} />

        <Side list={[ACTIVITY_LOG]} />

        <Side list={NAV_TABS_AFTER_CALLS} />

        <div className="mt-2 pt-2 border-t border-black">
          <button type="button" onClick={signoutUser} className="nav-group-toggle nav-logout">
            <DoorOpen size={16} strokeWidth={2} /> Log out
          </button>
        </div>
      </aside>

      <div className="dashboard-main">
        {/* Sticky top bar — same shape + height as the customer dashboard so
            the divider line under the sidebar logo continues across the
            entire page width. No user-avatar widget here anymore — Sign Out
            isn't reachable from the UI (see Customer.jsx for the same note). */}
        <div className="relative sticky top-0 z-30 bg-white -mt-5 sm:-mt-6 lg:-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3 border-b border-slate-200 mb-6">
          <button
            className="mobile-nav-toggle lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={16} /> Menu
          </button>
          {isAdminTier && navCollapsed && (
            <button
              type="button"
              className="sidenav-expand-btn"
              onClick={() => setNavCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              »
            </button>
          )}
          {/* Page icon + title, sourced from the same nav-tab lookup that
              drives the sidebar — was previously duplicated as a big heading
              inside every page component; lives once, here, for every tab.
              One <h1> in the DOM at every width (not two elements toggled by
              visibility — that would leave zero h1s on mobile). Below `lg`
              the "Menu" button plus the right-side actions leave very little
              room, so the icon shrinks to inline and the title drops back to
              the small uppercase label the mobile header always used. */}
          <div className="flex-1 min-w-0 flex items-center gap-1.5 lg:gap-2.5">
            {ActiveIcon && (
              <>
                <ActiveIcon size={14} strokeWidth={2} className="lg:hidden shrink-0" />
                <span className="hidden lg:flex w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--grad-start)] to-[var(--grad-end)] items-center justify-center text-white shrink-0">
                  <ActiveIcon className="w-4 h-4" />
                </span>
              </>
            )}
            <h1 className="text-xs lg:text-lg font-semibold lg:font-bold uppercase lg:normal-case tracking-wider lg:tracking-normal text-mute lg:text-slate-900 lg:dark:text-slate-100 truncate">
              {activeLabel}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <button type="button" className="btn-teal text-sm whitespace-nowrap" onClick={() => setShowAddPlan(true)}>
              <span className="sm:hidden">+ Add</span>
              <span className="hidden sm:inline">+ Add plan / number</span>
            </button>
          </div>
         <div className="absolute left-0 bottom-0 h-[3px] bg-orange-500 transition-[width] duration-200 ease-linear" style={{ width: `${scrollPct}%` }} />
        </div>

        {/* New nav ids map onto the closest existing page; legacy ids (kept
            valid so old links still work) render the same pages they always
            did. Resellers / Plans & pricing still have no home in the main
            nav — still reachable at their legacy URLs (Numbers Inventory and
            MCP Browser were promoted back into the visible nav above).
            'overview' reuses the same Overview component as the Customer
            dashboard (per explicit request — same page for every tier); it
            renders mostly empty states for admin accounts since they don't
            carry their own number/plan/agent. 'signups' keeps the original
            admin landing page reachable at its legacy URL. */}
        <Suspense fallback={<div className="text-sm text-mute py-10 text-center">Loading…</div>}>
        {tab === 'overview'                             && <Signups />}
        {tab === 'signups'                              && <Signups />}
        {tab === 'agents'                                && <Customers />}
        {tab === 'customers'                             && <Customers />}
        {tab === 'tools'                                 && <Tools />}
        {tab === 'playground'                            && <CustomersAtRisk />}
        {tab === 'mcp'                                    && <McpBrowser />}
        {tab === 'bulk'                                  && <Bulk />}
        {tab === 'analytics'                             && <Payments />}
        {tab === 'usage'                                 && <Usage />}
        {(tab === 'calls' || tab === 'logs')            && <Logs />}
        {tab === 'reports'                               && <Reports />}
        {tab === 'health'                                && <Health />}
        {(tab === 'billing' || tab === 'payments')      && <Payments />}
        {tab === 'transactions'                          && <Transactions />}
        {tab === 'pricing'                               && <Pricing />}
        {tab === 'settings'                              && <Settings />}
        {/* /admin/profile kept as an alias so old links/bookmarks still land
            somewhere sensible now that the Profile tab itself is gone. */}
        {(tab === 'account' || tab === 'profile')       && <Account />}
        {tab === 'resellers'     && <Resellers />}
        {tab === 'numbers'       && <Numbers />}
        {tab === 'plans'         && <Plans />}
        {tab === 'booking-history' && <BookingHistory />}
        {tab === 'tickets'       && <Tickets />}
        {tab === 'ticket-detail' && <TicketDetail />}
        {tab === 'agent-detail'  && <AgentDetail />}
        {tab === 'agent-detail-chat' && <ChatAgentDetail />}
        {tab === 'templates'     && <Templates />}
        </Suspense>

        <div className="pt-10 -mx-4 sm:-mx-6 lg:-mx-8">
          <Footer />
        </div>

      </div>

      {showAddPlan && (
        <AddNumberModal
          currentUser={currentUser}
          onClose={() => setShowAddPlan(false)}
          onAdded={() => setShowAddPlan(false)}
        />
      )}
    </div>
  );
}

function Usage() {
  const { currentUser } = useApp();
  const [vol, setVol] = useState(() => readCache('admin.usage.volume', currentUser?.id));
  const [perf, setPerf] = useState(() => readCache('admin.usage.performance', currentUser?.id));
  const [days, setDays] = useState(7);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (d = days) => {
    setErr(''); setLoading(true);
    try {
      const [v, p] = await Promise.all([
        api(`/api/mcp/call-volume?days=${d}`),
        api(`/api/mcp/agent-performance?days=${d}`),
      ]);
      const nextVol = v.data || null;
      const nextPerf = Array.isArray(p.data) ? p.data : (p.data?.agents || []);
      setVol(nextVol);
      setPerf(nextPerf);
      writeCache('admin.usage.volume', currentUser?.id, nextVol);
      writeCache('admin.usage.performance', currentUser?.id, nextPerf);
    } catch (e) {
      setErr(e.message);
      setVol((prev) => prev ?? null);
      setPerf((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(days); }, [days]);

  const fmtSec = (s) => {
    if (!s) return '0s';
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return m ? `${m}m ${sec}s` : `${sec}s`;
  };
  const avgPerDay = vol && vol.total_calls != null
    ? (Number(vol.total_calls) / Math.max(1, days)).toFixed(1)
    : '—';

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usage analytics</h1>
          <p className="text-mute mt-2">
            Per-agent performance pulled live from 9278 via MCP.
            {loading && perf !== null && <span className="text-xs text-mute ml-2">Refreshing…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input"
            style={{ width: 130 }}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button className="btn-ghost btn-ghost-accent text-sm" onClick={() => load(days)} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>
      {err && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}

      <div className="mt-6 grid sm:grid-cols-4 gap-4">
        <Tile label={`Calls (${days}d)`}     value={vol?.total_calls ?? '—'} />
        <Tile label="Answer rate"            value={vol?.answer_rate != null ? `${vol.answer_rate}%` : '—'} />
        <Tile label="Avg per day"            value={avgPerDay} />
        <Tile label="Total minutes"          value={vol?.total_minutes != null ? Number(vol.total_minutes).toFixed(1) : '—'} />
      </div>

      {vol?.daily_breakdown?.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-3">Daily volume</h2>
          <div className="form-card p-0 overflow-x-auto">
            <table>
              <thead><tr><th>Date</th><th>Calls</th><th>Minutes</th></tr></thead>
              <tbody>
                {vol.daily_breakdown.map((d) => (
                  <tr key={d.date}>
                    <td className="font-mono text-xs">{d.date}</td>
                    <td>{d.count}</td>
                    <td>{Number(d.minutes || 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold">Agent performance</h2>
      <div className="mt-3 form-card p-0 overflow-x-auto">
        <table>
          <thead><tr><th>Agent</th><th>Calls</th><th>Answered</th><th>Avg duration</th><th>Success</th></tr></thead>
          <tbody>
            {perf === null && <tr><td colSpan={5} className="text-center text-mute py-6">Loading…</td></tr>}
            {perf !== null && (perf?.length ?? 0) === 0 && (
              <tr><td colSpan={5} className="text-center text-mute py-6">No agent activity in the last {days}d.</td></tr>
            )}
            {(perf || []).map((a, i) => (
              <tr key={a.agent_id || a.agent_name || i}>
                <td>{a.agent_name || a.name || a.slug || '—'}</td>
                <td>{a.total_calls ?? a.call_count ?? 0}</td>
                <td className="text-mute">{a.answered_calls ?? '—'}</td>
                <td>{fmtSec(a.avg_duration_seconds || a.avg_duration || 0)}</td>
                <td className={a.success_rate >= 90 ? 'text-lime-400' : a.success_rate >= 50 ? 'text-amber-400' : 'text-mute'}>
                  {a.success_rate != null ? `${a.success_rate}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="form-card">
      <div className="text-sm text-mute">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </div>
  );
}

function ServiceCard({ svc }) {
  const running = svc.status === 'running';
  const memPct = svc.memory_limit_mb ? Math.min(100, (svc.memory_used_mb / svc.memory_limit_mb) * 100) : 0;
  const cpuPct = svc.cpu_limit_percent ? Math.min(100, (svc.cpu_percent / svc.cpu_limit_percent) * 100) : 0;

  return (
    <div className="form-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{svc.display_name || svc.name}</div>
          {svc.description && <div className="text-xs text-mute mt-0.5">{svc.description}</div>}
        </div>
        <span className={`pill text-[10px] shrink-0 inline-flex items-center gap-1 ${running ? 'bg-lime-100 text-lime-700' : 'bg-red-100 text-red-700'}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? 'bg-lime-500 animate-pulse' : 'bg-red-500'}`} />
          {running ? 'Running' : (svc.status || 'stopped')}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-mute font-mono truncate">{svc.service_type} · {svc.service_name}</div>

      <div className="mt-3 space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-[11px] text-mute mb-1">
            <span>Memory</span>
            <span>{Number(svc.memory_used_mb ?? 0).toFixed(0)} / {svc.memory_limit_mb ?? '—'} MB</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-lime-500 rounded-full transition-all" style={{ width: `${memPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-mute mb-1">
            <span>CPU</span>
            <span>{svc.cpu_percent ?? 0}% / {svc.cpu_limit_percent ?? 100}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${cpuPct}%` }} />
          </div>
        </div>
      </div>

      {(svc.can_restart || svc.can_edit_limits || svc.can_update) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {svc.can_restart && <span className="pill text-[9px] bg-slate-100 text-slate-600">Restartable</span>}
          {svc.can_edit_limits && <span className="pill text-[9px] bg-slate-100 text-slate-600">Editable limits</span>}
          {svc.can_update && <span className="pill text-[9px] bg-slate-100 text-slate-600">Updatable</span>}
        </div>
      )}
    </div>
  );
}

function Health() {
  const { currentUser } = useApp();
  const cached = readCache('admin.health', currentUser?.id);
  const [health, setHealth] = useState(cached?.health ?? null);
  const [mcpStatus, setMcpStatus] = useState(cached?.mcpStatus ?? null);
  const [services, setServices] = useState(cached?.services ?? null);
  const [twilio, setTwilio] = useState(cached?.twilio ?? null);
  const [db, setDb] = useState(cached?.db ?? null);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const [h, s, t, d, ms] = await Promise.all([
        api('/api/mcp/system-health').catch(() => null),
        api('/api/mcp/service-status').catch(() => null),
        api('/api/twilio/status', { auth: false }),
        api('/api/health', { auth: false }),
        api('/api/mcp/status').catch(() => null),
      ]);
      const next = { health: h?.data || null, mcpStatus: ms, services: s?.data || null, twilio: t, db: d };
      setHealth(next.health);
      setMcpStatus(next.mcpStatus);
      setServices(next.services);
      setTwilio(next.twilio); setDb(next.db);
      writeCache('admin.health', currentUser?.id, next);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const mcpOk = !!(health || mcpStatus?.configured);
  const mcpLabel = health ? '● Healthy' : mcpStatus?.configured ? '● Connected' : '○ Down';
  const mcpColor = mcpOk ? 'text-lime-400' : 'text-red-400';

  return (
    <div>
      <div className="flex items-center justify-end">
        <button className="btn-ghost btn-ghost-accent text-sm" onClick={load}>↻ Refresh</button>
      </div>
      {err && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}

      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <div className="form-card">
          <div className="text-sm text-mute">MCP health</div>
          <div className={`mt-1 text-xl font-semibold ${mcpColor}`}>
            {mcpLabel}
          </div>
          {health?.uptime && (
            <div className="text-xs text-mute mt-2">
              Uptime {health.uptime.days}d · CPU {health.cpu_avg?.['1min']} · {health.processes?.total} procs
            </div>
          )}
          {!health && mcpStatus?.configured && (
            <div className="text-xs text-mute mt-2">MCP connected · system stats unavailable</div>
          )}
        </div>
        <div className="form-card">
          <div className="text-sm text-mute">API health</div>
          <div className={`mt-1 text-xl font-semibold ${twilio?.configured ? 'text-lime-400' : 'text-red-400'}`}>
            {twilio?.configured ? '● Healthy' : '○ Down'}
          </div>
          <div className="text-xs text-mute mt-2">Twilio · {twilio?.defaultNumber || '—'}</div>
        </div>
        <div className="form-card">
          <div className="text-sm text-mute">Database health</div>
          <div className={`mt-1 text-xl font-semibold ${db?.ok ? 'text-lime-400' : 'text-red-400'}`}>
            {db?.ok ? '● Healthy' : '○ Down'}
          </div>
          {db?.now && <div className="text-xs text-mute mt-2">Postgres · {new Date(db.now).toLocaleTimeString()}</div>}
        </div>
      </div>

      {health && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold">Hardware health</h2>
          <div className="mt-3 grid sm:grid-cols-4 gap-4">
            <Tile label="CPU 1m" value={`${health.cpu_avg?.['1min'] ?? '—'}`} />
            <Tile label="Memory" value={`${health.memory?.used_percent ?? '—'}%`} />
            <Tile label="Disk" value={`${health.disk?.used_percent ?? '—'}%`} />
            <Tile label="Uptime" value={`${health.uptime?.days ?? 0}d ${health.uptime?.hours ?? 0}h`} />
          </div>
          <div className="mt-3 text-xs text-mute">
            Memory {health.memory?.used_gb}/{health.memory?.total_gb} GB · Disk {health.disk?.used_gb}/{health.disk?.total_gb} GB · Net rx {health.network?.rx_formatted} / tx {health.network?.tx_formatted}
          </div>
        </div>
      )}

      {services && (() => {
        const list = Array.isArray(services) ? services : Array.isArray(services?.services) ? services.services : null;
        return (
          <div className="mt-8">
            <h2 className="text-lg font-semibold">9278 services</h2>
            {list ? (
              <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((svc) => <ServiceCard key={svc.name || svc.service_name} svc={svc} />)}
              </div>
            ) : (
              // Unrecognized shape — fall back to raw JSON rather than hiding it.
              <div className="mt-3 form-card">
                <pre className="text-xs leading-relaxed text-mute whitespace-pre-wrap">{JSON.stringify(services, null, 2)}</pre>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// Shown only when no real MCP server is configured (no DB/env MCP in this
// sandbox), same "never overrides real data" rule as Overview.jsx's DEMO_*
// constants — lets the page demonstrate its full layout instead of a dead
// empty state.
const DEMO_MCP_ENDPOINTS = [
  { key: 'demo-9278', label: 'dashboard.9278.ai (default)', url: 'https://dashboard.9278.ai/mcp', source: 'demo', portal: null },
];

const DEMO_MCP_TOOLS = [
  { name: 'list_agents', description: 'List all AI voice agents configured for this account, with status and phone number.' },
  { name: 'get_call_statistics', description: 'Aggregate call volume, answer rate, and average duration over a date range.' },
  { name: 'get_call_volume', description: 'Day-by-day call volume for the last 14 days, bucketed for charting.' },
  { name: 'get_sentiment', description: 'Caller sentiment breakdown (positive / neutral / negative) across recent calls.' },
  { name: 'get_agent_performance', description: 'Per-agent performance — calls handled, avg duration, resolution rate.' },
  { name: 'list_active_rooms', description: 'List currently active LiveKit rooms — agents on a live call right now.' },
  { name: 'get_system_health', description: 'Overall platform health check — database, telephony, and AI provider status.' },
  { name: 'list_sip_trunks', description: 'List configured SIP trunks and their registration status.' },
];

const DEMO_MCP_RESULTS = {
  list_agents: { agents: [{ id: 'ag_demo_1', name: 'KallUS Agent', number: '+27 82 555 0148', status: 'active' }] },
  get_call_statistics: { total_calls: 64, answered: 64, answer_rate: 1, avg_duration_seconds: 48 },
  get_call_volume: { days: Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10), count: [4, 7, 3, 9, 6, 11, 5][i] })) },
  get_sentiment: { positive: 0, neutral: 6, negative: 1, total_classified: 7 },
  get_agent_performance: { agents: [{ name: 'KallUS Agent', calls: 64, avg_duration_seconds: 48, resolution_rate: 1 }] },
  list_active_rooms: { rooms: [] },
  get_system_health: { database: 'unavailable (dev sandbox)', telephony: 'ok', ai_provider: 'ok' },
  list_sip_trunks: { trunks: [] },
};
const demoToolResult = (name) => DEMO_MCP_RESULTS[name] || { ok: true, demo: true, message: `Demo response for ${name}` };

// Parameter schema + display metadata for the Tool Details panel. Only known
// for the demo tool set above — real reseller MCP servers don't publish a
// schema via /api/mcp/tools (it only returns name+description), so unknown
// tools fall back to a raw-JSON arguments box instead of a guessed form.
const TOOL_META = {
  list_agents:           { category: 'Agents',    params: [], avgMs: 92 },
  get_call_statistics:   { category: 'Analytics', params: [{ key: 'startDate', label: 'Start Date', type: 'date' }, { key: 'endDate', label: 'End Date', type: 'date' }], avgMs: 145 },
  get_call_volume:       { category: 'Analytics', params: [{ key: 'startDate', label: 'Start Date', type: 'date' }, { key: 'endDate', label: 'End Date', type: 'date' }], avgMs: 168 },
  get_sentiment:         { category: 'Analytics', params: [{ key: 'days', label: 'Days', type: 'number' }], avgMs: 132 },
  get_agent_performance: { category: 'Agents',    params: [{ key: 'agentId', label: 'Agent ID', type: 'text' }], avgMs: 121 },
  list_active_rooms:     { category: 'Telephony', params: [], avgMs: 78 },
  get_system_health:     { category: 'System',    params: [], avgMs: 64 },
  list_sip_trunks:       { category: 'Telephony', params: [], avgMs: 88 },
};

function InfoItem({ label, value, valueClass }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${valueClass || 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function McpBrowser() {
  const { currentUser } = useApp();
  const [endpoints, setEndpoints] = useState(() => readCache('admin.mcp.endpoints', currentUser?.id) ?? null);    // list of { key, label, url, portal, source }
  const [endpoint, setEndpoint]   = useState('env');   // selected endpoint key
  const [tools, setTools]   = useState(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState(null);
  const [args, setArgs]     = useState('{}');
  const [paramValues, setParamValues] = useState({});
  const [result, setResult] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(null);
  const [runOk, setRunOk]   = useState(true);
  const [showFullResponse, setShowFullResponse] = useState(false);
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  // Add/edit MCP creds modal — superadmin can wire up a reseller's
  // dashboard.<their-domain>/mcp without going to the DB.
  const [editing, setEditing] = useState(null);        // null | { resellerPortal, url, token }
  const [editErr, setEditErr] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Load every MCP server superadmin can pick from (env-level + every
  // reseller with mcp_url + mcp_token set).
  useEffect(() => {
    (async () => {
      try {
        const r = await api('/api/admin/mcp/endpoints');
        const next = r.endpoints || [];
        setEndpoints(next);
        writeCache('admin.mcp.endpoints', currentUser?.id, next);
      } catch (e) {
        setEndpoints([]);
        setErr(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch the tool catalog whenever the picked endpoint changes. Guards
  // against the demo-mode switch (below) racing a still-in-flight real
  // fetch for the initial 'env' endpoint and clobbering the demo tools.
  useEffect(() => {
    let cancelled = false;
    setTools(null); setPicked(null); setResult(null); setErr('');
    if (endpoint.startsWith('demo-')) { setTools(DEMO_MCP_TOOLS); return; }
    (async () => {
      try {
        const r = await api(`/api/mcp/tools?endpoint=${encodeURIComponent(endpoint)}`);
        if (!cancelled) setTools(r.tools || []);
      } catch (e) {
        if (!cancelled) { setErr(e.message); setTools([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint]);

  // No real MCP server configured — fall back to a demo endpoint so the
  // page demonstrates its full layout instead of a dead empty state.
  const demoMode = endpoints !== null && endpoints.length === 0;
  useEffect(() => {
    if (demoMode && endpoint === 'env') setEndpoint(DEMO_MCP_ENDPOINTS[0].key);
  }, [demoMode]);
  const displayEndpoints = demoMode ? DEMO_MCP_ENDPOINTS : (endpoints || []);

  const meta = TOOL_META[picked] || null;

  const run = async () => {
    setErr('');
    setBusy(true);
    setResult(null);
    setShowFullResponse(false);
    let parsed = {};
    if (meta) {
      // Known schema — build args from the auto-generated field inputs.
      for (const p of meta.params) if (paramValues[p.key]) parsed[p.key] = paramValues[p.key];
    } else {
      try { parsed = JSON.parse(args); }
      catch (e) { setErr('Args must be valid JSON: ' + e.message); setBusy(false); return; }
    }
    const startedAt = performance.now();
    if (endpoint.startsWith('demo-')) {
      setTimeout(() => {
        setResult(demoToolResult(picked));
        setElapsedMs(Math.round(performance.now() - startedAt));
        setRunOk(true);
        setBusy(false);
      }, 500);
      return;
    }
    try {
      const r = await api('/api/mcp/call', {
        method: 'POST',
        body: { name: picked, args: parsed, endpoint },
      });
      setResult(r.result);
      setRunOk(true);
    } catch (e) {
      setErr(e.message);
      setRunOk(false);
    } finally {
      setElapsedMs(Math.round(performance.now() - startedAt));
      setBusy(false);
    }
  };

  const copySchema = () => {
    const schema = {
      name: picked,
      description: (tools || []).find((t) => t.name === picked)?.description || '',
      parameters: meta ? meta.params.map((p) => ({ key: p.key, type: p.type })) : 'unspecified — this MCP server does not publish a schema',
    };
    navigator.clipboard?.writeText(JSON.stringify(schema, null, 2)).then(() => {
      setSchemaCopied(true);
      setTimeout(() => setSchemaCopied(false), 1200);
    }).catch(() => {});
  };

  // Memoized — typing in the args/param editors below re-renders this
  // component on every keystroke, and shouldn't re-filter the whole tool
  // list each time (only `tools` or the search box actually affect it).
  const list = useMemo(
    () => (tools || []).filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase())),
    [tools, filter],
  );
  const active = displayEndpoints.find((e) => e.key === endpoint);

  const refreshEndpoints = async () => {
    const r = await api('/api/admin/mcp/endpoints');
    setEndpoints(r.endpoints || []);
  };

  const saveCreds = async () => {
    if (!editing) return;
    setEditErr(''); setEditBusy(true);
    try {
      await api('/api/admin/mcp/endpoints', {
        method: 'POST',
        body: {
          resellerPortal: editing.resellerPortal,
          url:   editing.url   || '',
          token: editing.token || '',
        },
      });
      setEditing(null);
      await refreshEndpoints();
    } catch (e) {
      setEditErr(e.message || 'Could not save MCP creds');
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">MCP browser</h1>
      <p className="text-mute">
        Run any tool exposed by a reseller's dashboard MCP server. Read-only tools are safe to explore.
      </p>

      {/* Endpoint picker — chips for every configured MCP server. */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-mute font-semibold">MCP server</div>
          <button
            onClick={() => setEditing({ resellerPortal: '', url: '', token: '' })}
            className="btn-ghost btn-ghost-accent text-xs whitespace-nowrap transition duration-200 ease-out hover:scale-105 active:scale-95"
          >
            + Add / update MCP
          </button>
        </div>
        {endpoints === null ? (
          <div className="text-sm text-mute">Loading endpoints…</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {displayEndpoints.map((ep) => {
              const isActive = ep.key === endpoint;
              return (
                <div
                  key={ep.key}
                  className={`px-3 py-2 rounded-lg text-left text-xs border transition relative ${
                    isActive
                      ? 'bg-lime-50 border-lime-400 text-lime-800 shadow-sm'
                      : 'bg-white border-slate-200 hover:border-lime-300 text-slate-700'
                  }`}
                >
                  <button onClick={() => setEndpoint(ep.key)} className="block text-left w-full">
                    <div className="flex items-center gap-2">
                      <span className={`pill text-[9px] uppercase tracking-wider font-semibold ${
                        ep.source === 'env' ? 'bg-emerald-500/15 text-emerald-700'
                          : ep.source === 'demo' ? 'bg-slate-200 text-slate-700'
                          : 'bg-purple-500/15 text-purple-700'
                      }`}>
                        {ep.source === 'env' ? 'default' : ep.source === 'demo' ? 'demo' : 'reseller'}
                      </span>
                      <span className="font-semibold">{ep.label}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-mute font-mono break-all pr-8">{ep.url}</div>
                  </button>
                  {ep.source === 'reseller' && (
                    <button
                      onClick={() => setEditing({
                        resellerPortal: ep.portal || '',
                        url:   ep.url || '',
                        token: '',
                      })}
                      className="absolute top-1 right-1 text-[10px] text-lime-600 hover:underline px-1"
                      title="Edit MCP URL / token for this reseller"
                    >
                      ✎ edit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 grid lg:grid-cols-[300px_1fr] gap-6">
        <div>
          <input
            className="input animate-fade-up transition duration-200 ease-out focus:shadow-md"
            placeholder="Filter tools…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="mt-2 text-[11px] text-mute">
            {tools === null ? 'Loading tools…' : `${list.length} of ${tools.length} tools`}
            {active ? ` · ${active.label}` : ''}
          </div>
          <div className="mt-3 max-h-[480px] overflow-y-auto border border-line rounded">
            {tools === null && <div className="p-3 text-sm text-mute">Loading…</div>}
            {tools?.length === 0 && <div className="p-3 text-sm text-mute">No tools.</div>}
            {list.map((t) => (
              <div
                key={t.name}
                onClick={() => {
                  setPicked(t.name); setArgs('{}'); setParamValues({}); setResult(null);
                  setErr(''); setElapsedMs(null); setShowFullResponse(false);
                }}
                className={`p-2 text-xs cursor-pointer border-b border-line ${picked === t.name ? 'bg-lime-50 text-lime-700' : 'hover:bg-slate-50'}`}
              >
                <div className="font-mono">{t.name}</div>
                <div className="text-mute mt-0.5 line-clamp-2">{(t.description || '').split('\n')[0].slice(0, 100)}</div>
              </div>
            ))}
          </div>
        </div>
        {/* === Tool Details panel ===================================== */}
        <div key={picked || 'empty'} className="animate-fade-up">
          {!picked ? (
            <div className="form-card rounded-2xl shadow-sm text-center py-14 px-6">
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--grad-start)] to-[var(--grad-end)] flex items-center justify-center">
                  <Wrench className="w-7 h-7 text-white" />
                </div>
                <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-lg bg-white border border-lime-200 shadow flex items-center justify-center">
                  <Server className="w-3.5 h-3.5 text-lime-700" />
                </div>
              </div>
              <div className="text-base font-bold text-slate-900">Select an MCP Tool</div>
              <p className="mt-1.5 text-sm text-mute max-w-xs mx-auto">
                Choose a tool from the left panel to inspect its details and execute it.
              </p>
              <div className="mt-5 flex flex-col items-center gap-1.5 text-xs text-slate-600">
                {['View description', 'See required parameters', 'Execute the tool', 'Inspect JSON response', 'Copy results'].map((f) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-lime-600 shrink-0" /> {f}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="form-card rounded-2xl shadow-sm p-5">
              {/* Header */}
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Tool Details</div>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <div className="font-mono text-base font-bold text-slate-900">{picked}</div>
                <span className="pill text-[10px] uppercase tracking-wider font-semibold bg-lime-500/15 text-lime-700">Read Only</span>
              </div>

              {/* Description */}
              <p className="mt-3 text-sm text-mute leading-relaxed">
                {(tools || []).find((t) => t.name === picked)?.description || 'No description provided.'}
              </p>

              {/* Info grid */}
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 py-4 border-y border-line">
                <InfoItem label="Category" value={meta?.category || 'General'} />
                <InfoItem label="Parameters" value={meta ? (meta.params.length ? `${meta.params.length} field${meta.params.length > 1 ? 's' : ''}` : 'None') : 'Unspecified'} />
                <InfoItem label="Returns" value="JSON" />
                <InfoItem label="Permission" value="Read Only" />
                <InfoItem label="Average Response" value={meta ? `${meta.avgMs} ms` : '—'} />
              </div>

              {/* Parameters — auto-generated form for known tools, raw JSON otherwise */}
              <div className="mt-4">
                <div className="field-label">Parameters</div>
                {meta ? (
                  meta.params.length === 0 ? (
                    <div className="mt-1.5 text-sm text-mute">This tool does not require any input parameters.</div>
                  ) : (
                    <div className="mt-2 space-y-3">
                      {meta.params.map((p) => (
                        <div key={p.key}>
                          <label className="field-label">{p.label}</label>
                          <input
                            type={p.type}
                            className="input text-sm"
                            value={paramValues[p.key] || ''}
                            onChange={(e) => setParamValues((v) => ({ ...v, [p.key]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <>
                    <div className="mt-1.5 text-xs text-mute">This MCP server doesn't publish a parameter schema — enter arguments as JSON.</div>
                    <textarea
                      className="input font-mono text-xs mt-2"
                      rows={5}
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                    />
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex gap-2">
                <button className="btn-teal text-sm flex-1 transition duration-200 ease-out hover:scale-[1.02] active:scale-95" onClick={run} disabled={busy}>
                  {busy ? 'Running…' : '▶ Run Tool'}
                </button>
                <button
                  className="btn-ghost text-sm inline-flex items-center gap-1.5 transition duration-200 ease-out hover:scale-[1.02] active:scale-95"
                  onClick={copySchema}
                  type="button"
                >
                  {schemaCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {schemaCopied ? 'Copied' : 'Copy Schema'}
                </button>
              </div>

              {err && <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>}

              {/* Execution result */}
              {result !== null && (
                <div className="mt-4 rounded-xl border border-lime-200 bg-lime-50/40 p-4 animate-fade-up">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                    <Check className="w-4 h-4 text-lime-600" /> Execution Complete
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <InfoItem label="Status" value={runOk ? 'Success' : 'Error'} valueClass={runOk ? 'text-lime-700' : 'text-red-600'} />
                    <InfoItem label="Response Time" value={elapsedMs != null ? `${elapsedMs} ms` : '—'} />
                    <InfoItem label="Returned" value="JSON Object" />
                  </div>
                  <button
                    onClick={() => setShowFullResponse((v) => !v)}
                    className="mt-3 text-xs font-semibold text-lime-700 hover:underline inline-flex items-center gap-1"
                    type="button"
                  >
                    {showFullResponse ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} View Full Response
                  </button>
                  {showFullResponse && (
                    <pre className="mt-3 bg-white border border-line rounded-lg text-xs leading-relaxed text-mute whitespace-pre-wrap overflow-x-auto max-h-[420px] p-3">{JSON.stringify(result, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => !editBusy && setEditing(null)}
        >
          <div
            className="relative w-full max-w-lg mt-16 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-bold">Add / update reseller MCP</div>
            <div className="text-xs text-mute mt-1">
              Wire a reseller portal to its own <span className="font-mono">dashboard.&lt;domain&gt;/mcp</span>.
              Leave URL + token empty to clear (the reseller falls back to the default MCP).
            </div>

            <label className="field-label mt-4">Reseller portal slug *</label>
            <input
              className="input text-sm font-mono lowercase"
              required
              value={editing.resellerPortal}
              onChange={(e) => setEditing((p) => ({ ...p, resellerPortal: e.target.value.toLowerCase() }))}
              placeholder="9278.ai"
            />
            <div className="field-help">Must match an existing reseller's portal slug.</div>

            <label className="field-label mt-3">MCP URL</label>
            <input
              className="input text-sm font-mono"
              value={editing.url}
              onChange={(e) => setEditing((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://dashboard.9278.ai/mcp"
            />

            <label className="field-label mt-3">MCP token (Bearer)</label>
            <input
              type="password"
              className="input text-sm font-mono"
              value={editing.token}
              onChange={(e) => setEditing((p) => ({ ...p, token: e.target.value }))}
              placeholder="sk-mcp-…"
              autoComplete="new-password"
            />
            <div className="field-help">
              Paste the full Bearer token. Stored on the reseller's user row; never echoed back.
            </div>

            {editErr && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                ⚠ {editErr}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setEditing(null)}
                disabled={editBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCreds}
                disabled={editBusy || !editing.resellerPortal}
                className="btn-teal text-sm whitespace-nowrap"
              >
                {editBusy ? 'Saving…' : 'Save MCP creds'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}