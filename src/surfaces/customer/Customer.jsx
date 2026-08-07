import { useEffect, useState, lazy, Suspense } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, Bot, FlaskConical, BookOpen, TrendingUp, Zap,
  FileText, CreditCard, Receipt, User, Menu, Wrench, Ticket, DoorOpen, Tag,
} from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
// AddNumberModal is used directly by this file's own "+ Add plan / number"
// button on every tab, so Numbers.jsx is loaded eagerly either way — no
// point lazy-wrapping its default export too.
import Numbers, { AddNumberModal } from './Numbers.jsx';
import Logo from '../../components/Logo.jsx';
import Footer from '../../components/Footer.jsx';
import BookingIcon from '../../components/BookingIcon.jsx';

// Every tab body is its own chunk — a visitor on Overview never downloads
// Billing/Templates/Playground code, and vice versa.
const Overview = lazy(() => import('./Overview.jsx'));
const Analytics = lazy(() => import('./Analytics.jsx'));
const Calls = lazy(() => import('./Calls.jsx'));
const Recordings = lazy(() => import('./Recordings.jsx'));
const Reports = lazy(() => import('./PremiumReports.jsx'));
const Meetings = lazy(() => import('./Meetings.jsx'));
const AgentsList = lazy(() => import('./AgentsList.jsx'));
const AgentDetail = lazy(() => import('./AgentDetail.jsx'));
const ChatAgentDetail = lazy(() => import('./ChatAgentDetail.jsx'));
const Templates = lazy(() => import('./Templates.jsx'));
const Playground = lazy(() => import('./Playground.jsx'));
const KnowledgeBase = lazy(() => import('./KnowledgeBase.jsx'));
const Billing = lazy(() => import('./Billing.jsx'));
const Pricing = lazy(() => import('./Pricing.jsx'));
const Transactions = lazy(() => import('./Transactions.jsx'));
const Tools = lazy(() => import('./Tools.jsx'));
const BookingHistory = lazy(() => import('./BookingHistory.jsx'));
const Tickets = lazy(() => import('./Tickets.jsx'));
const TicketDetail = lazy(() => import('./TicketDetail.jsx'));
const Account = lazy(() => import('./Account.jsx'));

// Sidebar nav — unified across Admin/Customer to a common shape. "Agents" is
// the agents-list/table page; clicking a row goes to the per-agent editor.
// "Knowledge Base" is a library view — each agent's live knowledge plus
// reusable saved templates. "Analytics" gets its own page.
// Split around "Call Activity" so the collapsible group renders inline,
// right where the flat "Call Activity" entry used to sit (between Analytics
// and Reports) instead of at the end of the list.
const NAV_TABS_BEFORE_CALLS = [
  { id: 'overview',    label: 'Overview',       Icon: LayoutDashboard, Component: Overview },
  { id: 'agents',      label: 'Agents',         Icon: Bot,             Component: AgentsList },
  { id: 'playground',  label: 'Playground',     Icon: FlaskConical,    Component: Playground },
  { id: 'kb',          label: 'Knowledge Base', Icon: BookOpen,        Component: KnowledgeBase },
  { id: 'analytics',   label: 'Analytics',      Icon: TrendingUp,      Component: Analytics },
];
const NAV_TABS_AFTER_CALLS = [
  { id: 'reports',      label: 'Reports',           Icon: FileText,   Component: Reports },
  { id: 'billing',      label: 'Billing & minutes', Icon: CreditCard, Component: Billing },
  { id: 'pricing',      label: 'Plans & pricing',   Icon: Tag,        Component: Pricing },
  { id: 'transactions', label: 'Transactions',      Icon: Receipt,    Component: Transactions },
  { id: 'account',      label: 'Account',           Icon: User,       Component: Account },
];
const NAV_TABS = [...NAV_TABS_BEFORE_CALLS, ...NAV_TABS_AFTER_CALLS];

