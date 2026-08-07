import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';

// =============================================================================
// Meetings — surfaces every booking the AI agent scheduled via the n8n
// → Google Calendar pipeline. Backed by MCP `get_scheduled_meetings`.
//
// Layout: month calendar (left) + meeting list (right). Clicking a day in
// the calendar filters the list to that day. Upcoming-only toggle at the top.
// =============================================================================

// ---- formatting helpers ----------------------------------------------------
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const ymd = (d) => {
  if (!d) return '';
  const z = new Date(d);
  if (isNaN(z.getTime())) return '';
  // Use local-day buckets so a "5 pm meeting" appears on the local 5pm day, not UTC.
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
};

const sameDay = (a, b) => ymd(a) === ymd(b);

const fmtTime = (d) => {
  const z = new Date(d);
  return isNaN(z.getTime()) ? '—' : z.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const fmtDateLong = (d) => {
  const z = new Date(d);
  return isNaN(z.getTime()) ? '—' : z.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtRelative = (d) => {
  const z = new Date(d);
  if (isNaN(z.getTime())) return '';
  const diffMs = z.getTime() - Date.now();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  const absHr  = Math.round(absMin / 60);
  const absDay = Math.round(absHr / 24);
  if (diffMs >= 0) {
    if (absMin < 60) return `in ${absMin}m`;
    if (absHr  < 24) return `in ${absHr}h`;
    return `in ${absDay}d`;
  }
  if (absMin < 60) return `${absMin}m ago`;
  if (absHr  < 24) return `${absHr}h ago`;
  return `${absDay}d ago`;
};

// Stale-while-revalidate cache for this tab. Without it, every reload (and
// every "Upcoming only" toggle) resets `meetings` to null, so the whole list
// blanks to "Loading meetings…" for however long the round-trip takes — that
// blank-then-pop is what actually reads as slow. Hydrating synchronously from
// the last successful load for the same (user, filter) combo shows real rows
// immediately; the load below always re-fetches in the background and
// overwrites this with fresh data once it lands. Session-scoped and keyed by
// user id so it never leaks across accounts or outlives the tab.
const MEETINGS_CACHE_KEY = 'kallus.meetings.cache.v1';
const readMeetingsCache = (userId, upcomingOnly) => {
  if (!userId) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(MEETINGS_CACHE_KEY) || 'null');
    return parsed && parsed.userId === userId && parsed.upcomingOnly === upcomingOnly ? parsed.meetings : null;
  } catch {
    return null;
  }
};
const writeMeetingsCache = (userId, upcomingOnly, meetings) => {
  if (!userId) return;
  try {
    sessionStorage.setItem(MEETINGS_CACHE_KEY, JSON.stringify({ userId, upcomingOnly, meetings }));
  } catch { /* storage full / private-mode — just skip caching */ }
};

