import { useMemo, useState } from 'react';
// Bot, not IdCardLanyard — the agent is the AI voice agent, and Bot is the
// same icon the Agents nav item and agent pages already use.
import {
  Search, Clock, RefreshCw, Plus, Phone, User, Bot, ChevronRight, X,
  Target, CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';
import { STATUS_META, loadTickets, persistTickets, fmtUpdated, overdueHours } from './ticketsStore.js';

// Snap points for the SLA slider + quick-preset chips — deliberately a fixed
// small set (not a free-text field) so "overdue" always means one of these
// well-understood windows.
const SLA_VALUES = [1, 3, 6, 12, 24];
const nearestSlaValue = (h) => SLA_VALUES.reduce((best, v) => Math.abs(v - h) < Math.abs(best - h) ? v : best, SLA_VALUES[0]);
const fmtSlaLabel = (h) => `${h} Hour${h === 1 ? '' : 's'}`;

// =============================================================================
// Tickets — issues the AI agent captured on calls, or filed manually.
//
// No backend yet: this renders anonymized sample tickets (clearly fake
// names/phones) so the page demonstrates its full layout — filter chips,
// search, SLA/overdue tracking, New ticket form. Tickets persist to
// localStorage (see ticketsStore.js).
// Wire this up to a real /api/tickets endpoint once one exists; the shape
// in ticketsStore.js (status/priority/category/caller/agent/timestamps) is
// what that endpoint should return.
// =============================================================================

const FILTERS = [
  { key: 'all',         label: 'All',          dot: 'bg-slate-400',   text: 'text-slate-900 dark:text-slate-100' },
  { key: 'open',        label: 'Open',         dot: 'bg-amber-400',   text: 'text-amber-600 dark:text-amber-400' },
  { key: 'in_progress', label: 'In progress',  dot: 'bg-sky-400',     text: 'text-sky-600 dark:text-sky-400' },
  { key: 'resolved',    label: 'Resolved',     dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'closed',      label: 'Closed',       dot: 'bg-slate-400',   text: 'text-slate-500 dark:text-slate-400' },
  { key: 'overdue',     label: 'Overdue',      dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
];

export default function Tickets() {
  const [tickets, setTickets] = useState(() => loadTickets());
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [slaHours, setSlaHours] = useState(3);
  const [slaModalOpen, setSlaModalOpen] = useState(false);
  const [slaDraft, setSlaDraft] = useState(slaHours);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', description: '', callerName: '', callerPhone: '', category: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [openTicket, setOpenTicket] = useState(null);

  const counts = useMemo(() => {
    const c = { all: tickets.length, open: 0, in_progress: 0, resolved: 0, closed: 0, overdue: 0 };
    tickets.forEach((t) => {
      c[t.status] = (c[t.status] || 0) + 1;
      if (overdueHours(t, slaHours) > 0) c.overdue += 1;
    });
    return c;
  }, [tickets, slaHours]);

  const filtered = useMemo(() => {
    let list = tickets;
    if (filter === 'overdue') list = list.filter((t) => overdueHours(t, slaHours) > 0);
    else if (filter !== 'all') list = list.filter((t) => t.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => [t.id, t.subject, t.callerName, t.callerPhone]
        .some((f) => (f || '').toLowerCase().includes(q)));
    }
    return list;
  }, [tickets, filter, search, slaHours]);

  const refresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  };

  const nextTicketId = () => {
    const n = tickets.length + 43;
    return `TKT-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
  };

  const submitNewTicket = (e) => {
    e.preventDefault();
    if (!form.subject.trim()) return;
    const now = new Date().toISOString();
    setTickets((prev) => {
      const next = [{
        id: nextTicketId(),
        subject: form.subject.trim(),
        description: form.description.trim(),
        status: 'open',
        priority: 'Normal',
        category: form.category.trim(),
        callerName: form.callerName.trim(),
        callerPhone: form.callerPhone.trim(),
        agentName: '— filed manually —',
        createdAt: now,
        updatedAt: now,
      }, ...prev];
      persistTickets(next);
      return next;
    });
    setForm({ subject: '', description: '', callerName: '', callerPhone: '', category: '' });
    setNewTicketOpen(false);
    setFilter('all');
  };

  return (
    <div>
      {/* Icon + "Tickets" title now live in the sticky top bar instead of here. */}
      <p className="text-base font-semibold tracking-wide animate-fade-up" style={{ color: 'var(--ink-2)' }}>
        Issues your AI agent captured on calls — or filed manually. Resolution target{' '}
        <button onClick={() => { setSlaDraft(nearestSlaValue(slaHours)); setSlaModalOpen(true); }} className="text-lime-600 dark:text-lime-400 font-semibold underline decoration-dotted underline-offset-2 transition-colors duration-200 hover:text-lime-700 dark:hover:text-lime-300">
          {slaHours}h
        </button>.
      </p>

      <div className="mt-4 flex items-center gap-2 flex-wrap animate-fade-up">
        <button onClick={() => { setSlaDraft(nearestSlaValue(slaHours)); setSlaModalOpen(true); }} className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5 transition duration-200 ease-out hover:scale-105 active:scale-95">
          <Clock className="w-4 h-4" /> SLA
        </button>
        <button onClick={refresh} disabled={refreshing} className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5 transition duration-200 ease-out hover:scale-105 active:scale-95 disabled:opacity-90">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
        <button onClick={() => setNewTicketOpen(true)} className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5 transition duration-200 ease-out hover:scale-105 active:scale-95">
          <Plus className="w-4 h-4" /> New ticket
        </button>
      </div>

      {/* Status filter chips */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {FILTERS.map((f, i) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{ animationDelay: `${i * 60}ms` }}
            className={`form-card text-left relative p-4 transition duration-200 ease-out animate-fade-up hover:shadow-md hover:-translate-y-0.5 ${
              filter === f.key
                ? 'border-lime-400 ring-2 ring-lime-500/25'
                : 'hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <span className={`absolute top-3 right-3 w-2 h-2 rounded-full ${f.dot} ${f.key === 'overdue' && counts.overdue > 0 ? 'animate-today-ring' : 'animate-pulse'}`} />
            <div className={`text-2xl font-bold ${f.text}`}>{counts[f.key] ?? 0}</div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mt-0.5">{f.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mt-4 relative animate-fade-up">
        <Search className="w-4 h-4 text-mute absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className="input pl-10 transition duration-200 ease-out focus:shadow-md animate-border-glow"
          placeholder="Search ticket #, subject, caller name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Ticket table */}
      <div className="mt-6 form-card p-0 overflow-x-auto animate-fade-up border-black/30 dark:border-white/25">
        <table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Category</th>
              <th>Caller</th>
              <th>Agent</th>
              <th>Updated</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center text-mute py-8">No tickets match this filter.</td></tr>
            )}
            {filtered.map((t) => {
              const over = overdueHours(t, slaHours);
              const meta = STATUS_META[t.status] || STATUS_META.open;
              return (
                <tr
                  key={t.id}
                  onClick={() => setOpenTicket(t)}
                  className={`cursor-pointer transition-colors duration-150 ease-out hover:bg-slate-50/70 dark:hover:bg-slate-800/40 group ${over > 0 ? 'bg-red-50/40 dark:bg-red-500/5' : ''}`}
                >
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${meta.dot}`} />
                      {t.id}
                    </div>
                    {over > 0 && (
                      <span className="mt-1 inline-flex items-center whitespace-nowrap pill bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30 text-[10px]">
                        <Clock className="w-3 h-3" /> {over}h over
                      </span>
                    )}
                  </td>
                  <td className="max-w-[260px]">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{t.subject}</div>
                    {t.description && <div className="text-xs text-mute truncate">{t.description}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={`pill text-xs ${meta.pill}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </td>
                  <td className="text-sm text-mute whitespace-nowrap">{t.priority}</td>
                  <td className="whitespace-nowrap">{t.category ? <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">{t.category}</span> : <span className="text-mute">—</span>}</td>
                  <td className="text-sm">
                    {t.callerName && (
                      <div className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                        <User className="w-3.5 h-3.5 text-mute" /> {t.callerName}
                      </div>
                    )}
                    {t.callerPhone && (
                      <div className="flex items-center gap-1.5 text-mute font-mono text-xs mt-0.5">
                        <Phone className="w-3.5 h-3.5" /> {t.callerPhone.replace(/^\+/, '')}
                      </div>
                    )}
                  </td>
                  <td className="text-sm text-lime-600 dark:text-lime-400 font-semibold whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Bot className="w-4 h-4" /> {t.agentName}
                    </div>
                  </td>
                  <td className="text-xs text-mute whitespace-nowrap">{fmtUpdated(t.updatedAt)}</td>
                  <td className="text-mute">
                    <ChevronRight className="w-4 h-4 transition-transform duration-200 ease-out group-hover:translate-x-1 group-hover:text-lime-600 dark:group-hover:text-lime-400" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ticket detail modal — used for every ticket row. */}
      {openTicket && (() => {
        const over = overdueHours(openTicket, slaHours);
        const meta = STATUS_META[openTicket.status] || STATUS_META.open;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 animate-backdrop-in"
            onClick={() => setOpenTicket(null)}
          >
            <div
              className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border p-6 animate-modal-in animate-modal-border-shadow"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${meta.dot}`} />
                  {openTicket.id}
                </div>
                <button onClick={() => setOpenTicket(null)} className="text-mute hover:text-slate-900 dark:hover:text-slate-100 transition duration-200 ease-out hover:scale-110 active:scale-95"><X className="w-4 h-4" /></button>
              </div>

              <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100">{openTicket.subject}</h2>
              {openTicket.description && <p className="mt-1 text-sm text-mute">{openTicket.description}</p>}

              <div className="mt-4 flex flex-wrap gap-2">
                <span className={`pill text-xs ${meta.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${meta.dot}`} />
                  {meta.label}
                </span>
                {openTicket.category && (
                  <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
                    {openTicket.category}
                  </span>
                )}
                {over > 0 && (
                  <span className="pill bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30 text-xs">
                    <Clock className="w-3 h-3" /> {over}h over
                  </span>
                )}
              </div>

              <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Caller</div>
                  {openTicket.callerName && (
                    <div className="mt-1 flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                      <User className="w-3.5 h-3.5 text-mute" /> {openTicket.callerName}
                    </div>
                  )}
                  {openTicket.callerPhone && (
                    <div className="flex items-center gap-1.5 text-mute font-mono text-xs mt-0.5">
                      <Phone className="w-3.5 h-3.5" /> {openTicket.callerPhone.replace(/^\+/, '')}
                    </div>
                  )}
                  {!openTicket.callerName && !openTicket.callerPhone && <div className="mt-1 text-mute">—</div>}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Agent</div>
                  <div className="mt-1 flex items-center gap-1.5 text-lime-600 dark:text-lime-400 font-semibold">
                    <Bot className="w-4 h-4" /> {openTicket.agentName}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Priority</div>
                  <div className="mt-1 text-mute">{openTicket.priority}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Updated</div>
                  <div className="mt-1 text-mute">{fmtUpdated(openTicket.updatedAt)}</div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end">
                <button onClick={() => setOpenTicket(null)} className="btn-ghost text-sm py-2 px-4 transition duration-200 ease-out hover:scale-105 active:scale-95">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SLA modal */}
      {slaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 animate-backdrop-in">
          <div className="w-full max-w-[460px] rounded-2xl bg-white dark:bg-slate-900 border p-6 shadow-xl animate-modal-in animate-modal-border-shadow">
            {/* Header */}
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Target className="w-5 h-5 text-lime-600" /> Resolution Target (SLA)
            </h2>
            <p className="mt-1.5 text-sm text-mute leading-relaxed">
              Define how long a ticket can remain open before it is automatically marked as Overdue.
            </p>

            {/* Resolution time — big value + slider */}
            <div className="mt-5">
              <div className="field-label">Resolution Time</div>
              <div
                key={slaDraft}
                className="mt-1 text-center text-2xl font-bold text-slate-900 dark:text-slate-100 animate-fade-up"
                style={{ animationDuration: '250ms' }}
              >
                {fmtSlaLabel(slaDraft)}
              </div>
              <input
                type="range"
                min={0}
                max={SLA_VALUES.length - 1}
                step={1}
                value={SLA_VALUES.indexOf(slaDraft)}
                onChange={(e) => setSlaDraft(SLA_VALUES[Number(e.target.value)])}
                className="mt-3 w-full accent-lime-600 transition-all duration-200 ease-out"
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-mute font-medium">
                {SLA_VALUES.map((v) => (
                  <span key={v} className={v === slaDraft ? 'text-lime-700 font-bold' : ''}>{v}h</span>
                ))}
              </div>
            </div>

            {/* Quick presets */}
            <div className="mt-5">
              <div className="field-label">Quick Presets</div>
              <div className="mt-2 flex gap-2 flex-wrap">
                {SLA_VALUES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSlaDraft(v)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 ease-out hover:scale-105 active:scale-95 ${
                      v === slaDraft
                        ? 'bg-lime-600 border-lime-600 text-white shadow-sm'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-lime-300'
                    }`}
                  >
                    {v}h
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview */}
            <div key={`preview-${slaDraft}`} className="mt-5 rounded-xl border border-lime-200 dark:border-lime-500/30 bg-lime-50 dark:bg-lime-500/10 p-3.5 animate-fade-up" style={{ animationDuration: '250ms' }}>
              <div className="text-[10px] uppercase tracking-wider text-lime-700 dark:text-lime-400 font-semibold">Preview</div>
              <div className="mt-1.5 flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-lime-600 shrink-0 mt-0.5" />
                <span>Tickets remain active for the first {fmtSlaLabel(slaDraft).toLowerCase()}.</span>
              </div>
              <div className="mt-1.5 flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>After {fmtSlaLabel(slaDraft).toLowerCase()} they automatically appear in the Overdue category.</span>
              </div>
            </div>

            {/* Info note */}
            <div className="mt-4 flex items-start gap-1.5 text-xs text-mute">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>This setting affects newly created and currently open tickets. Closed and resolved tickets are not affected.</span>
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setSlaModalOpen(false)}
                className="btn-ghost text-sm py-2.5 px-5 transition duration-200 ease-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
              >
                Cancel
              </button>
              <button
                onClick={() => { setSlaHours(slaDraft); setSlaModalOpen(false); }}
                className="btn-ghost btn-ghost-accent text-sm py-2.5 px-5 transition duration-200 ease-out hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
              >
                Save SLA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New ticket modal */}
      {newTicketOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 animate-backdrop-in">
          <form onSubmit={submitNewTicket} className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border p-6 animate-modal-in animate-modal-border-shadow">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">New ticket</h2>
            <p className="mt-1 text-sm text-mute">File an issue manually — not tied to a specific call.</p>

            <label className="field-label mt-4">Subject *</label>
            <input className="input transition duration-200 ease-out focus:shadow-md" required value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />

            <label className="field-label mt-3">Description</label>
            <textarea className="input transition duration-200 ease-out focus:shadow-md" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Caller name</label>
                <input className="input transition duration-200 ease-out focus:shadow-md" value={form.callerName} onChange={(e) => setForm((f) => ({ ...f, callerName: e.target.value }))} />
              </div>
              <div>
                <label className="field-label">Caller phone</label>
                <input className="input transition duration-200 ease-out focus:shadow-md" value={form.callerPhone} onChange={(e) => setForm((f) => ({ ...f, callerPhone: e.target.value }))} placeholder="+14018677668" />
              </div>
            </div>

            <label className="field-label mt-3">Category</label>
            <input className="input transition duration-200 ease-out focus:shadow-md" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Callback request" />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setNewTicketOpen(false)} className="btn-ghost text-sm py-2 px-4 transition duration-200 ease-out hover:scale-105 active:scale-95">Cancel</button>
              <button type="submit" className="btn-ghost btn-ghost-accent text-sm py-2 px-4 transition duration-200 ease-out hover:scale-105 active:scale-95">Create ticket</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
