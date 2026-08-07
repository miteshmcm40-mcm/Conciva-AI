import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight, ShoppingBag, Wallet, Undo2, RefreshCcw, CreditCard,
  Search, Download, RefreshCw, Info, ChevronLeft, ChevronRight, MoreHorizontal,
  Users, Link2, Settings2, Check, TrendingUp, ArrowRight, CalendarRange, ChevronDown,
} from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import DateRangePicker from '../../components/DateRangePicker.jsx';

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

const ymd = (d) => {
  const x = new Date(d);
  return isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 10);
};

// Relative "x ago" for the Recent activity feed. Falls back to a short date
// once something is more than a week old.
const timeAgo = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 7 * 86400) return `${Math.floor(secs / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const symbolFor = (cur) => (cur === 'USD' ? '$' : cur === 'USD' ? '$' : `${cur || '$'} `);
const fmtMoney = (n, cur) => {
  const sym = symbolFor(cur);
  return cur === 'USD'
    ? `${sym}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `${sym}${Number(n || 0).toFixed(2)}`;
};

// Which UI "bucket" a raw wallet-transaction kind belongs to, for the chip
// filter row and the icon shown on each transaction. Any negative-amount
// row is treated as a refund regardless of kind, since that's the one
// signal that's actually reliable across kinds.
const bucketOf = (p) => {
  if (Number(p.amount) < 0) return 'refunds';
  if (p.kind === 'topup') return 'topups';
  if (p.kind === 'plan-change') return 'upgrades';
  return 'purchases'; // new-number-plan, plan-restart, signup, save-card
};

const BUCKET_META = {
  purchases: { label: 'Plan Purchases', pill: 'bg-blue-100 text-blue-700',   icon: ShoppingBag, iconWrap: 'bg-blue-100 text-blue-600' },
  upgrades:  { label: 'Upgrade',        pill: 'bg-purple-100 text-purple-700', icon: RefreshCcw, iconWrap: 'bg-purple-100 text-purple-600' },
  topups:    { label: 'Wallet Top-up',  pill: 'bg-amber-100 text-amber-700',  icon: Wallet,     iconWrap: 'bg-amber-100 text-amber-600' },
  refunds:   { label: 'Refund',         pill: 'bg-red-100 text-red-700',      icon: Undo2,      iconWrap: 'bg-red-100 text-red-600' },
};

const KIND_LABEL = {
  'new-number-plan': 'Plan Purchase',
  'plan-change':     'Plan Upgrade',
  'plan-restart':    'Plan Restart',
  'topup':           'Wallet Top-up',
  'save-card':       'Card Saved',
  'signup':          'Signup',
};

const CHIPS = [
  { id: 'all',       label: 'All' },
  { id: 'purchases', label: 'Plan Purchases' },
  { id: 'upgrades',  label: 'Upgrades' },
  { id: 'topups',    label: 'Top-ups' },
  { id: 'refunds',   label: 'Refunds' },
];

const PAGE_SIZES = [5, 10, 25, 50];

// Last 7 calendar days (oldest → newest) as an array of real per-day totals
// for a KPI tile's mini sparkline. Sums `valueFn(p)` for every item whose
// createdAt falls on that day — genuine daily activity, not decoration.
const last7Days = (items, valueFn) => {
  const byDay = new Map();
  for (const p of items) {
    const day = ymd(p.createdAt);
    byDay.set(day, (byDay.get(day) || 0) + valueFn(p));
  }
  const out = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(byDay.get(ymd(d)) || 0);
  }
  return out;
};

