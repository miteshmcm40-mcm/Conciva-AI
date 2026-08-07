import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import CallDetailModal from '../../components/CallDetailModal.jsx';
import DateRangePicker, { todayRange } from '../../components/DateRangePicker.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const STATUS_PILL = {
  completed: 'pill bg-lime-500/20 text-lime-400',
  answered:  'pill bg-lime-500/20 text-lime-400',
  busy:      'pill bg-amber-500/20 text-amber-400',
  'no-answer': 'pill bg-amber-500/20 text-amber-400',
  failed:    'pill bg-red-500/20 text-red-400',
  canceled:  'pill bg-mute/20 text-mute',
  'in-progress': 'pill bg-blue-500/20 text-blue-400',
  ringing:   'pill bg-blue-500/20 text-blue-400',
  queued:    'pill bg-blue-500/20 text-blue-400',
};

// Strip SIP URI prefix: "sip:+19014410235@host;..." → "+19014410235"
const fmtNumber = (s) => {
  if (!s) return '—';
  const m = s.match(/sip:([^@;]+)/);
  return m ? m[1] : s;
};

const digitsOnly = (s) => String(s || '').replace(/\D+/g, '');

const fmtDirection = (dir) => {
  if (!dir) return '—';
  if (dir === 'trunking-originating' || dir === 'trunking originating') return 'Inbound';
  if (dir === 'inbound') return 'Inbound';
  if (dir === 'outbound-api' || dir === 'outbound-dial') return 'Outbound';
  return dir.replace(/-/g, ' ');
};

const fmtDuration = (s) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
};

const fmtTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return d.toLocaleString();
};

// Distinct colours per number so calls are scannable by DID at a glance.
const NUMBER_TINTS = [
  'bg-lime-100 text-lime-700',
  'bg-lime-100 text-lime-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
];

