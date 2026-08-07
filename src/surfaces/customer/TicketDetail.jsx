import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock, Phone, User, Bot } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { STATUS_META, loadTickets, fmtUpdated, overdueHours } from './ticketsStore.js';

// Ticket detail — a real page (its own URL, ?id=<ticket id>) instead of a
// modal, reached by tapping a row on the Tickets list. Reads the same
// localStorage-backed ticket list as Tickets.jsx (see ticketsStore.js) so it
// works whether the ticket is a demo sample or one filed manually.
const SLA_HOURS = 3;

export default function TicketDetail() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useApp();
  const isAdminTier = currentUser?.userType === 'superadmin' || currentUser?.userType === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  const id = searchParams.get('id');
  const ticket = id ? loadTickets().find((t) => t.id === id) : null;

  if (!ticket) {
    return (
      <div>
        <Link to={`${basePath}/tickets`} className="inline-flex items-center gap-1.5 text-sm text-lime-700 hover:underline">
          <ArrowLeft size={14} /> All tickets
        </Link>
        <div className="mt-6 form-card text-center text-mute py-10">
          Ticket not found. It may have been created in a different browser session.
        </div>
      </div>
    );
  }

  const over = overdueHours(ticket, SLA_HOURS);
  const meta = STATUS_META[ticket.status] || STATUS_META.open;

  return (
    <div>
      <button
        onClick={() => navigate(`${basePath}/tickets`)}
        className="inline-flex items-center gap-1.5 text-sm text-lime-700 hover:underline transition duration-200 ease-out"
      >
        <ArrowLeft size={14} /> All tickets
      </button>

      <div className="mt-4 form-card animate-fade-up animate-modal-border-shadow max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${meta.dot}`} />
            {ticket.id}
          </div>
        </div>

        <h1 className="mt-2 text-lg font-bold text-slate-900 dark:text-slate-100">{ticket.subject}</h1>
        {ticket.description && <p className="mt-1 text-sm text-mute">{ticket.description}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <span className={`pill text-xs ${meta.pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${meta.dot}`} />
            {meta.label}
          </span>
          {ticket.category && (
            <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
              {ticket.category}
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
            {ticket.callerName && (
              <div className="mt-1 flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                <User className="w-3.5 h-3.5 text-mute" /> {ticket.callerName}
              </div>
            )}
            {ticket.callerPhone && (
              <div className="flex items-center gap-1.5 text-mute font-mono text-xs mt-0.5">
                <Phone className="w-3.5 h-3.5" /> {ticket.callerPhone.replace(/^\+/, '')}
              </div>
            )}
            {!ticket.callerName && !ticket.callerPhone && <div className="mt-1 text-mute">—</div>}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Agent</div>
            <div className="mt-1 flex items-center gap-1.5 text-lime-600 dark:text-lime-400 font-semibold">
              <Bot className="w-4 h-4" /> {ticket.agentName}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Priority</div>
            <div className="mt-1 text-mute">{ticket.priority}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Updated</div>
            <div className="mt-1 text-mute">{fmtUpdated(ticket.updatedAt)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