// "Call Activity" is a collapsible sidebar group: its own page (Calls) plus
// three sub-pages that nest under it.
const CALL_ACTIVITY = { id: 'calls', label: 'Call Activity', Icon: Zap, Component: Calls };
const CALL_ACTIVITY_CHILDREN = [
  { id: 'booking-history', label: 'Booking History', Icon: BookingIcon, Component: BookingHistory },
  { id: 'tools',           label: 'Tools',           Icon: Wrench,      Component: Tools },
  { id: 'tickets',         label: 'Tickets',         Icon: Ticket,      Component: Tickets },
];

// Legacy tab ids from the previous 11-item layout — kept valid (but not
// shown in the sidebar) so any existing bookmark or deep link still
// resolves instead of bouncing to Overview.
const LEGACY_TABS = [
  { id: 'numbers',      label: 'Plan and Numbers',   Component: Numbers },
  { id: 'recordings',   label: 'Recordings',         Component: Recordings },
  { id: 'meetings',     label: 'Scheduled meetings', Component: Meetings },
  // Reached by clicking a row on the Agents list — not a nav item itself.
  { id: 'agent-detail',      label: 'Agent',            Component: AgentDetail },
  { id: 'agent-detail-chat', label: 'Chat Agent',       Component: ChatAgentDetail },
  { id: 'templates',         label: 'Browse Templates', Component: Templates },
  // Reached by clicking a row on the Tickets list — not a nav item itself.
  { id: 'ticket-detail',     label: 'Ticket',           Component: TicketDetail },
];

const TABS = [...NAV_TABS, CALL_ACTIVITY, ...CALL_ACTIVITY_CHILDREN, ...LEGACY_TABS];

