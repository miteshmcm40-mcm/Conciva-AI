import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { readCache, writeCache, invalidateNumbersCaches } from '../../utils/swrCache.js';

// Stripe Checkout loader — duplicated from Billing.jsx so the per-number
// plan-change dropdown can open the same payment modal without forcing the
// customer to navigate elsewhere. The module-level _rzpLoad cache keeps a
// single <script> injection across both pages within a session.
let _rzpLoad;
function loadStripe() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (_rzpLoad) return _rzpLoad;
  _rzpLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.stripe.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(window.Stripe);
    s.onerror = () => reject(new Error('Could not load Stripe'));
    document.head.appendChild(s);
  });
  return _rzpLoad;
}

const inr = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// Light polling while any number is mid-provisioning — flips ready/failed in
// the UI without a full reload.
const POLL_INTERVAL_MS = 4000;

// Per-number plan tiers — kept in sync with server/plans.js. The plan id
// drives backend validation; the pill gives each tier a distinct accent.
const PLAN_OPTIONS = [
  { id: 'starter', label: 'Starter', pill: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  { id: 'growth',  label: 'Growth',  pill: 'bg-lime-100 text-lime-700 dark:bg-lime-500/30 dark:text-lime-200' },
  { id: 'scale',   label: 'Scale',   pill: 'bg-amber-500/20 text-amber-700 dark:bg-amber-500/30 dark:text-amber-200' },
];
const planPillClass = (id) => (PLAN_OPTIONS.find((p) => p.id === id) || PLAN_OPTIONS[0]).pill;

// Plan-card header band — green like the "+ Add plan / number" button
const planHeaderClass = () =>
  'bg-lime-600';

const StatusBadge = ({ status }) => {
  const map = {
    ready:       { cls: 'bg-lime-100 text-lime-700',     label: '● Live' },
    in_progress: { cls: 'bg-amber-500/20 text-amber-600', label: '⏳ Provisioning' },
    failed:      { cls: 'bg-red-500/20 text-red-600',     label: '✗ Failed' },
  };
  const s = map[status] || { cls: 'bg-slate-300/40 text-slate-600', label: status || 'unprovisioned' };
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
};

export default function Numbers() {
  const { currentUser } = useApp();
  const [data, setData] = useState(() => readCache('numbers.list', currentUser?.id) ?? null);
  const [err, setErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [changePlanFor, setChangePlanFor] = useState(null);   // number row being upgraded

  const load = async () => {
    try {
      const r = await api('/api/numbers');
      setData(r);
      writeCache('numbers.list', currentUser?.id, r);
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!data?.numbers?.some((n) => n.status === 'in_progress')) return;
    const t = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [data]);

  const deleteNumber = async (n) => {
    if (!confirm(`Release ${n.value}? Calls to this number will stop immediately.`)) return;
    try {
      await api(`/api/numbers/${n.id}`, { method: 'DELETE' });
      setActionMsg(`✓ ${n.value} released`);
      invalidateNumbersCaches();
      await load();
    } catch (e) {
      setActionMsg(`✗ ${e.message}`);
    }
  };

  if (!currentUser) return null;
  if (err) {
    return (
      <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-500">
        Couldn't load numbers: {err}
      </div>
    );
  }
  if (!data) return <div className="text-mute">Loading…</div>;

  const { numbers } = data;

  return (
    <div>
      {/* "Plan and Numbers" title now lives in the sticky top bar instead of here. */}
      {actionMsg && (
        <div className="mt-3 text-xs text-mute">{actionMsg}</div>
      )}

      <div className="mt-6 space-y-3">
        {numbers.length === 0 && (
          <div className="form-card text-center text-mute">
            No plans yet — click "Add plan" to buy your first plan + number.
          </div>
        )}
        {numbers.map((n) => (
          <div key={n.id} className="form-card overflow-hidden p-0">
            {/* ===== Plan-name header band ============================
                Plan tier is the first thing the customer sees on the
                card, with a brand colour stripe matching the tier. */}
            <div className={`px-5 py-3 ${planHeaderClass()} flex items-center justify-between gap-3 flex-wrap`}>
              <div className="flex items-center gap-2 flex-wrap text-white">
                <span className="text-base sm:text-lg font-bold">⭐ {n.plan?.label || 'Starter'} plan</span>
                <span className="text-sm opacity-90">· {inr(n.plan?.amount || 0)}/mo</span>
              </div>
              <button
                onClick={() => setChangePlanFor(n)}
                className="px-3 py-1.5 rounded-lg bg-white/90 hover:bg-white text-slate-900 text-xs font-semibold transition shadow-sm"
              >
                Change plan
              </button>
            </div>

            {/* ===== Body ============================================ */}
            <div className="p-5 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="font-mono text-lg text-slate-900">{n.value}</div>
                  {n.label && (
                    <span className="pill bg-lime-100 text-lime-700 text-xs">
                      🏷 {n.label}
                    </span>
                  )}
                  <StatusBadge status={n.status} />
                </div>
                {n.error && (
                  <div className="text-xs text-red-500 mt-1">⚠ {n.error}</div>
                )}
                <NumberRentalLine n={n} />
              </div>

              <div className="flex flex-col items-end gap-2">
                <Link to={`/dashboard/agent-detail?n=${n.id}`} className="btn-ghost text-xs">
                  🧠 Edit agent
                </Link>
                {!n.isPrimary && (
                  <button className="btn-ghost text-xs text-red-500" onClick={() => deleteNumber(n)}>
                    Release
                  </button>
                )}
                {n.isPrimary && (
                  <span className="text-xs text-mute">Cannot release primary</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {changePlanFor && (
        <ChangePlanModal
          number={changePlanFor}
          currentUser={currentUser}
          onClose={() => setChangePlanFor(null)}
          onApplied={async (msg) => {
            setActionMsg(msg);
            setChangePlanFor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// Per-number rental line — shows activation date + next rental anchor.
// The rental cycle is independent of the user's plan; each DID is metered
// on its own 30-day window from activatedAt.
function NumberRentalLine({ n }) {
  if (!n.activatedAt) return null;
  const fmt = (d) => new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  const next = n.nextRentalAt ? new Date(n.nextRentalAt) : null;
  const days = next ? Math.ceil((next.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const tone =
      n.rentStatus === 'overdue' || (days != null && days < 0) ? 'text-red-600'
    : days != null && days <= 5                                ? 'text-amber-600'
    :                                                            'text-mute';
  return (
    <div className={`text-xs mt-1 ${tone}`}>
      📅 Activated <strong>{fmt(n.activatedAt)}</strong>
      {next && (
        <>
          {' · '}
          renews <strong>{fmt(next)}</strong>
          {days != null && ` (${days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`})`}
        </>
      )}
    </div>
  );
}

// =============================================================================
// PlanCard — rich plan tile shared by ChangePlanModal and AddNumberModal.
// Mirrors the marketing pricing page: label + sub + price, a quick-stats
// line, then the full ✓ perks checklist. Badges call out current/featured
// status; the whole card is one button.
// =============================================================================
function PlanCard({ plan, isSelected, isCurrent, isFeatured, disabled, onClick }) {
  const agentsLabel = plan.agents >= 999 ? 'Unlimited agents' : `${plan.agents} agent${plan.agents === 1 ? '' : 's'}`;
  const subline = `${plan.min} included min · $${plan.rate}/min eff. · ${agentsLabel}`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative text-left rounded-xl border overflow-visible transition h-full flex flex-col ${
        isCurrent
          ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
          : isFeatured
            ? 'border-lime-400 bg-white hover:shadow-md'
            : 'border-neutral-200 bg-white hover:border-lime-300 hover:shadow-md'
      } ${isSelected && !isCurrent ? 'ring-4 ring-lime-200' : ''}`}
    >
      {isFeatured && !isCurrent && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-slate-900 text-white text-[11px] font-semibold shadow-lg shadow-black/20 whitespace-nowrap">
          <Star className="w-3 h-3 fill-current" /> Most Popular
        </span>
      )}

      <div className="rounded-xl overflow-hidden flex flex-col flex-1">
        {/* Header — label + sub + price, light lime tint (deeper for the
            featured tier) so every card reads as part of one family. */}
        <div className={`px-5 py-4 border-b ${
          isCurrent ? 'bg-gray-100 border-neutral-300' : isFeatured ? 'bg-lime-100 border-lime-200' : 'bg-lime-50 border-lime-100'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-lg font-semibold text-slate-900">{plan.label}</div>
            {isCurrent && (
              <span className="px-2 py-0.5 rounded-full bg-slate-700 text-white text-[10px] font-bold uppercase tracking-wider">
                Current plan
              </span>
            )}
          </div>
          {plan.sub && <div className="text-xs text-mute mt-0.5">{plan.sub}</div>}
          <div className="mt-3 flex items-end gap-1">
            <span className="text-4xl font-semibold text-slate-900">${Number(plan.amount).toLocaleString('en-US')}</span>
            <span className="text-gray-600">/mo</span>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4 flex flex-col flex-1">
          {/* Quick stats line — mirrors the marketing card's compact summary */}
          <div className="text-[11px] text-mute mb-3 leading-snug">{subline}</div>

          {/* Perks checklist */}
          <ul className="space-y-2.5 flex-1">
            {(plan.perks || []).map((perk, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full bg-lime-100 text-lime-700 flex items-center justify-center text-[9px] font-bold">✓</span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>

          {/* Selected indicator pinned to the card foot */}
          {isSelected && !isCurrent && (
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs font-semibold text-lime-700 text-center">
              ✓ Selected
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// =============================================================================
// ChangePlanModal — opens when the customer clicks "Change plan" on a number
// card. Shows the three plan cards, fetches a server-side pro-rata quote for
// the highlighted tier (credit for unused days on the current plan), and
// opens Stripe for the discounted amount.
// =============================================================================
export function ChangePlanModal({ number, currentUser, onClose, onApplied, defaultPlanId }) {
  const [plans, setPlans]       = useState([]);
  // Honour an explicit defaultPlanId when the modal is opened from the
  // Plans-catalog tab on Billing (so "Pick this plan" pre-selects the card
  // the customer just clicked). Falls back to the next-tier-up below.
  const [selectedId, setSelectedId] = useState(defaultPlanId || null);
  const [quote, setQuote]       = useState(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [err, setErr]           = useState('');
  const [busy, setBusy]         = useState(false);

  // Lock body scroll + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Fetch the plan catalog (drives the 3 plan cards).
  useEffect(() => {
    (async () => {
      try {
        const r = await api('/api/plans');
        const list = (r.plans || []).slice().sort((a, b) => (a.amount || 0) - (b.amount || 0));
        setPlans(list);
      } catch (e) { setErr(e.message); }
    })();
  }, []);

  // Pre-select the next-tier-up by default (or whichever isn't current).
  useEffect(() => {
    if (!plans.length || selectedId) return;
    const current = number?.plan?.id;
    const alt = plans.find((p) => p.id !== current) || plans[0];
    setSelectedId(alt.id);
  }, [plans, number, selectedId]);

  // Fetch the pro-rata quote whenever the customer highlights a different plan.
  useEffect(() => {
    if (!selectedId || !number?.id) return;
    let cancelled = false;
    setQuote(null); setQuoteErr('');
    (async () => {
      try {
        const r = await api(`/api/numbers/${number.id}/change-plan-quote?planId=${selectedId}`);
        if (!cancelled) setQuote(r.quote || null);
      } catch (e) {
        if (!cancelled) setQuoteErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, number?.id]);

  const fmtInr  = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const purchase = async () => {
    if (!selectedId || !quote) return;
    setBusy(true); setErr('');
    try {
      
      const order = await api('/api/stripe/checkout-session/number-plan', {
        method: 'POST', body: { numberId: Number(number.id), planId: selectedId },
      });
      if (order.url) { window.location.href = order.url; return; }
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl mt-12 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* === Header ============================================== */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">Change plan</div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {number?.value}
              {number?.label && <span className="text-sm text-mute font-normal ml-2">· {number.label}</span>}
            </div>
            <div className="mt-0.5 text-xs text-mute">
              Currently on <strong>{number?.plan?.label}</strong> · {fmtInr(number?.plan?.amount)}/mo
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-2xl text-mute hover:text-slate-900">×</button>
        </div>

        {err && (
          <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>
        )}

        {/* === Plan cards ========================================== */}
        <div className="p-6 grid md:grid-cols-3 gap-4">
          {plans.length === 0 && <div className="text-mute md:col-span-3">Loading plans…</div>}
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              isCurrent={number?.plan?.id === p.id}
              isSelected={selectedId === p.id}
              isFeatured={p.id === 'growth'}
              disabled={number?.plan?.id === p.id || busy}
              onClick={() => setSelectedId(p.id)}
            />
          ))}
        </div>

        {/* === Pro-rata quote panel =============================== */}
        {selectedId && number?.plan?.id !== selectedId && (
          <div className="mx-6 mb-4 rounded-xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--surface-tint)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--primary)' }}>You pay today</div>
            {quoteErr && <div className="mt-2 text-sm text-red-600">⚠ {quoteErr}</div>}
            {!quote && !quoteErr && <div className="mt-2 text-sm text-mute">Calculating…</div>}
            {quote && (
              <>
                <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex justify-between border-b pb-1.5" style={{ borderColor: 'var(--line-2)' }}>
                    <span className="text-mute">{quote.targetPlan.label} plan</span>
                    <span className="font-semibold text-slate-900">{fmtInr(quote.targetPlan.amount)}</span>
                  </div>
                  <div className="flex justify-between border-b pb-1.5" style={{ borderColor: 'var(--line-2)' }}>
                    <span className="text-mute">
                      Credit for {quote.daysRemaining.toFixed(0)} unused day{quote.daysRemaining === 1 ? '' : 's'}
                    </span>
                    <span className="font-semibold text-emerald-600">− {fmtInr(quote.creditInr)}</span>
                  </div>
                  <div className="flex justify-between sm:col-span-2 pt-1">
                    <span className="font-semibold text-slate-900">Total today</span>
                    <span className="text-2xl font-extrabold text-slate-900">{fmtInr(quote.amountInr)}</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t grid sm:grid-cols-2 gap-2 text-xs" style={{ borderColor: 'var(--line-2)' }}>
                  <div>
                    <div className="text-mute uppercase tracking-wider font-semibold">New plan starts</div>
                    <div className="mt-0.5 text-slate-900 font-semibold">{fmtDate(quote.newActivatedAt)}</div>
                  </div>
                  <div>
                    <div className="text-mute uppercase tracking-wider font-semibold">Renews on</div>
                    <div className="mt-0.5 text-slate-900 font-semibold">{fmtDate(quote.newExpiresAt)}</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* === Footer / CTA ======================================== */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={purchase}
            disabled={!quote || busy || number?.plan?.id === selectedId}
            className="btn-ghost btn-ghost-accent text-sm px-6"
          >
            {busy ? 'Opening Stripe…' : (quote ? `Pay ${fmtInr(quote.amountInr)} →` : 'Pick a plan')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// AddNumberModal — single-step "buy a plan, get a number" flow:
//   1. Customer picks a plan tier (Starter / Growth / Scale)
//   2. Backend auto-assigns the next available DID + opens Stripe
//   3. Confirmation card shows the assigned number + activation dates
// =============================================================================
export function AddNumberModal({ currentUser, onClose, onAdded }) {
  const [plans, setPlans]               = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);   // plan catalog entry
  const [preview, setPreview]           = useState(null);   // server's auto-assigned DID + dates
  const [busy, setBusy]                 = useState(false);
  const [err, setErr]                   = useState('');

  // Lock body scroll + close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Fetch plan catalog on mount.
  useEffect(() => {
    (async () => {
      try {
        const r = await api('/api/plans');
        const list = (r.plans || []).slice().sort((a, b) => (a.amount || 0) - (b.amount || 0));
        setPlans(list);
      } catch (e) { setErr(e.message); }
    })();
  }, []);

  const fmtInr  = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;
  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  // Buy: open Stripe for the chosen plan. The backend auto-assigns the DID
  // and bakes the assignment into the order id, so we don't need to send a
  // phoneNumber from the client.
  const purchase = async () => {
    if (!selectedPlan) return;
    setBusy(true); setErr('');
    try {
      
      const order = await api('/api/stripe/checkout-session/new-number-plan', {
        method: 'POST', body: { planId: selectedPlan.id },
      });
      // Capture the auto-assigned DID + activation dates from the order so we
      // can show the confirmation panel even before the Stripe handler runs.
      setPreview(order);

      if (order.url) { window.location.href = order.url; return; }
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl mt-12 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* === Header ============================================== */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">Add a plan</div>
            <div className="mt-1 text-lg font-bold text-slate-900">Pick a plan — we'll assign your phone number</div>
            <div className="mt-0.5 text-xs text-mute">
              Each plan comes with one new phone number, included minutes, and its own 30-day cycle.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-2xl text-mute hover:text-slate-900">×</button>
        </div>

        {err && (
          <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>
        )}

        {/* === Plan cards ========================================== */}
        <div className="p-6 grid md:grid-cols-3 gap-4">
          {plans.length === 0 && <div className="text-mute md:col-span-3">Loading plans…</div>}
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              isCurrent={false}
              isSelected={selectedPlan?.id === p.id}
              isFeatured={p.id === 'growth'}
              disabled={busy}
              onClick={() => setSelectedPlan(p)}
            />
          ))}
        </div>

        {/* === Confirmation panel ================================= */}
        {selectedPlan && (
          <div className="mx-6 mb-4 rounded-xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--surface-tint)' }}>
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--primary)' }}>Order summary</div>
            <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between border-b pb-1.5" style={{ borderColor: 'var(--line-2)' }}>
                <span className="text-mute">{selectedPlan.label} plan</span>
                <span className="font-semibold text-slate-900">{fmtInr(selectedPlan.amount)}</span>
              </div>
              <div className="flex justify-between border-b pb-1.5" style={{ borderColor: 'var(--line-2)' }}>
                <span className="text-mute">Phone number</span>
                <span className="font-mono text-slate-900">
                  {preview?.number?.value || '— assigned at checkout —'}
                </span>
              </div>
              <div className="flex justify-between sm:col-span-2 pt-1">
                <span className="font-semibold text-slate-900">Total today</span>
                <span className="text-2xl font-extrabold text-slate-900">{fmtInr(selectedPlan.amount)}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t grid sm:grid-cols-2 gap-2 text-xs" style={{ borderColor: 'var(--line-2)' }}>
              <div>
                <div className="text-mute uppercase tracking-wider font-semibold">Plan starts</div>
                <div className="mt-0.5 text-slate-900 font-semibold">
                  {preview?.activatesAt ? fmtDate(preview.activatesAt) : 'Today, on payment'}
                </div>
              </div>
              <div>
                <div className="text-mute uppercase tracking-wider font-semibold">Renews on</div>
                <div className="mt-0.5 text-slate-900 font-semibold">
                  {preview?.expiresAt
                    ? fmtDate(preview.expiresAt)
                    : fmtDate(new Date(Date.now() + 30 * 86400 * 1000).toISOString())
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === Footer / CTA ======================================== */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={purchase}
            disabled={!selectedPlan || busy}
            className="btn-ghost btn-ghost-accent text-sm px-6"
          >
            {busy
              ? 'Opening Stripe…'
              : (selectedPlan ? `Pay ${fmtInr(selectedPlan.amount)} →` : 'Pick a plan')
            }
          </button>
        </div>
      </div>
    </div>
  );
}