// Tiny bar sparkline under each KPI tile — real last-7-day values, tinted to
// match the tile's accent color. Renders a flat baseline (not fake bars)
// when every day is zero, same "don't invent data" rule as the main chart.
function Sparkline({ values, barClass }) {
  const max = Math.max(1, ...values);
  const allZero = values.every((v) => v === 0);
  return (
    <div className="mt-3 flex items-end gap-1 h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${allZero ? 'bg-slate-100' : barClass}`}
          style={{ height: allZero ? 3 : `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

// Round a max value up to a "nice" axis ceiling (1/2/5 × a power of ten),
// same trick most charting libraries use for gridline labels.
const niceCeil = (v) => {
  if (v <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * mag;
};

// Two-point revenue trend — First Half vs Second Half of the date range,
// matching the same real split used for the % change pill. Axis labels and
// dot markers are plain HTML (not SVG <text>/<circle>), because an SVG's
// viewBox scales text down with the drawing whenever the rendered width is
// narrower than the coordinate space — that's what made the $ numbers
// unreadably small before. Only the line + area fill use SVG, with
// vectorEffect="non-scaling-stroke" so the stroke stays a real pixel width
// regardless of how much the 0–100 coordinate space gets stretched.
function RevenueChart({ firstHalf, secondHalf, currency, empty }) {
  if (empty) {
    return (
      <div className="h-[180px] flex items-center justify-center text-sm text-mute border border-dashed border-slate-200 rounded-lg">
        No transactions in this range yet
      </div>
    );
  }

  const max = niceCeil(Math.max(firstHalf, secondHalf) * 1.2);
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f)); // top → bottom
  const pctFor = (v) => 100 - (v / max) * 100; // top-offset % for a value

  const x1 = 20, x2 = 80;
  const y1 = pctFor(firstHalf);
  const y2 = pctFor(secondHalf);

  return (
    <div>
      <div className="flex gap-3" style={{ height: 150 }}>
        {/* $ axis labels — real HTML text, always legible */}
        <div className="flex flex-col justify-between text-right shrink-0 w-11">
          {ticks.map((t) => (
            <span key={t} className="text-[11px] font-semibold text-slate-500 leading-none">{fmtMoney(t, currency)}</span>
          ))}
        </div>

        {/* Plot area */}
        <div className="relative flex-1">
          {ticks.map((t, i) => (
            <div
              key={t}
              className="absolute left-0 right-0 border-t border-dashed border-slate-200"
              style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
            />
          ))}

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4d7c0f" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#4d7c0f" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`M${x1},${y1} L${x2},${y2} L${x2},100 L${x1},100 Z`} fill="url(#rev-fill)" />
            <path
              d={`M${x1},${y1} L${x2},${y2}`}
              fill="none"
              stroke="#4d7c0f"
              strokeWidth="2"
              strokeDasharray="5,4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Value-labeled dots — the number sits inside the dot itself
              (HTML, not SVG text, for the same legibility reason as the
              axis labels above), like the reference "numbered dot" style. */}
          {[[x1, y1, firstHalf], [x2, y2, secondHalf]].map(([x, y, v], i) => (
            <div
              key={i}
              className="absolute rounded-full bg-[#4d7c0f] text-white text-[11px] font-bold flex items-center justify-center shadow-md ring-4 ring-lime-100"
              style={{
                left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)',
                minWidth: 40, height: 26, padding: '0 6px',
              }}
            >
              {fmtMoney(v, currency)}
            </div>
          ))}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex mt-2">
        <div className="w-11 shrink-0" />
        <div className="relative flex-1 h-4">
          <span className="absolute text-xs font-medium text-slate-500" style={{ left: `${x1}%`, transform: 'translateX(-50%)' }}>First Half</span>
          <span className="absolute text-xs font-medium text-slate-500" style={{ left: `${x2}%`, transform: 'translateX(-50%)' }}>Second Half</span>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Reseller Purchases — redesigned to match the requested reference layout:
// a revenue chart + KPI tiles at the top, filters + a transaction table in
// the middle, and a "Recent activity" / "Quick actions" rail on the right.
// Every number here is computed from GET /api/reseller/purchases — nothing
// is hard-coded or invented; on a fresh account with no transactions yet,
// this page correctly shows zeros and empty states.
// =============================================================================
export default function Purchases() {
  const { currentUser } = useApp();
  const [list, setList]     = useState(null);
  const [err, setErr]       = useState('');
  const [search, setSearch] = useState('');
  const [chip, setChip]     = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [copied, setCopied]     = useState(false);

  const currency = currentUser?.displayCurrency || 'USD';

  const load = async () => {
    setErr('');
    try {
      const r = await api('/api/reseller/purchases');
      setList(r.purchases || []);
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  // Everything downstream (KPIs, chart, table, activity feed) is derived from
  // this one date-filtered list so the numbers never drift from each other.
  const inRange = useMemo(() => {
    if (!list) return [];
    return list.filter((p) => {
      const day = ymd(p.createdAt);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [list, dateFrom, dateTo]);

  // Fixed rule, always applied: newest transaction first. This is enforced
  // here rather than just trusted from the API response, so the table's
  // order can never drift regardless of filters, search, or how the backend
  // happens to merge its two source tables (DID purchases + wallet ledger).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inRange
      .filter((p) => {
        if (chip !== 'all' && bucketOf(p) !== chip) return false;
        if (!q) return true;
        return (
          (p.customer.email   || '').toLowerCase().includes(q) ||
          (p.customer.company || '').toLowerCase().includes(q) ||
          (p.customer.name    || '').toLowerCase().includes(q) ||
          (p.description      || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [inRange, search, chip]);

  useEffect(() => { setPage(1); }, [search, chip, dateFrom, dateTo, pageSize]);

  // ---- KPI tiles ----------------------------------------------------------
  const totalTransactions = inRange.length;
  const walletTopups   = inRange.filter((p) => bucketOf(p) === 'topups');
  const walletTopupSum = walletTopups.reduce((a, p) => a + Number(p.amount || 0), 0);
  const refunds         = inRange.filter((p) => bucketOf(p) === 'refunds');
  const now = new Date();
  const thisMonthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const newPlansThisMonth = inRange.filter((p) => bucketOf(p) === 'purchases' && ymd(p.createdAt) >= thisMonthStart);

  const revenueTotal = inRange.reduce((a, p) => a + Number(p.amount || 0), 0);

  // ---- KPI sparklines — real last-7-day series per tile ----
  const sparkTransactions = useMemo(() => last7Days(inRange, () => 1), [inRange]);
  const sparkNewPlans     = useMemo(() => last7Days(inRange.filter((p) => bucketOf(p) === 'purchases'), () => 1), [inRange]);
  const sparkTopups       = useMemo(() => last7Days(walletTopups, (p) => Number(p.amount || 0)), [walletTopups]);
  const sparkRefunds      = useMemo(() => last7Days(refunds, () => 1), [refunds]);

  // ---- Revenue trend: First Half vs Second Half of the date range, both
  //      derived from real timestamps — no synthetic data when history is
  //      thin. Grouped by day first so a lopsided cluster of same-day
  //      transactions doesn't just become "1 point vs 1 point". ----
  const { firstHalfSum, secondHalfSum, changePct, hasPrior } = useMemo(() => {
    if (!inRange.length) return { firstHalfSum: 0, secondHalfSum: 0, changePct: null, hasPrior: false };
    const byDay = new Map();
    for (const p of inRange) {
      const day = ymd(p.createdAt);
      byDay.set(day, (byDay.get(day) || 0) + Number(p.amount || 0));
    }
    const days = [...byDay.keys()].sort();
    const mid = Math.ceil(days.length / 2);
    const firstHalfSum  = days.slice(0, mid).reduce((a, d) => a + byDay.get(d), 0);
    const secondHalfSum = days.slice(mid).reduce((a, d) => a + byDay.get(d), 0);
    const pct = firstHalfSum > 0 ? Math.round(((secondHalfSum - firstHalfSum) / firstHalfSum) * 100) : null;
    return { firstHalfSum, secondHalfSum, changePct: pct, hasPrior: firstHalfSum > 0 };
  }, [inRange]);

  // ---- Recent activity rail — the 5 newest events, in plain language. -----
  const recent = useMemo(
    () => [...(list || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5),
    [list],
  );
  const activityLine = (p) => {
    const who = p.customer.company || p.customer.name;
    if (p.kind === 'plan-change')     return <>Upgraded to <strong>{p.planLabel || 'a new plan'}</strong></>;
    if (p.kind === 'new-number-plan') return <>Purchased <strong>{p.planLabel || 'a plan'}</strong></>;
    if (p.kind === 'plan-restart')    return <>Restarted <strong>{p.planLabel || 'their plan'}</strong></>;
    if (p.kind === 'topup')           return <>Added {fmtMoney(p.amount, currency)} to wallet</>;
    if (p.kind === 'save-card')       return 'Saved a payment card';
    if (p.kind === 'signup')          return 'Created account';
    return p.description || 'Account activity';
  };

  // ---- Pagination -----------------------------------------------------
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const pageNumbers = useMemo(() => {
    const nums = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - pageSafe) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    return nums;
  }, [totalPages, pageSafe]);

  // ---- Export — real CSV of whatever is currently filtered, built client
  //      side from the same data already on screen. ----
  const exportCsv = () => {
    const header = ['Date', 'Customer', 'Email', 'Type', 'Description', 'Amount', 'Status'];
    const rows = filtered.map((p) => [
      fmtDateTime(p.createdAt),
      p.customer.company || p.customer.name,
      p.customer.email,
      KIND_LABEL[p.kind] || p.kind,
      p.description || '',
      p.amount,
      p.status,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan-purchases-${ymd(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPortalSlug = async () => {
    if (!currentUser?.resellerPortal) return;
    try {
      await navigator.clipboard.writeText(currentUser.resellerPortal);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable — silently ignore */ }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="font-bold text-black text-[15px] max-w-lg">
          Every plan buy, change, restart, and wallet top-up made by a customer
          in your portal.
        </p>
        <button className="btn-ghost btn-ghost-accent text-sm flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={14} strokeWidth={2} /> Refresh
        </button>
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {err}
        </div>
      )}

      {/* Top row: Revenue overview + KPI tiles on the left, Recent activity +
          Quick actions on the right — all four sit in one grid row so their
          tops (and, via items-stretch, their bottoms) line up. The filters
          and transaction table live below as full-width siblings, not
          nested inside this row, so the right rail never has to stretch to
          match the table's height. */}
      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="grid sm:grid-cols-2 gap-4">
            {/* Revenue overview */}
            <div className="form-card">
              <div className="flex items-center justify-between gap-2.5 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-lime-100 text-lime-700 flex items-center justify-center">
                    <TrendingUp size={18} strokeWidth={2.2} />
                  </div>
                  <div className="flex items-center gap-1.5 text-base font-bold text-slate-900">
                    Revenue overview
                    <Info size={14} strokeWidth={2} className="text-slate-300" />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-xs !py-1.5 !px-3 flex items-center gap-1.5"
                  onClick={() => setShowDateFilter((v) => !v)}
                >
                  <CalendarRange size={13} strokeWidth={2} />
                  {dateFrom || dateTo ? `${dateFrom || '…'} – ${dateTo || '…'}` : 'All time'}
                  <ChevronDown size={13} strokeWidth={2} />
                </button>
              </div>

              {showDateFilter && (
                <div className="mt-3 rounded-lg border border-slate-200 p-3">
                  <DateRangePicker from={dateFrom} to={dateTo} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />
                </div>
              )}

              <div className="mt-4 flex items-baseline gap-2">
                <div className="text-4xl font-extrabold text-slate-900">{list === null ? '—' : fmtMoney(revenueTotal, currency)}</div>
                {list !== null && changePct !== null && hasPrior && (
                  <span className={`pill text-xs font-semibold ${changePct >= 0 ? 'bg-lime-100 text-lime-700' : 'bg-red-100 text-red-700'}`}>
                    {changePct >= 0 ? '↑' : '↓'} {Math.abs(changePct)}%
                  </span>
                )}
              </div>
              <div className="text-sm text-mute mt-1">
                {dateFrom || dateTo ? 'in the selected range' : 'all-time, first half vs second half'}
              </div>

              <div className="mt-4">
                <RevenueChart firstHalf={firstHalfSum} secondHalf={secondHalfSum} currency={currency} empty={list === null || inRange.length === 0} />
              </div>

              {list !== null && inRange.length > 0 && (
                <div className="mt-3 rounded-xl bg-lime-50 border border-lime-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className="w-1 h-8 rounded-full bg-lime-500 shrink-0" />
                  <div>
                    <div className="text-[11px] text-mute font-semibold uppercase tracking-wider">First Half</div>
                    <div className="text-sm font-bold text-slate-900">{fmtMoney(firstHalfSum, currency)}</div>
                  </div>
                  <ArrowRight size={16} strokeWidth={2} className="text-slate-300 shrink-0" />
                  <div>
                    <div className="text-[11px] text-mute font-semibold uppercase tracking-wider">Second Half</div>
                    <div className="text-sm font-bold text-lime-700">{fmtMoney(secondHalfSum, currency)}</div>
                  </div>
                  <div className="ml-auto w-9 h-9 rounded-lg bg-lime-100 text-lime-700 flex items-center justify-center shrink-0">
                    <TrendingUp size={16} strokeWidth={2.2} />
                  </div>
                </div>
              )}
            </div>

            {/* KPI 2x2 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="form-card">
                <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center"><ArrowLeftRight size={15} strokeWidth={2} /></div>
                <div className="mt-2 text-sm font-medium text-slate-700">Transactions</div>
                <div className="text-2xl font-bold text-slate-900">{list === null ? '—' : totalTransactions}</div>
                <div className="text-xs text-mute mt-0.5">Total transactions</div>
                {list !== null && <Sparkline values={sparkTransactions} barClass="bg-purple-300" />}
              </div>
              <div className="form-card">
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center"><ShoppingBag size={15} strokeWidth={2} /></div>
                <div className="mt-2 text-sm font-medium text-slate-700">New plans bought</div>
                <div className="text-2xl font-bold text-slate-900">{list === null ? '—' : newPlansThisMonth.length}</div>
                <div className="text-xs text-mute mt-0.5">New this month</div>
                {list !== null && <Sparkline values={sparkNewPlans} barClass="bg-blue-300" />}
              </div>
              <div className="form-card">
                <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><Wallet size={15} strokeWidth={2} /></div>
                <div className="mt-2 text-sm font-medium text-slate-700">Wallet top-ups</div>
                <div className="text-2xl font-bold text-slate-900">{list === null ? '—' : fmtMoney(walletTopupSum, currency)}</div>
                <div className="text-xs text-mute mt-0.5">Total added</div>
                {list !== null && <Sparkline values={sparkTopups} barClass="bg-amber-300" />}
              </div>
              <div className="form-card">
                <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center"><Undo2 size={15} strokeWidth={2} /></div>
                <div className="mt-2 text-sm font-medium text-slate-700">Refunds</div>
                <div className="text-2xl font-bold text-slate-900">{list === null ? '—' : refunds.length}</div>
                <div className="text-xs text-mute mt-0.5">Total refunds</div>
                {list !== null && <Sparkline values={sparkRefunds} barClass="bg-red-300" />}
              </div>
            </div>
        </div>

        {/* ---- Right rail ---- */}
        <div className="space-y-4">
          <div className="form-card">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Recent activity</div>
            </div>
            {/* Capped + scrollable so this card's height stays predictable
                regardless of how many events there are — sized so Recent
                activity + Quick actions together land close to the same
                total height as the Revenue overview + KPI column, keeping
                Quick actions level with the cards on the left. */}
            <div className="mt-3 space-y-3 max-h-[190px] overflow-y-auto pr-1">
              {list === null && <div className="text-xs text-mute">Loading…</div>}
              {list && recent.length === 0 && <div className="text-xs text-mute">No activity yet.</div>}
              {recent.map((p) => {
                const bucket = BUCKET_META[bucketOf(p)];
                const Icon = bucket.icon;
                return (
                  <div key={p.id} className="flex items-start gap-2.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${bucket.iconWrap}`}>
                      <Icon size={13} strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{p.customer.company || p.customer.name}</div>
                      <div className="text-xs text-mute">{activityLine(p)}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{timeAgo(p.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="form-card">
            <div className="font-semibold text-sm mb-3">Quick actions</div>
            <div className="space-y-2">
              <Link to="/reseller/customers" className="btn-ghost w-full text-sm flex items-center justify-between !py-2.5">
                <span className="flex items-center gap-2"><Users size={15} strokeWidth={2} /> View customers</span>
                <ChevronRight size={14} strokeWidth={2} />
              </Link>
              <button type="button" onClick={copyPortalSlug} className="btn-ghost w-full text-sm flex items-center justify-between !py-2.5">
                <span className="flex items-center gap-2">
                  {copied ? <Check size={15} strokeWidth={2} className="text-lime-600" /> : <Link2 size={15} strokeWidth={2} />}
                  {copied ? 'Copied!' : 'Copy portal slug'}
                </span>
                {!copied && <ChevronRight size={14} strokeWidth={2} />}
              </button>
              <Link to="/reseller/plans" className="btn-ghost w-full text-sm flex items-center justify-between !py-2.5">
                <span className="flex items-center gap-2"><Settings2 size={15} strokeWidth={2} /> Manage plans</span>
                <ChevronRight size={14} strokeWidth={2} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Filters + table — full width, below the stats row ---- */}
      <div>
          {/* Filters */}
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search size={15} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
              <input
                type="search"
                className="input pl-9 text-sm"
                placeholder="Search transactions by customer, email, note…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {CHIPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChip(c.id)}
                  className={`pill text-xs font-semibold border transition-colors ${
                    chip === c.id ? 'bg-lime-50 text-lime-700 border-lime-300' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost text-xs !py-2 !px-3.5 flex items-center gap-1.5 ml-auto"
              onClick={exportCsv}
              disabled={!filtered.length}
            >
              <Download size={13} strokeWidth={2} /> Export
            </button>
          </div>

          {/* Transaction table */}
          <div className="mt-4 form-card p-0 overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Plan / item</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list === null && (
                  <tr><td colSpan={6} className="text-center text-mute py-6">Loading…</td></tr>
                )}
                {list && filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-mute py-6">
                    {list.length === 0
                      ? "No purchases yet — they'll show up as soon as a customer signs up or upgrades."
                      : 'No transactions match the current filters.'}
                  </td></tr>
                )}
                {pageRows.map((p) => {
                  const bucket = BUCKET_META[bucketOf(p)];
                  const Icon = bucket.icon;
                  const isCredit = p.amount > 0;
                  return (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${bucket.iconWrap}`}>
                            <Icon size={14} strokeWidth={2} />
                          </div>
                          <div>
                            <div className="text-xs text-mute">{fmtDateTime(p.createdAt)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="text-sm font-medium">{p.customer.company || p.customer.name}</div>
                        <div className="text-xs text-mute">{p.customer.email}</div>
                      </td>
                      <td>
                        <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${bucket.pill}`}>
                          {KIND_LABEL[p.kind] || bucket.label}
                        </span>
                      </td>
                      <td className="text-sm text-slate-700">
                        {p.planLabel || p.description || '—'}
                        {p.planCycle && <div className="text-xs text-mute capitalize">{p.planCycle}</div>}
                      </td>
                      <td className={`text-right whitespace-nowrap font-semibold ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                        {p.amount ? `${isCredit ? '+' : ''}${fmtMoney(p.amount, currency)}` : '—'}
                      </td>
                      <td>
                        <span className={`pill text-[10px] uppercase tracking-wider ${
                          p.status === 'succeeded' || p.status === 'success' || p.status === 'provisioned'
                            ? 'bg-green-100 text-green-700'
                            : p.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap text-sm">
              <div className="text-xs text-mute">
                Showing {(pageSafe - 1) * pageSize + 1} to {Math.min(pageSafe * pageSize, filtered.length)} of {filtered.length} transactions
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost !p-2" disabled={pageSafe <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={14} strokeWidth={2} />
                </button>
                {pageNumbers.map((n, i) => n === '…' ? (
                  <span key={`e${i}`} className="px-1 text-mute"><MoreHorizontal size={14} /></span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    className={`w-8 h-8 rounded-full text-xs font-semibold ${n === pageSafe ? 'bg-lime-100 text-lime-700' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {n}
                  </button>
                ))}
                <button type="button" className="btn-ghost !p-2" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight size={14} strokeWidth={2} />
                </button>
                <select className="input text-xs py-1.5 !w-auto ml-1" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
    </div>
  );
}