export default function Customer() {
  const { currentUser, signoutUser } = useApp();
  const { tab } = useParams();
  const [navOpen, setNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);   // desktop-only: hides the sidebar entirely
  const [showAddPlan, setShowAddPlan] = useState(false);
  const callActivityActive = tab === CALL_ACTIVITY.id || CALL_ACTIVITY_CHILDREN.some((t) => t.id === tab);
  const [callActivityOpen, setCallActivityOpen] = useState(callActivityActive);

  // Close drawer when route changes
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

  // Auto-expand the group whenever navigation lands on it or one of its children.
  useEffect(() => { if (callActivityActive) setCallActivityOpen(true); }, [callActivityActive]);

  if (!currentUser) return null;

  const active = TABS.find((t) => t.id === tab);
  if (!active) return <Navigate to="/dashboard/overview" replace />;
  const Component = active.Component;

  const numberDisplay = currentUser.number?.value || '— no number yet —';
  const company = currentUser.company || currentUser.name || 'Your account';

  return (
    <div className={`dashboard-shell ${navCollapsed ? 'nav-collapsed' : ''}`}>
      {navOpen && <div className="mobile-nav-backdrop" onClick={() => setNavOpen(false)} />}

      <aside className={`sidenav ${navOpen ? 'is-open' : ''}`}>
        <div className="h-16 flex items-center gap-1.5 px-3 bg-white sticky top-0 z-30">
          <Link to="/dashboard/overview" className="flex items-center gap-2 min-w-0" aria-label="Conciva AI home">
            <Logo size={36} />
          </Link>
          <button
            type="button"
            className="hidden lg:inline-flex ml-auto shrink-0 w-6 h-6 items-center justify-center rounded-md text-mute hover:bg-slate-100 hover:text-slate-900 text-xs"
            onClick={() => setNavCollapsed(true)}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            «
          </button>
        </div>

        {/* Persistent "Welcome back" line — replaces the per-page Overview
            heading so it stays visible across every dashboard tab. */}
        <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
            Welcome back
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {company}
          </div>
        </div>

        <div className="sidenav-section mt-3">Manage</div>
        {NAV_TABS_BEFORE_CALLS.map((t) => (
          <Link
            key={t.id}
            to={`/dashboard/${t.id}`}
            className={tab === t.id ? 'active' : ''}
          >
            <t.Icon size={16} strokeWidth={2} /> {t.label}
          </Link>
        ))}

        <div className="nav-group">
          <button
            type="button"
            onClick={() => setCallActivityOpen((v) => !v)}
            className={`nav-group-toggle ${tab === CALL_ACTIVITY.id ? 'active' : ''}`}
            aria-expanded={callActivityOpen}
          >
            <CALL_ACTIVITY.Icon size={16} strokeWidth={2} />
            <span className="flex-1">{CALL_ACTIVITY.label}</span>
            <span
              className={`nav-group-chevron ${callActivityOpen ? 'is-open' : ''}`}
              aria-label={callActivityOpen ? 'Collapse Call Activity' : 'Expand Call Activity'}
            >
              ⌄
            </span>
          </button>
          {callActivityOpen && (
            <div className="nav-group-children">
              {CALL_ACTIVITY_CHILDREN.map((t) => (
                <Link
                  key={t.id}
                  to={`/dashboard/${t.id}`}
                  className={tab === t.id ? 'active' : ''}
                >
                  <t.Icon size={16} strokeWidth={2} /> {t.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {NAV_TABS_AFTER_CALLS.map((t) => (
          <Link
            key={t.id}
            to={`/dashboard/${t.id}`}
            className={tab === t.id ? 'active' : ''}
          >
            <t.Icon size={16} strokeWidth={2} /> {t.label}
          </Link>
        ))}

        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={signoutUser} className="nav-group-toggle nav-logout">
            <DoorOpen size={16} strokeWidth={2} /> Log out
          </button>
        </div>
      </aside>

      <div className="dashboard-main">
        {/* Sticky top bar — same 64px height as the sidebar logo so the
            shared border-b draws one continuous line across the page. The
            negative margins cancel dashboard-main's responsive padding so
            the bar (and its bg-white) extends edge-to-edge. No user-avatar
            widget here anymore (removed on request) — Sign Out, My Profile,
            Change Password, and Add Minutes are no longer reachable from
            the UI; Account settings still work via the Account nav tab. */}
        <div className="relative sticky top-0 z-30 bg-white -mt-5 sm:-mt-6 lg:-mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3 border-b border-slate-200 mb-6">
          <button
            className="mobile-nav-toggle lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={16} /> Menu
          </button>
          {navCollapsed && (
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
          {/* Page icon + title, sourced from the same TABS entry that drives
              the sidebar — was previously duplicated as a big heading inside
              every page component; lives once, here, for every tab now.
              One <h1> in the DOM at every width (not two elements toggled by
              visibility — that would leave zero h1s on mobile). Below `lg`
              the "Menu" button plus the right-side actions leave very little
              room, so the icon shrinks to inline and the title drops back to
              the small uppercase label the mobile header always used. */}
          <div className="lg:flex-1 flex items-center gap-1.5 lg:gap-2.5 lg:min-w-0">
            {active.Icon && (
              <>
                <active.Icon size={14} strokeWidth={2} className="lg:hidden shrink-0" />
                <span className="hidden lg:flex w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--grad-start)] to-[var(--grad-end)] items-center justify-center text-white shrink-0">
                  <active.Icon className="w-4 h-4" />
                </span>
              </>
            )}
            <h1 className="text-xs lg:text-lg font-semibold lg:font-bold uppercase lg:normal-case tracking-wider lg:tracking-normal text-mute lg:text-slate-900 lg:dark:text-slate-100 truncate">
              {active.label}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" className="btn-teal text-sm whitespace-nowrap" onClick={() => setShowAddPlan(true)}>+ Add plan / number</button>
          </div>
          <div className="absolute left-0 bottom-0 h-[3px] bg-orange-500 transition-[width] duration-200 ease-linear" style={{ width: `${scrollPct}%` }} />
        </div>

        <Suspense fallback={<div className="text-sm text-mute py-10 text-center">Loading…</div>}>
          <Component />
        </Suspense>

        {/* Footer wrapper — `margin-top: auto` from .dashboard-main pins
            this to the bottom of the viewport on short pages, and lets it
            sit at the natural end of content on tall pages. Do NOT add
            Tailwind margin-top utilities here, they would override that. */}
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