const STATUS_PILL = {
  scheduled: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300',
  confirmed: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300',
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  canceled:  'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  completed: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  done:      'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

// =============================================================================
// Calendar grid — pure flex/grid month view, no external lib.
// =============================================================================
function MonthCalendar({ month, onPrev, onNext, onToday, meetingsByDay, selectedDay, onSelectDay }) {
  // Build a 6-row × 7-col grid. Pad with previous-month and next-month days
  // so weekday columns line up.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstWeekday = first.getDay();        // 0 = Sun
  const startDate = new Date(first);
  startDate.setDate(startDate.getDate() - firstWeekday);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    cells.push(d);
  }

  const todayKey = ymd(new Date());
  const inMonth = (d) => d.getMonth() === month.getMonth();

  return (
    <div className="form-card border-lime-200 dark:border-lime-500/30 animate-fade-up">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onPrev}
          className="btn-ghost text-sm w-8 h-8 flex items-center justify-center rounded-full transition duration-200 ease-out hover:scale-110 active:scale-95"
          aria-label="Previous month"
        >←</button>
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToday}
            className="btn-ghost btn-ghost-accent text-xs px-3 py-1 transition duration-200 ease-out hover:scale-105 active:scale-95"
          >Today</button>
          <button
            onClick={onNext}
            className="btn-ghost text-sm w-8 h-8 flex items-center justify-center rounded-full transition duration-200 ease-out hover:scale-110 active:scale-95"
            aria-label="Next month"
          >→</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
        {WEEKDAYS.map((w) => <div key={w} className="text-center py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = ymd(d);
          const events = meetingsByDay.get(key) || [];
          const isToday = key === todayKey;
          const isSelected = selectedDay === key;
          const muted = !inMonth(d);
          return (
            <button
              key={key}
              onClick={() => onSelectDay(isSelected ? null : key)}
              className={[
                'aspect-square rounded-lg text-left p-1.5 flex flex-col transition duration-200 ease-out hover:scale-105 active:scale-95',
                muted ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-300',
                muted
                  ? 'border border-transparent'
                  : isToday && !isSelected
                  ? 'border-2 border-lime-600 dark:border-lime-500 animate-today-ring'
                  : 'border border-slate-100 dark:border-slate-800',
                isSelected ? 'bg-lime-500 text-white border-lime-500 dark:bg-lime-600 dark:border-lime-600 animate-pop-in' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
              ].join(' ')}
            >
              <span className={`text-xs font-semibold ${isSelected ? 'text-white' : ''}`}>{d.getDate()}</span>
              {events.length > 0 && (
                <span className={`mt-auto flex items-center gap-0.5 ${isSelected ? '' : ''}`}>
                  {events.slice(0, 3).map((_, i) => (
                    <span
                      key={i}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className={`w-1.5 h-1.5 rounded-full animate-dot-pop ${isSelected ? 'bg-white' : 'bg-lime-500'}`}
                    />
                  ))}
                  {events.length > 3 && (
                    <span className={`text-[9px] font-semibold ml-0.5 ${isSelected ? 'text-white' : 'text-lime-600 dark:text-lime-400'}`}>
                      +{events.length - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Meeting row card.
// =============================================================================
function MeetingRow({ m }) {
  const statusKey = String(m.status || 'scheduled').toLowerCase();
  const pillCls = STATUS_PILL[statusKey] || STATUS_PILL.scheduled;
  const synced = !!m.calendar_link || !!m.calendar_event_id;
  return (
    <div className="form-card border-lime-200 dark:border-lime-500/30 hover:border-lime-500/60 transition">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className={`pill text-xs ${pillCls}`}>{m.status || 'scheduled'}</span>
            <span className="text-mute">{fmtRelative(m.start)}</span>
            {synced ? (
              <span className="pill bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300 text-xs">📅 calendar synced</span>
            ) : (
              <span className="pill bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 text-xs">⏳ awaiting sync</span>
            )}
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            {m.name || 'Unnamed booking'}
          </div>
          <div className="mt-1 text-sm text-mute flex flex-wrap gap-x-3 gap-y-0.5">
            {m.email && <span><a href={`mailto:${m.email}`} className="text-lime-600 dark:text-lime-400 hover:underline">{m.email}</a></span>}
            {m.phone && <span><a href={`tel:${m.phone}`} className="text-lime-600 dark:text-lime-400 hover:underline font-mono">{m.phone.replace(/^\+/, '')}</a></span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {fmtTime(m.start)}{m.end ? <> – {fmtTime(m.end)}</> : null}
          </div>
          <div className="text-xs text-mute">
            {fmtDateLong(m.start)}
            {m.duration_minutes ? ` · ${m.duration_minutes}m` : ''}
          </div>
        </div>
      </div>

      {m.notes && (
        <div className="mt-3 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 rounded px-3 py-2">
          <span className="text-xs text-mute font-semibold uppercase tracking-wider mr-2">Notes</span>
          {m.notes}
        </div>
      )}

      {(synced || m.call_id) && (
        <div className="mt-3 flex items-center gap-3 text-xs">
          {m.calendar_link && (
            <a href={m.calendar_link} target="_blank" rel="noreferrer" className="text-lime-600 dark:text-lime-400 hover:underline">
              Open in Google Calendar ↗
            </a>
          )}
          {m.call_id && (
            <span className="text-mute font-mono">call: {String(m.call_id).slice(-12)}</span>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main surface.
// =============================================================================
export default function Meetings({
  title = '📅 Scheduled meetings',
  description = 'Every meeting your AI agent booked through Google Calendar.',
}) {
  const { currentUser } = useApp();
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [meetings, setMeetings] = useState(() => readMeetingsCache(currentUser?.id, true));
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  // Derived, not separate state: whenever there's no data (real or cached)
  // for the currently selected filter, the list itself is the loading
  // indicator — never a stale mismatched-filter list with no visible cue.
  const loading = meetings === null;
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState(null);

  // Detects the moment the sticky calendar actually locks into place (its
  // sentinel scrolls above the sticky offset) so the "stuck" shadow can ease
  // in via a CSS transition instead of snapping the instant sticky engages.
  const [calendarStuck, setCalendarStuck] = useState(false);
  const calendarSentinel = useRef(null);
  useEffect(() => {
    const el = calendarSentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setCalendarStuck(!entry.isIntersecting),
      { rootMargin: '-81px 0px 0px 0px', threshold: 1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const load = async (which = upcomingOnly) => {
    setRefreshing(true);
    setErr('');
    try {
      const r = await api(`/api/scheduled-meetings?upcoming=${which ? 'true' : 'false'}`);
      const next = r.meetings || [];
      setMeetings(next);
      writeMeetingsCache(currentUser?.id, which, next);
    } catch (e) {
      setErr(e.message || 'Failed to load meetings');
      setMeetings((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  };

  // Switching the filter shows whatever's cached for that specific (user,
  // filter) combo immediately — null (→ the loading state) only when this
  // filter has never been loaded before — then always refreshes in the
  // background so the list is never left silently stale.
  useEffect(() => {
    setMeetings(readMeetingsCache(currentUser?.id, upcomingOnly));
    load(upcomingOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingOnly]);

  // Index meetings by local day for the calendar dot rendering.
  const meetingsByDay = useMemo(() => {
    const m = new Map();
    (meetings || []).forEach((mt) => {
      const k = ymd(mt.start);
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(mt);
    });
    return m;
  }, [meetings]);

  const filteredMeetings = useMemo(() => {
    if (!meetings) return [];
    if (!selectedDay) return meetings;
    return meetings.filter((m) => ymd(m.start) === selectedDay);
  }, [meetings, selectedDay]);

  const total = (meetings || []).length;
  const upcomingCount = (meetings || []).filter((m) => new Date(m.start).getTime() > Date.now()).length;

  return (
    <div>
      {/* Icon + title used to render here — the header (Customer.jsx) already
          shows one for the "Booking History" nav route this page is reached
          through. The `title` prop still exists for the legacy /meetings
          deep link that carries no sidebar entry (and so no header icon). */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <p className="text-base font-semibold tracking-wide animate-fade-up" style={{ color: 'var(--ink-2)' }}>
          {description}
          {upcomingOnly && <> · <span className="font-semibold">Showing upcoming only</span></>}
          {total > 0 && (
            <> · <span className="text-lime-600 dark:text-lime-400 font-semibold">{upcomingCount} upcoming</span></>
          )}
          {refreshing && !loading && <span className="font-normal text-xs text-mute ml-2">Refreshing…</span>}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-mute cursor-pointer">
            <input
              type="checkbox"
              checked={upcomingOnly}
              onChange={(e) => setUpcomingOnly(e.target.checked)}
              className="rounded accent-lime-600"
            />
            Upcoming only
          </label>
          <button onClick={() => load()} disabled={refreshing} className="btn-ghost btn-ghost-accent text-sm transition duration-200 ease-out hover:scale-105 active:scale-95">
            {refreshing ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {err}
        </div>
      )}

      <div className="mt-6 grid lg:grid-cols-[360px_1fr] gap-6">
        {/* === LEFT: month calendar ============================================ */}
        <div className="relative">
          <div ref={calendarSentinel} className="absolute top-0 left-0 h-px w-px" aria-hidden="true" />
          <div className="lg:sticky lg:top-20 lg:self-start">
            <div className={`transition-shadow duration-300 ease-out rounded-xl ${calendarStuck ? 'shadow-lg' : 'shadow-none'}`}>
              <MonthCalendar
                month={month}
                onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                onToday={() => {
                  const n = new Date();
                  setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
                }}
                meetingsByDay={meetingsByDay}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
              />
              {selectedDay && (
                <button
                  onClick={() => setSelectedDay(null)}
                  className="mt-3 w-full btn-ghost text-xs"
                >
                  ✕ Clear day filter ({selectedDay})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* === RIGHT: meeting list ============================================ */}
        <div className="space-y-3">
          {loading && (
            <div className="form-card text-center text-mute py-6">Loading meetings…</div>
          )}
          {!loading && filteredMeetings.length === 0 && (
            <div className="form-card text-center py-10">
              <div className="text-4xl mb-2">📭</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {selectedDay ? `No meetings on ${selectedDay}` : 'No meetings scheduled yet'}
              </div>
              <div className="text-sm text-mute mt-1">
                {selectedDay
                  ? 'Pick another day on the calendar to see bookings.'
                  : 'Your AI agent will add meetings here when callers ask to schedule one.'}
              </div>
            </div>
          )}
          {filteredMeetings.map((m) => (
            <MeetingRow key={m.id || `${m.start}-${m.email || m.phone}`} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}
