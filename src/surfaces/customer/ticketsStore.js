// Shared ticket data/helpers for Tickets.jsx (list) and TicketDetail.jsx
// (single-ticket page). No backend yet, so tickets persist to localStorage —
// this lets a ticket opened as its own page (real navigation, not a modal)
// still find the same data the list page created.

export const STORAGE_KEY = 'tickets_demo_v1';

export const STATUS_META = {
  open:        { label: 'Open',        dot: 'bg-amber-400',   pill: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  in_progress: { label: 'In progress', dot: 'bg-sky-400',     pill: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300' },
  resolved:    { label: 'Resolved',    dot: 'bg-emerald-400', pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  closed:      { label: 'Closed',      dot: 'bg-slate-400',   pill: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
};

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

// Anonymized sample tickets — clearly fake names/phones — shown only until
// real ones exist, so the page still demonstrates its full layout.
export const DEMO_TICKETS = [
  {
    id: 'TKT-2026-0042',
    subject: 'Request for callback due to service delay',
    description: 'Caller expressed strong dissatisfaction with the wait time for support.',
    status: 'open',
    priority: 'Normal',
    category: 'Callback request',
    callerName: '',
    callerPhone: '+10000000011',
    agentName: 'Sample Agent',
    createdAt: hoursAgo(71),
    updatedAt: hoursAgo(48),
  },
  {
    id: 'TKT-2026-0039',
    subject: 'Portal link not opening with 401 error',
    description: 'Caller reports the portal link is not opening, seeing a 401 error.',
    status: 'open',
    priority: 'Normal',
    category: 'Callback request',
    callerName: 'Sample Caller A',
    callerPhone: '+10000000012',
    agentName: 'Sample Agent',
    createdAt: hoursAgo(173),
    updatedAt: hoursAgo(24),
  },
  {
    id: 'TKT-2026-0038',
    subject: 'Issue accessing services',
    description: '',
    status: 'resolved',
    priority: 'Normal',
    category: '',
    callerName: 'Sample Caller B',
    callerPhone: '+10000000013',
    agentName: 'Sample Agent',
    createdAt: hoursAgo(220),
    updatedAt: hoursAgo(216),
  },
  {
    id: 'TKT-2026-0034',
    subject: 'Pothole complaint on highway ramp',
    description: 'Reported a road hazard on the highway ramp just before the signal.',
    status: 'in_progress',
    priority: 'Normal',
    category: '',
    callerName: 'Sample Caller C',
    callerPhone: '+10000000014',
    agentName: 'Sample Agent',
    createdAt: hoursAgo(191),
    updatedAt: hoursAgo(190),
  },
];

export const loadTickets = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to demo data */ }
  return DEMO_TICKETS;
};

export const persistTickets = (list) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore quota errors */ }
};

export const fmtUpdated = (iso) => {
  const d = new Date(iso);
  const diffH = (Date.now() - d.getTime()) / 3600000;
  if (diffH < 1) return 'just now';
  if (diffH < 72) return `${Math.floor(diffH / 24) || 1}d ago`;
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const overdueHours = (t, slaHours) => {
  if (t.status === 'resolved' || t.status === 'closed') return 0;
  const ageH = (Date.now() - new Date(t.createdAt).getTime()) / 3600000;
  return Math.max(0, Math.floor(ageH - slaHours));
};
