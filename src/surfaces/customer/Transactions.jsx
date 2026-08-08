import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt, Wallet, CheckCircle2, Globe, Search, SlidersHorizontal, Copy, Check,
  Calendar, ChevronDown, X, RefreshCw, CreditCard, UserPlus, RotateCcw, ArrowLeftRight,
  Download,
} from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import DateRangePicker, { todayRange } from '../../components/DateRangePicker.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

// =============================================================================
// Transactions — the customer's payment history. Combines plan purchases (per
// DID) with wallet top-ups and auto-recharge charges from GET /api/transactions.
// Filterable by date range, kind, and free-text search, with CSV export.
//
// Presented as a grouped statement (day headers + receipt-style rows) instead
// of a spreadsheet table — the same filtering/export/refresh machinery below,
// just a different lens on it.
// =============================================================================

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BRAND_GRADIENT = 'bg-[linear-gradient(135deg,var(--grad-start)_0%,var(--grad-mid)_50%,var(--grad-end)_100%)]';

// Razorpay Checkout loader — same pattern used by Billing.jsx's Wallet tab
// (each page that needs it loads its own copy rather than sharing a module,
// matching how Numbers.jsx/AddMinutesModal.jsx already do this).
let _razorpayLoad;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (_razorpayLoad) return _razorpayLoad;
  _razorpayLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error('Could not load Razorpay'));
    document.head.appendChild(s);
  });
  return _razorpayLoad;
}

