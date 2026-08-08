import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt, Wallet, CheckCircle2, Globe, Search, SlidersHorizontal, Copy, Check,
} from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import DateRangePicker, { todayRange } from '../../components/DateRangePicker.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

// =============================================================================
// Transactions — the customer's payment history. Combines plan purchases (per
// DID) with wallet top-ups and auto-recharge charges from GET /api/transactions.
// Filterable by date range, kind, and free-text search, with CSV export.
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
// so "+ Add Funds" on the empty state doesn't have to navigate away.
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

const fmtDate = (d) => {
  const z = new Date(d);
  return isNaN(z.getTime()) ? '—' : z.toLocaleString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

// Local YYYY-MM-DD key for a timestamp — used to compare a row's date against
// the (from, to) range strings the DateRangePicker emits (also local).
const dateKey = (d) => {
  const z = new Date(d);
  if (isNaN(z.getTime())) return '';
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, '0');
  const day = String(z.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Human label + pill colour for each transaction kind. Covers both the wallet
// ledger kinds and the synthesised per-DID plan row.
const KIND_META = {
  plan:              { label: 'Plan + DID',      pill: 'bg-orange-100 text-orange-700' },
  'new-number-plan': { label: 'New plan + DID',  pill: 'bg-orange-100 text-orange-700' },
  'plan-change':     { label: 'Plan change',     pill: 'bg-orange-100 text-orange-700' },
  'plan-restart':    { label: 'Plan restart',    pill: 'bg-amber-100 text-amber-700' },
  topup:             { label: 'Wallet top-up',   pill: 'bg-emerald-100 text-emerald-700' },
  auto_recharge:     { label: 'Auto-recharge',   pill: 'bg-indigo-100 text-indigo-700' },
  'save-card':       { label: 'Card saved',      pill: 'bg-purple-100 text-purple-700' },
  signup:            { label: 'Signup',          pill: 'bg-fuchsia-100 text-fuchsia-700' },
  adjustment:        { label: 'Adjustment',      pill: 'bg-amber-100 text-amber-700' },
  refund:            { label: 'Refund',          pill: 'bg-rose-100 text-rose-700' },
  wallet:            { label: 'Wallet',          pill: 'bg-slate-100 text-slate-700' },
};
const kindMeta = (k) => KIND_META[k] || { label: k || 'Transaction', pill: 'bg-slate-100 text-slate-700' };

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
    <span className={`pill text-[10px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5 ${meta.pill}`}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  );
}

// Click-to-copy for the Ref column — pure client-side clipboard nicety, no
// new functionality beyond what the column already displayed.
function RefCell({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-mute font-mono text-xs">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable — no-op */ }
  };
  return (
    <button type="button" onClick={copy} className="txn-ref-btn" title="Copy reference">
      <span className="truncate">{value}</span>
      {copied ? <Check size={12} className="shrink-0" style={{ color: 'var(--primary)' }} /> : <Copy size={12} className="shrink-0" />}
    </button>
  );
}