export default function Calls() {
  const { currentUser } = useApp();
  const [calls, setCalls] = useState(() => readCache('calls.calls', currentUser?.id));
  const [numbers, setNumbers] = useState(() => readCache('calls.numbers', currentUser?.id) ?? []);
  const [recordingsByCallId, setRecordingsByCallId] = useState(() => readCache('calls.recordings', currentUser?.id) ?? {});
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [filterNumber, setFilterNumber] = useState('all');
  // Date range — defaults to TODAY so the page lands on the latest activity
  // instead of dumping every call ever made.
  const [{ from: dateFrom, to: dateTo }, setRange] = useState(() => todayRange());
  const [openCall, setOpenCall] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const [callsRes, numbersRes, recsRes] = await Promise.all([
        api('/api/twilio/calls?limit=500'),
        api('/api/numbers').catch(() => ({ numbers: [] })),
        api('/api/recordings?limit=500').catch(() => ({ recordings: [] })),
      ]);
      const nextCalls = callsRes.calls || [];
      setCalls(nextCalls);
      writeCache('calls.calls', currentUser?.id, nextCalls);
      const nextNumbers = numbersRes.numbers || [];
      setNumbers(nextNumbers);
      writeCache('calls.numbers', currentUser?.id, nextNumbers);
      // Index recordings by callId so we can attach audioUrl + hasTranscript
      // when the user clicks a row to open the modal.
      const idx = {};
      (recsRes.recordings || []).forEach((r) => { idx[r.callId] = r; });
      setRecordingsByCallId(idx);
      writeCache('calls.recordings', currentUser?.id, idx);
    } catch (e) {
      setErr(e.message || 'Could not load calls');
      setCalls((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Map each owned DID digit-string → { color, label } for fast lookup.
  const numberMeta = useMemo(() => {
    const m = new Map();
    numbers.forEach((n, i) => {
      m.set(digitsOnly(n.value), {
        value: n.value,
        label: n.label || (n.isPrimary ? 'Primary' : `Number ${i + 1}`),
        tint: NUMBER_TINTS[i % NUMBER_TINTS.length],
      });
    });
    return m;
  }, [numbers]);

  // For a given call, figure out WHICH of the user's numbers it's against.
  const ownedSideOf = (c) => {
    const to = digitsOnly(fmtNumber(c.to));
    const from = digitsOnly(fmtNumber(c.from));
    if (numberMeta.has(to)) return to;
    if (numberMeta.has(from)) return from;
    return null;
  };

  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    // Date range bounds — empty strings mean unbounded on that side. Treat
    // dateFrom as start-of-day and dateTo as end-of-day in the browser's
    // local TZ so "today" matches the calendar day in India.
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : -Infinity;
    const toTs   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').getTime() : Infinity;
    return calls.filter((c) => {
      if (filterNumber !== 'all' && ownedSideOf(c) !== digitsOnly(filterNumber)) return false;
      const t = new Date(c.startTime || c.dateCreated || c.created_at || 0).getTime();
      if (!isNaN(t)) {
        if (t < fromTs || t > toTs) return false;
      }
      return true;
    });
  }, [calls, filterNumber, dateFrom, dateTo, numberMeta]);

  const total = filteredCalls.length;
  const answered = filteredCalls.filter((c) => c.status === 'completed' || c.status === 'in-progress').length;
  const missed = total - answered;

  return (
    <div>
      {/* "Call Activity" title now lives in the sticky top bar instead of here. */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <p className="text-base font-semibold tracking-wide" style={{ color: 'var(--ink-2)' }}>
          Live inbound calls
          {numbers.length > 1
            ? <> · across <span className="font-semibold text-lime-600">{numbers.length} numbers</span></>
            : currentUser?.number?.value
              ? <> · for <span className="font-mono text-lime-600">{currentUser.number.value}</span></>
              : null}
          {loading && calls !== null && <span className="font-normal text-xs text-mute ml-2">Refreshing…</span>}
        </p>
        <div className="flex items-center gap-2">
          {numbers.length > 1 && (
            <select
              className="input text-sm py-1.5"
              value={filterNumber}
              onChange={(e) => setFilterNumber(e.target.value)}
            >
              <option value="all">All numbers ({calls?.length || 0})</option>
              {numbers.map((n) => {
                const d = digitsOnly(n.value);
                const count = (calls || []).filter((c) => ownedSideOf(c) === d).length;
                return (
                  <option key={n.id} value={n.value}>
                    {n.value} {n.label ? `(${n.label})` : n.isPrimary ? '(primary)' : ''} · {count}
                  </option>
                );
              })}
            </select>
          )}
          <button className="btn-ghost btn-ghost-accent text-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {err}
        </div>
      )}

      {/* Quick-range chips + custom date inputs — same picker used on the
          Reports and Recordings tabs so the three views feel consistent. */}
      <div className="mt-5 form-card">
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={({ from, to }) => setRange({ from, to })}
        />
      </div>

      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        <div className="form-card"><div className="text-sm text-mute">Total calls</div><div className="mt-1 text-2xl font-semibold">{total}</div></div>
        <div className="form-card"><div className="text-sm text-mute">Answered</div><div className="mt-1 text-2xl font-semibold text-lime-400">{answered}{total ? <span className="text-sm font-normal text-mute"> ({Math.round((answered / total) * 100)}%)</span> : null}</div></div>
        <div className="form-card"><div className="text-sm text-mute">Missed / failed</div><div className="mt-1 text-2xl font-semibold text-amber-400">{missed}</div></div>
      </div>

      <div className="mt-6 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              {numbers.length > 1 && <th>Number</th>}
              <th>Direction</th>
              <th>From</th>
              <th>To</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {calls === null && (
              <tr><td colSpan={numbers.length > 1 ? 8 : 7} className="text-center text-mute py-6">Loading calls…</td></tr>
            )}
            {calls !== null && total === 0 && (
              <tr><td colSpan={numbers.length > 1 ? 8 : 7} className="text-center text-mute py-6">No calls yet. Dial one of your numbers to test the agent.</td></tr>
            )}
            {filteredCalls.map((c) => {
              const ownedDigits = ownedSideOf(c);
              const meta = ownedDigits ? numberMeta.get(ownedDigits) : null;
              const rec = recordingsByCallId[c.sid];
              return (
                <tr
                  key={c.sid}
                  onClick={() => setOpenCall({
                    callId:       c.sid,
                    from:         c.from,
                    to:           c.to,
                    direction:    c.direction,
                    status:       c.status,
                    startTime:    c.startTime,
                    duration:     c.duration,
                    price:        c.price,
                    agentName:    c.agentName,
                    // Recording fields — populated when this call has one.
                    audioUrl:      rec?.audioUrl     || null,
                    audioFilename: rec?.audioFilename || null,
                    audioSize:     rec?.audioSize    || null,
                    hasTranscript: rec?.hasTranscript || false,
                  })}
                  className="cursor-pointer hover:bg-lime-50 dark:hover:bg-slate-800 transition"
                  title="View recording, summary, and transcript"
                >
                  <td>{fmtTime(c.startTime)}</td>
                  {numbers.length > 1 && (
                    <td>
                      {meta ? (
                        <span className={`pill ${meta.tint} text-xs`}>{meta.value}</span>
                      ) : <span className="text-mute text-xs">—</span>}
                    </td>
                  )}
                  <td className="text-mute">{fmtDirection(c.direction)}</td>
                  <td className="font-mono">{fmtNumber(c.from)}</td>
                  <td className="font-mono">{fmtNumber(c.to)}</td>
                  <td>{fmtDuration(c.duration)}</td>
                  <td><span className={STATUS_PILL[c.status] || 'pill bg-mute/20 text-mute'}>{c.status}</span></td>
                  <td className="text-mute">{c.price ? `$${Number(Math.abs(c.price)).toFixed(2)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openCall && (
        <CallDetailModal call={openCall} onClose={() => setOpenCall(null)} />
      )}
    </div>
  );
}