// =============================================================================
// AddFundsModal — same wallet top-up flow as Billing.jsx's Wallet tab (pack
// picker + custom amount + real Razorpay Checkout), but as an in-place modal
// so "Add Funds" doesn't have to navigate away.
// =============================================================================
function AddFundsModal({ onClose, onSuccess }) {
  const [packs, setPacks] = useState([]);
  const [selectedPackId, setSelectedPackId] = useState(null);
  const [customAmount, setCustomAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api('/api/wallet/packs', { auth: false });
        if (cancelled) return;
        const list = r.packs || [];
        setPacks(list);
        const def = list.find((p) => p.amount === 1000) || list[1] || list[0];
        if (def) setSelectedPackId(def.id);
      } catch { /* pack grid just stays empty; custom amount still works */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const pickedPack = packs.find((p) => p.id === selectedPackId) || null;
  const customAmountInt = Math.max(0, Math.floor(Number(customAmount) || 0));
  const finalAmount = customAmountInt > 0 ? customAmountInt : (pickedPack?.amount || 0);

  const addFunds = async () => {
    if (!finalAmount) return;
    setBusy(true); setErr('');
    try {
      const body = customAmountInt > 0 ? { customAmount: customAmountInt } : { pack: selectedPackId };
      const order = await api('/api/razorpay/order/topup', { method: 'POST', body });
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'Conciva AI',
        description: `Wallet top-up · ${money(order.pack.amount)}`,
        order_id: order.orderId,
        prefill: order.prefill,
        theme: { color: '#c2410c' },
        handler: async (response) => {
          try {
            await api('/api/razorpay/verify/topup', {
              method: 'POST',
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                packId: order.pack.id,
              },
            });
            onSuccess?.();
            onClose();
          } catch (e) {
            setErr(e.message || 'Payment succeeded but crediting the wallet failed — contact support.');
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on('payment.failed', (resp) => { setErr(resp.error?.description || 'Payment failed'); setBusy(false); });
      rzp.open();
    } catch (e) {
      setErr(e.message); setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-backdrop-in" onClick={onClose}>
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 animate-modal-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900">Add funds</div>
            <div className="text-xs text-mute mt-1">Pay-per-minute backup for when plan minutes run out.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {packs.map((p) => {
            const isPicked = !customAmountInt && selectedPackId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedPackId(p.id); setCustomAmount(''); }}
                disabled={busy}
                className={`rounded-lg border-2 p-3 text-center transition ${
                  isPicked ? 'border-orange-500 ring-2 ring-orange-100 bg-orange-50/50' : 'border-slate-200 bg-white hover:border-orange-300'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="text-lg font-extrabold text-slate-900">{money(p.amount)}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          <input
            type="number"
            min={1}
            step={1}
            className="input text-sm"
            placeholder="Custom amount ($)"
            value={customAmount}
            onChange={(e) => { setCustomAmount(e.target.value); setSelectedPackId(null); }}
            disabled={busy}
          />
        </div>

        <button
          onClick={addFunds}
          disabled={busy || !finalAmount}
          className={`mt-4 w-full px-4 py-2.5 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT} disabled:opacity-60`}
        >
          {busy ? 'Opening Razorpay…' : `Add ${money(finalAmount)} to wallet`}
        </button>

        {err && <div className="mt-2 text-xs text-red-600">⚠ {err}</div>}

        <div className="mt-3 text-[11px] text-mute">Wallet funds never expire and are shared across all your numbers.</div>
      </div>
    </div>
  );
}

// Full date+time — used only for CSV export, where a precise timestamp matters.
const fmtDate = (d) => {
  const z = new Date(d);
  return isNaN(z.getTime()) ? '—' : z.toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

// Just the clock time — used in the row meta line, since the day is already
// carried by the group header above it.
const fmtTime = (d) => {
  const z = new Date(d);
  return isNaN(z.getTime()) ? '' : z.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

// Short "23 Aug" display — used for the date-range trigger and filter chips.
const fmtShort = (s) => {
  if (!s) return '…';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? '…' : dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
};

// Local YYYY-MM-DD key for a timestamp — used to compare a row's date against
// the (from, to) range strings the DateRangePicker emits (also local), and to
// bucket rows into day groups for the statement view.
const dateKey = (d) => {
  const z = new Date(d);
  if (isNaN(z.getTime())) return '';
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, '0');
  const day = String(z.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// "Today" / "Yesterday" / full weekday date — the label above each day's
// group of rows in the statement.
const groupLabel = (key) => {
  const today = dateKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = dateKey(y);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const [yy, mm, dd] = key.split('-').map(Number);
  const dt = new Date(yy, mm - 1, dd);
  return isNaN(dt.getTime())
    ? 'Unknown date'
    : dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

// Human label + presentation for each transaction kind. `tone` drives the
// amount's colour (money in vs. money out vs. neutral) and `icon`/`swatch`
// drive the row's leading avatar. Covers both the wallet ledger kinds and the
// synthesised per-DID plan row.
const KIND_META = {
  plan:              { label: 'Plan + DID',     icon: Receipt,        tone: 'out',     swatch: 'bg-orange-100 text-orange-700' },
  'new-number-plan': { label: 'New plan + DID', icon: Receipt,        tone: 'out',     swatch: 'bg-orange-100 text-orange-700' },
  'plan-change':     { label: 'Plan change',    icon: Receipt,        tone: 'out',     swatch: 'bg-orange-100 text-orange-700' },
  'plan-restart':    { label: 'Plan restart',   icon: RefreshCw,      tone: 'out',     swatch: 'bg-amber-100 text-amber-700' },
  topup:             { label: 'Wallet top-up',  icon: Wallet,         tone: 'in',      swatch: 'bg-emerald-100 text-emerald-700' },
  auto_recharge:     { label: 'Auto-recharge',  icon: RefreshCw,      tone: 'out',     swatch: 'bg-indigo-100 text-indigo-700' },
  'save-card':       { label: 'Card saved',     icon: CreditCard,     tone: 'neutral', swatch: 'bg-purple-100 text-purple-700' },
  signup:            { label: 'Signup',         icon: UserPlus,       tone: 'neutral', swatch: 'bg-fuchsia-100 text-fuchsia-700' },
  adjustment:        { label: 'Adjustment',     icon: ArrowLeftRight, tone: 'neutral', swatch: 'bg-amber-100 text-amber-700' },
  refund:            { label: 'Refund',         icon: RotateCcw,      tone: 'in',      swatch: 'bg-rose-100 text-rose-700' },
  wallet:            { label: 'Wallet',         icon: Wallet,         tone: 'neutral', swatch: 'bg-slate-100 text-slate-700' },
};
const kindMeta = (k) => KIND_META[k] || { label: k || 'Transaction', icon: Receipt, tone: 'neutral', swatch: 'bg-slate-100 text-slate-700' };

// Status pill colour + dot — small leading dot gives each row a quicker
// scannable signal than colour alone (helps colour-blind users too).
const STATUS_META = {
  success:   { label: 'Success', pill: 'bg-emerald-100 text-emerald-700', dot: '#059669' },
  succeeded: { label: 'Success', pill: 'bg-emerald-100 text-emerald-700', dot: '#059669' },
  paid:      { label: 'Paid',    pill: 'bg-emerald-100 text-emerald-700', dot: '#059669' },
  pending:   { label: 'Pending', pill: 'bg-amber-100 text-amber-700',    dot: '#d97706' },
  failed:    { label: 'Failed',  pill: 'bg-red-100 text-red-700',        dot: '#dc2626' },
};
const statusMeta = (s) => {
  const key = String(s || 'success').toLowerCase();
  return STATUS_META[key] || { label: s || 'Success', pill: 'bg-slate-100 text-slate-700', dot: '#64748b' };
};

function StatusPill({ status }) {
  const meta = statusMeta(status);
  return (
    <span className={`pill text-[9px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5 ${meta.pill}`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  );
}

// Click-to-copy for a transaction's reference — pure client-side clipboard
// nicety, no new functionality beyond what was already displayed.
function RefCell({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable — no-op */ }
  };
  return (
    <button type="button" onClick={copy} className="txn-ref-btn" title="Copy reference">
      <span className="truncate max-w-[120px]">{value}</span>
      {copied ? <Check size={11} className="shrink-0" style={{ color: 'var(--primary)' }} /> : <Copy size={11} className="shrink-0" />}
    </button>
  );
}

// Removable filter chip — used in the active-filters row under the toolbar.
function Chip({ label, onClear }) {
  return (
    <span className="txn-chip">
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`}><X size={11} /></button>
    </span>
  );
}

// Lightweight client-side bar chart of daily totals — built entirely from the
// already-fetched `filtered` rows, no extra API calls. Hidden when there's
// nothing meaningful to trend (0-1 day of data).
function SpendTrend({ data }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(([, v]) => v), 1);
  return (
    <div className="txn-trend" aria-hidden="true">
      {data.map(([k, v]) => (
        <div key={k} className="txn-trend-bar" style={{ height: `${Math.max(6, (v / max) * 100)}%` }} title={`${k} · ${money(v)}`} />
      ))}
    </div>
  );
}

// Pulsing placeholder rows shown while the first load is in flight — same
// grid shape as a real row so the layout doesn't jump once data lands.
function RowSkeleton() {
  return (
    <div className="txn-row">
      <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 animate-pulse shrink-0" />
      <div className="min-w-0 space-y-2">
        <div className="h-3.5 w-40 max-w-full bg-slate-100 rounded animate-pulse" />
        <div className="h-2.5 w-56 max-w-full bg-slate-100 rounded animate-pulse" />
      </div>
      <div className="text-right space-y-2">
        <div className="h-3.5 w-14 bg-slate-100 rounded animate-pulse ml-auto" />
        <div className="h-3 w-16 bg-slate-100 rounded animate-pulse ml-auto" />
      </div>
    </div>
  );
}

export default function Transactions() {
  const { currentUser } = useApp();
  const [txns, setTxns]       = useState(() => readCache('transactions.txns', currentUser?.id));
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddFunds, setShowAddFunds] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // Filters — default to "Today" so the page lands on a tight, current view
  // (matching the reseller/report surfaces). Users widen with "All time".
  const [range, setRange]   = useState(todayRange);
  const [kind, setKind]     = useState('all');
  const [search, setSearch] = useState('');

  // Payment provider label for the "Total paid via …" line + row meta.
  const [provider, setProvider] = useState('Razorpay');

  const portal = currentUser?.resellerPortal || 'conciva.ai';
  // This page is reused as-is under /admin (Admin.jsx also renders it) — the
  // empty-state links below must resolve against whichever shell is mounted.
  const isAdminTier = currentUser?.userType === 'superadmin' || currentUser?.userType === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const r = await api('/api/transactions');
      const next = r.transactions || [];
      setTxns(next);
      writeCache('transactions.txns', currentUser?.id, next);
    } catch (e) {
      setErr(e.message || 'Could not load transactions');
      setTxns((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Resolve the active payment gateway once so the "via …" line + row meta
  // read the real value (Razorpay / Stripe). Falls back to Razorpay.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api('/api/payment/config', { auth: false });
        const g = cfg?.gateway;
        if (!cancelled && g && g !== 'none') {
          setProvider(g.charAt(0).toUpperCase() + g.slice(1));
        }
      } catch { /* keep default */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Rows that pass the date-range + kind + search filters, newest first —
  // this order also drives the CSV export and the day-group order below.
  const filtered = useMemo(() => {
    if (!txns) return [];
    const q = search.trim().toLowerCase();
    const { from, to } = range;
    return txns
      .filter((t) => {
        const dk = dateKey(t.date);
        if (from && dk && dk < from) return false;
        if (to && dk && dk > to) return false;
        if (kind !== 'all' && (t.type || 'wallet') !== kind) return false;
        if (!q) return true;
        return (
          (t.description || '').toLowerCase().includes(q) ||
          (t.ref || '').toLowerCase().includes(q) ||
          (t.method || '').toLowerCase().includes(q) ||
          kindMeta(t.type).label.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [txns, range, kind, search]);

  // Distinct kinds present (across ALL rows, ignoring filters) with counts —
  // drives the Kind dropdown options.
  const kindCounts = useMemo(() => {
    const m = new Map();
    for (const t of txns || []) {
      const k = t.type || 'wallet';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()];
  }, [txns]);

  // Filtered rows bucketed into day groups, in the same newest-first order.
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of filtered) {
      const k = dateKey(t.date) || 'unknown';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return [...m.entries()];
  }, [filtered]);

  // Daily totals across the filtered set, oldest→newest, capped to the most
  // recent 14 buckets — feeds the spend trend sparkline.
  const trend = useMemo(() => {
    const m = new Map();
    for (const t of filtered) {
      const k = dateKey(t.date);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + (Number(t.amount) || 0));
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14);
  }, [filtered]);

  const totalPaid = filtered.reduce((a, t) => a + (Number(t.amount) || 0), 0);

  const defaultRange = todayRange();
  const isDefaultRange = range.from === defaultRange.from && range.to === defaultRange.to;
  const rangeSummary = !range.from && !range.to
    ? 'All time'
    : range.from === range.to
      ? (range.from === defaultRange.from ? 'Today' : fmtShort(range.from))
      : `${fmtShort(range.from)} – ${fmtShort(range.to)}`;
  const hasActiveFilters = kind !== 'all' || !!search.trim() || !isDefaultRange;

  const clearAll = () => { setKind('all'); setSearch(''); setRange({ from: '', to: '' }); };

  const exportCsv = () => {
    if (!filtered.length) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['When', 'Kind', 'Description', 'Amount', 'Status', 'Provider', 'Ref'];
    const lines = filtered.map((t) => [
      fmtDate(t.date), kindMeta(t.type).label, t.description,
      Number(t.amount || 0).toFixed(2), t.status || 'success',
      t.method || provider, t.ref || '',
    ].map(esc).join(','));
    const csv = [header.map(esc).join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${dateKey(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Icon + "Transactions" title now live in the sticky top bar instead of here. */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: 'var(--primary)' }}>
            Payment history
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-3)' }}>
            Every payment from this account — plan purchases, plan changes, restarts, and wallet top-ups.
            {loading && txns !== null && <span className="ml-2 text-xs text-mute">Refreshing…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowAddFunds(true)} className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5">
            <Wallet size={14} /> Add Funds
          </button>
          <button onClick={exportCsv} disabled={!filtered.length} className="btn-ghost text-sm inline-flex items-center gap-1.5">
            <Download size={14} /> Export
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost text-sm inline-flex items-center gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>
      )}

      {/* Hero — one dominant "Total paid" figure with a spend trend, plus two
          lighter supporting stats, instead of three equal-weight boxes. */}
      <div className="mt-6 form-card txn-hero">
        <div className="txn-hero-primary">
          <div className="txn-metric-label">
            Total paid <span className="normal-case font-normal text-mute">· via {provider}</span>
          </div>
          <div className="txn-hero-amount">{totalPaid > 0 ? money(totalPaid) : '—'}</div>
          <SpendTrend data={trend} />
        </div>
        <div className="txn-hero-secondary">
          <div className="txn-hero-stat">
            <div className="txn-metric-icon"><Receipt size={16} /></div>
            <div className="min-w-0">
              <div className="txn-metric-label">Transactions</div>
              <div className="txn-hero-stat-value">{txns === null ? '—' : filtered.length}</div>
            </div>
          </div>
          <div className="txn-hero-stat">
            <div className="txn-metric-icon"><Globe size={16} /></div>
            <div className="min-w-0">
              <div className="txn-metric-label">Portal</div>
              <div className="txn-hero-stat-value font-mono truncate" style={{ fontSize: 14 }}>{portal}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar — a compact single row instead of a full filter card: a date
          popover trigger, a kind select, and a search box that fills the rest
          of the space. Active filters surface as removable chips beneath. */}
      <div className="mt-4 form-card txn-toolbar-card">
        <div className="txn-toolbar">
          <div className="relative">
            <button
              type="button"
              onClick={() => setDateOpen((o) => !o)}
              className={`txn-filter-trigger${dateOpen || !isDefaultRange ? ' active' : ''}`}
            >
              <Calendar size={14} /> {rangeSummary} <ChevronDown size={13} />
            </button>
            {dateOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDateOpen(false)} />
                <div className="txn-date-popover">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: 'var(--ink-2)' }}>Date range</span>
                    <button type="button" onClick={() => setDateOpen(false)} className="acct-input-eye" aria-label="Close">
                      <X size={14} />
                    </button>
                  </div>
                  <DateRangePicker from={range.from} to={range.to} onChange={setRange} accent="orange" />
                </div>
              </>
            )}
          </div>

          <div className="acct-input-wrap txn-toolbar-select">
            <SlidersHorizontal size={14} className="acct-input-icon" />
            <select className="input acct-input-icon-pad text-sm py-2" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All kinds ({txns ? txns.length : 0})</option>
              {kindCounts.map(([k, c]) => (
                <option key={k} value={k}>{kindMeta(k).label} ({c})</option>
              ))}
            </select>
          </div>

          <div className="acct-input-wrap flex-1 min-w-[180px]">
            <Search size={14} className="acct-input-icon" />
            <input
              type="search"
              className="input acct-input-icon-pad text-sm py-2"
              placeholder="Search description, ref, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="txn-chip-row">
            {!isDefaultRange && <Chip label={rangeSummary} onClear={() => setRange(todayRange())} />}
            {kind !== 'all' && <Chip label={kindMeta(kind).label} onClear={() => setKind('all')} />}
            {!!search.trim() && <Chip label={`"${search.trim()}"`} onClear={() => setSearch('')} />}
            <button type="button" className="txn-chip-clear-all" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      {/* Statement — grouped by day, receipt-style rows instead of a table. */}
      <div className="mt-4 form-card p-0 overflow-hidden">
        {txns === null && (
          <div>
            <RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton />
          </div>
        )}

        {txns !== null && filtered.length === 0 && (
          (txns && txns.length === 0) ? (
            <div className="animate-fade-up flex flex-col items-center text-center px-6 py-14">
              {/* Illustration — wallet + checkmark badge, brand-orange accents, no emoji */}
              <div className="relative w-28 h-28 flex items-center justify-center rounded-full" style={{ background: 'var(--surface-tint)' }}>
                <Wallet className="w-12 h-12" style={{ color: 'var(--primary)' }} strokeWidth={1.5} />
                <span className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                  <CheckCircle2 className="w-6 h-6" style={{ color: 'var(--primary)' }} strokeWidth={1.75} />
                </span>
              </div>

              <h3 className="mt-5 text-lg font-bold text-slate-900">No transactions yet</h3>
              <p className="mt-2 text-sm text-mute max-w-sm">
                Your payments, wallet top-ups, plan purchases, and renewals will appear here once you start using Conciva AI.
              </p>

              <div className="mt-6 flex items-center gap-3 flex-wrap justify-center">
                <button type="button" onClick={() => setShowAddFunds(true)} className="btn-ghost btn-ghost-accent text-sm">+ Add Funds</button>
                <Link to={`${basePath}/billing?tab=plans`} className="btn-ghost text-sm">Browse Plans</Link>
              </div>

              <div className="mt-6 flex items-center gap-6 text-xs text-mute flex-wrap justify-center">
                <span className="inline-flex items-center gap-1.5"><Wallet size={13} style={{ color: 'var(--primary)' }} /> Fund your wallet</span>
                <span className="inline-flex items-center gap-1.5"><Receipt size={13} style={{ color: 'var(--primary)' }} /> Buy a plan + number</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={13} style={{ color: 'var(--primary)' }} /> Track it all here</span>
              </div>

              <div className="mt-5 flex items-center gap-3 text-xs text-mute">
                <Link to={`${basePath}/billing?tab=plans`} className="hover:underline" style={{ color: 'var(--primary)' }}>View Pricing</Link>
                <span aria-hidden="true">•</span>
                <Link to={`${basePath}/billing`} className="hover:underline" style={{ color: 'var(--primary)' }}>Learn about Billing</Link>
              </div>
            </div>
          ) : (
            <div className="animate-fade-up flex flex-col items-center text-center px-6 py-12">
              <div className="w-14 h-14 flex items-center justify-center rounded-full" style={{ background: 'var(--surface-tint)' }}>
                <Search className="w-6 h-6" style={{ color: 'var(--primary)' }} strokeWidth={1.5} />
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-900">No transactions match these filters</h3>
              <p className="mt-1 text-xs text-mute max-w-xs">
                You have {txns.length} transaction{txns.length === 1 ? '' : 's'} in total — try widening the date range or clearing a filter.
              </p>
              <button type="button" onClick={clearAll} className="btn-ghost text-sm mt-4">Clear filters</button>
            </div>
          )
        )}

        {txns !== null && groups.map(([key, rows]) => {
          const groupTotal = rows.reduce((a, t) => a + (Number(t.amount) || 0), 0);
          return (
            <div className="txn-group" key={key}>
              <div className="txn-group-header">
                <span>{groupLabel(key)}</span>
                <span className="txn-group-total">{money(groupTotal)}</span>
              </div>
              {rows.map((t) => {
                const meta = kindMeta(t.type);
                const Icon = meta.icon;
                return (
                  <div className="txn-row" key={t.id}>
                    <div className={`txn-row-icon ${meta.swatch}`}><Icon size={16} /></div>
                    <div className="min-w-0">
                      <div className="txn-row-title truncate">{t.description || meta.label}</div>
                      <div className="txn-row-meta">
                        <span className="txn-row-kind">{meta.label}</span>
                        <span className="txn-row-dot">·</span>
                        <span>{fmtTime(t.date)}</span>
                        <span className="txn-row-dot">·</span>
                        <span className="truncate">{t.method || provider}</span>
                        {t.ref && <span className="txn-row-dot">·</span>}
                        <RefCell value={t.ref} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`txn-row-amount${meta.tone === 'in' ? ' txn-amount-in' : ''}`}>
                        {t.amount ? money(t.amount) : '—'}
                      </div>
                      <div className="mt-1"><StatusPill status={t.status} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer count */}
      <div className="mt-3 text-right text-xs text-mute">
        Showing {filtered.length} of {txns ? txns.length : 0} transactions
      </div>

      {showAddFunds && (
        <AddFundsModal
          onClose={() => setShowAddFunds(false)}
          onSuccess={load}
        />
      )}
    </div>
  );
}