export default function Transactions() {
  const { currentUser } = useApp();
  const [txns, setTxns]       = useState(() => readCache('transactions.txns', currentUser?.id));
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddFunds, setShowAddFunds] = useState(false);

  // Filters — default to "Today" so the page lands on a tight, current view
  // (matching the reseller/report surfaces). Users widen with "All time".
  const [range, setRange]   = useState(todayRange);
  const [kind, setKind]     = useState('all');
  const [search, setSearch] = useState('');

  // Payment provider label for the "Total paid via …" line + Provider column.
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

  // Resolve the active payment gateway once so the Provider column + subtitle
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

  // Rows that pass the date-range + kind + search filters.
  const filtered = useMemo(() => {
    if (!txns) return [];
    const q = search.trim().toLowerCase();
    const { from, to } = range;
    return txns.filter((t) => {
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
    });
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

  const totalPaid = filtered.reduce((a, t) => a + (Number(t.amount) || 0), 0);

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
          <button onClick={exportCsv} disabled={!filtered.length} className="btn-ghost text-sm">
            Export CSV
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost text-sm">
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>
      )}

      {/* Summary bar — one unified card instead of three separate boxes */}
      <div className="mt-6 form-card txn-summary">
        <div className="txn-metric">
          <div className="txn-metric-icon"><Receipt size={18} /></div>
          <div className="min-w-0">
            <div className="txn-metric-label">Transactions</div>
            <div className="txn-metric-value">{txns === null ? '—' : filtered.length}</div>
          </div>
        </div>
        <div className="txn-metric-divider" />
        <div className="txn-metric">
          <div className="txn-metric-icon"><Wallet size={18} /></div>
          <div className="min-w-0">
            <div className="txn-metric-label">Total paid</div>
            <div className="txn-metric-value">{totalPaid > 0 ? money(totalPaid) : '—'}</div>
            <div className="text-xs text-mute mt-0.5">via {provider}</div>
          </div>
        </div>
        <div className="txn-metric-divider" />
        <div className="txn-metric">
          <div className="txn-metric-icon"><Globe size={18} /></div>
          <div className="min-w-0">
            <div className="txn-metric-label">Portal</div>
            <div className="txn-metric-value font-mono truncate" style={{ fontSize: 18 }}>{portal}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 form-card">
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal size={13} style={{ color: 'var(--primary)' }} />
          <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: 'var(--ink-2)' }}>Filters</span>
        </div>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} accent="orange" />
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Kind</label>
            <div className="acct-input-wrap">
              <SlidersHorizontal size={14} className="acct-input-icon" />
              <select className="input acct-input-icon-pad text-sm py-1.5" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">All kinds ({txns ? txns.length : 0})</option>
                {kindCounts.map(([k, c]) => (
                  <option key={k} value={k}>{kindMeta(k).label} ({c})</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">Search</label>
            <div className="acct-input-wrap">
              <Search size={14} className="acct-input-icon" />
              <input
                type="search"
                className="input acct-input-icon-pad text-sm py-1.5"
                placeholder="description, ref, phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Transactions table */}
      <div className="mt-4 form-card p-0 overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr>
              <th className="w-[160px]">When</th>
              <th className="w-[140px]">Kind</th>
              <th>Description</th>
              <th className="w-[90px] text-right">Amount</th>
              <th className="w-[100px] text-center">Status</th>
              <th className="w-[100px]">Provider</th>
              <th className="w-[170px]">Ref</th>
            </tr>
          </thead>
          <tbody>
            {txns === null && (
              <tr><td colSpan={7} className="text-center text-mute py-10">Loading transactions…</td></tr>
            )}
            {txns !== null && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-0">
                  {(txns && txns.length === 0) ? (
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

                      <div className="mt-4 flex items-center gap-3 text-xs text-mute">
                        <Link to={`${basePath}/billing?tab=plans`} className="hover:underline" style={{ color: 'var(--primary)' }}>View Pricing</Link>
                        <span aria-hidden="true">•</span>
                        <Link to={`${basePath}/billing`} className="hover:underline" style={{ color: 'var(--primary)' }}>Learn about Billing</Link>
                      </div>
                    </div>
                  ) : (
                    <div className="animate-fade-up flex flex-col items-center text-center px-6 py-12">
                      <div className="w-14 h-14 flex items-center justify-center rounded-full" style={{ background: 'var(--surface-tint)' }}>
                        <Receipt className="w-6 h-6" style={{ color: 'var(--primary)' }} strokeWidth={1.5} />
                      </div>
                      <h3 className="mt-3 text-sm font-bold text-slate-900">No transactions in this date range</h3>
                      <p className="mt-1 text-xs text-mute max-w-xs">
                        {txns?.length ? `You have ${txns.length} transaction${txns.length === 1 ? '' : 's'} outside this range.` : 'Try widening the range to see more.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setRange({ from: '', to: '' })}
                        className="btn-ghost text-sm mt-4"
                      >
                        View all time
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )}
            {txns !== null && filtered.map((t) => {
              const meta = kindMeta(t.type);
              return (
                <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                  <td className="py-3 px-4 whitespace-nowrap text-slate-700 dark:text-slate-300">{fmtDate(t.date)}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={`pill text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ${meta.pill}`}>{meta.label}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-900 dark:text-slate-100 truncate">{t.description}</td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {t.amount ? money(t.amount) : '—'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="py-3 px-4 text-mute whitespace-nowrap truncate">{t.method || provider}</td>
                  <td className="py-3 px-4">
                    <RefCell value={t.ref} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
