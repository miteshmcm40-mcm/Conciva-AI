import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Wallet, Star, Phone, Calendar, RefreshCw, Lightbulb, Tag, CreditCard, X } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { readCache, writeCache, invalidateNumbersCaches } from '../../utils/swrCache.js';
import AddMinutesModal from '../../components/AddMinutesModal.jsx';
// Re-using the modals defined on the Numbers page so the buy/upgrade flows
// behave identically here (single source of truth for the catalog UI).
import { ChangePlanModal, AddNumberModal } from './Numbers.jsx';

const rand = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// Solid square-avatar background per plan tier — first-letter badges on the
// Auto-recharge cards (Starter/Growth/Scale each get their own accent).
const planAvatarClass = (label) => {
  const key = String(label || 'starter').toLowerCase();
  if (key === 'scale')  return 'bg-slate-700';
  if (key === 'growth') return 'bg-lime-600';
  return 'bg-amber-500';
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US');
};

// Stripe loader — shared with Numbers / AddMinutesModal.
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

// Razorpay Checkout loader — used by the Wallet tab's "Add funds" flow so
// top-ups open the native Razorpay popup (UPI / cards / netbanking / wallet)
// instead of redirecting off-page.
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

// Per-plan-tier pill colour for the "Starter / Growth / Scale" tag.
const planTagClass = (id) => {
  const key = String(id || 'starter').toLowerCase();
  if (key === 'scale')  return 'bg-amber-500/20 text-amber-700';
  if (key === 'growth') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-200 text-slate-700';
};

// Brand gradient — KallUS lime, matching --grad-start/--grad-mid/--grad-end
// in index.css so Billing uses the same primary color as the rest of the app.
const BRAND_GRADIENT = 'bg-[linear-gradient(135deg,#6fa524_0%,#5c8a1e_50%,#4d7c0f_100%)]';

const TABS = [
  { id: 'my-plans',     label: 'My Plans' },
  { id: 'plans',        label: 'Plans' },
  { id: 'wallet',       label: 'Wallet' },
  { id: 'autorecharge', label: 'Auto-recharge' },
];

export default function Billing() {
  const { currentUser } = useApp();
  const [searchParams] = useSearchParams();
  // Deep-link support (?tab=wallet etc.) — e.g. the "Add Funds" / "Browse
  // Plans" CTAs on the Transactions empty state land here directly.
  const tabParam = searchParams.get('tab');
  const [tab, setTab] = useState(TABS.some((t) => t.id === tabParam) ? tabParam : 'my-plans');

  const [stats, setStats] = useState(() => readCache('billing.stats', currentUser?.id) ?? null);
  const [statsErr, setStatsErr] = useState('');
  const [wallet, setWallet] = useState(() => readCache('billing.wallet', currentUser?.id) ?? null);
  const [transactions, setTransactions] = useState([]);
  const [packs, setPacks] = useState(() => readCache('billing.packs', currentUser?.id) ?? []);
  const [numbers, setNumbers] = useState(() => readCache('billing.numbers', currentUser?.id) ?? []);
  const [cards, setCards] = useState(() => readCache('billing.paymentMethods', currentUser?.id) ?? []);        // saved Stripe cards (payment_methods)
  const [calls, setCalls] = useState(() => readCache('billing.calls', currentUser?.id) ?? []);
  const [plans, setPlans] = useState(() => readCache('billing.plans', currentUser?.id) ?? []);
  const [err, setErr] = useState('');

  // Modal state shared across tabs.
  const [topUpFor, setTopUpFor] = useState(null);
  const [topUpGeneric, setTopUpGeneric] = useState(false);   // wallet "+ Add funds" (no specific DID)
  const [changePlanFor, setChangePlanFor] = useState(null);
  const [restartPlanFor, setRestartPlanFor] = useState(null);
  const [showAddPlan, setShowAddPlan] = useState(false);     // "+ Add plan / number" modal
  // When the customer clicks "Pick this plan" on the Plans catalog and they
  // own 2+ DIDs, we first need them to pick WHICH number to upgrade. Holds
  // the target plan id while that picker is open.
  const [pickNumberForPlan, setPickNumberForPlan] = useState(null);

  // Reset to true on every effect setup (not just once via useRef's initial
  // value) — React 18 StrictMode double-invokes effects in dev (mount →
  // cleanup → mount again), and without resetting it here the cleanup from
  // the first pass would permanently pin this to false, silently dropping
  // every state update `load()` makes for the rest of the component's life.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = async () => {
    setErr('');
    try {
      const [w, s, nums, callsRes, plansRes, cardsRes, packsRes] = await Promise.all([
        // A wallet fetch failure (e.g. no DB) must not block the other calls
        // in this batch — /api/plans and /api/wallet/packs are both static
        // catalogs that work with no DB at all, so the Plans tab and the
        // Wallet tab's preset amount buttons shouldn't get stuck just
        // because the wallet couldn't load.
        api('/api/wallet').catch((e) => { setErr(e.message); return { wallet: null, transactions: [] }; }),
        api('/api/twilio/stats').catch((e) => { setStatsErr(e.message); return null; }),
        api('/api/numbers').catch(() => ({ numbers: [] })),
        api('/api/twilio/calls?limit=500').catch(() => ({ calls: [] })),
        api('/api/plans').catch(() => ({ plans: [] })),
        api('/api/payment-methods').catch(() => ({ cards: [] })),
        api('/api/wallet/packs').catch(() => ({ packs: [] })),
      ]);
      if (!mountedRef.current) return;
      setWallet(w.wallet);
      writeCache('billing.wallet', currentUser?.id, w.wallet);
      setTransactions(w.transactions);
      setPacks(packsRes.packs || []);
      writeCache('billing.packs', currentUser?.id, packsRes.packs || []);
      if (s) { setStats(s); writeCache('billing.stats', currentUser?.id, s); }
      setNumbers(nums.numbers || []);
      writeCache('billing.numbers', currentUser?.id, nums.numbers || []);
      setCards(cardsRes.cards || []);
      writeCache('billing.paymentMethods', currentUser?.id, cardsRes.cards || []);
      setCalls(callsRes.calls || []);
      writeCache('billing.calls', currentUser?.id, callsRes.calls || []);
      const sortedPlans = (plansRes.plans || []).slice().sort((a, b) => (a.amount || 0) - (b.amount || 0));
      setPlans(sortedPlans);
      writeCache('billing.plans', currentUser?.id, sortedPlans);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) return null;

  // === Per-DID minutes-used aggregation ====================================
  const digitsOnly = (s) => String(s || '').replace(/\D+/g, '');
  const stripSip = (s) => {
    if (!s) return '';
    const m = String(s).match(/sip:([^@;]+)/);
    return m ? m[1] : s;
  };
  const usedMinutesForDid = (didValue) => {
    const did = digitsOnly(didValue);
    if (!did) return 0;
    let totalSec = 0;
    for (const c of calls) {
      const to = digitsOnly(stripSip(c.to));
      const from = digitsOnly(stripSip(c.from));
      if (to === did || from === did || to.endsWith(did) || from.endsWith(did)) {
        const completed = c.status === 'completed' || c.status === 'in-progress';
        if (completed) totalSec += Number(c.duration) || 0;
      }
    }
    return totalSec / 60;
  };

  return (
    <div>
      {/* ===== HEADER ====================================================== */}
      {/* No page-level "+ Add plan / number" here anymore — the sticky top
          bar (Customer.jsx) already shows one on every dashboard page,
          including this one, so a second copy here was a duplicate.
          "Active plans" below still has its own in-context copy. */}
      {/* Icon + "Billing & minutes" title now live in the sticky top bar
          instead of here — this row keeps just the subtitle + the transaction
          history link. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-base font-semibold tracking-wide animate-fade-up" style={{ color: 'var(--ink-2)' }}>
          <strong>KallUS</strong> Voice AI — plans per number, instant upgrades, shared wallet.
        </p>
        <Link to="/dashboard/transactions" className="btn-ghost btn-ghost-accent text-sm !rounded-lg px-[22px] py-[11px] font-semibold">
          Transaction history
        </Link>
      </div>

      {/* ===== TABS ======================================================== */}
      <div className="mt-6 border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 sm:px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                active
                  ? 'border-lime-600 text-lime-700'
                  : 'border-transparent text-mute hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {statsErr && <div className="mt-3 text-xs text-amber-700">⚠ Live usage unavailable: {statsErr}</div>}
      {err && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}

      {/* ===== TAB CONTENT =================================================== */}
      {tab === 'my-plans' && (
        <MyPlansTab
          numbers={numbers}
          wallet={wallet}
          usedMinutesForDid={usedMinutesForDid}
          onAddFunds={() => setTopUpGeneric(true)}
          onChangePlan={setChangePlanFor}
          onRestartPlan={setRestartPlanFor}
          onTopUpForNumber={setTopUpFor}
          onGoAutorecharge={() => setTab('autorecharge')}
          onAddPlan={() => setShowAddPlan(true)}
        />
      )}
      {tab === 'plans' && (
        <PlansTab
          plans={plans}
          numbers={numbers}
          onPickPlan={(planId) => {
            // 0 DIDs → buy a brand-new plan + DID
            if (numbers.length === 0) return setShowAddPlan(true);
            // 1 DID → upgrade it directly, pre-selecting the catalog plan
            if (numbers.length === 1) return setChangePlanFor({ number: numbers[0], defaultPlanId: planId });
            // 2+ DIDs → ask which number to upgrade first
            setPickNumberForPlan(planId);
          }}
        />
      )}
      {tab === 'wallet' && (
        <WalletTab
          wallet={wallet}
          transactions={transactions}
          packs={packs}
          currentUser={currentUser}
          onSaved={load}
        />
      )}
      {tab === 'autorecharge' && (
        <AutoRechargeTab
          numbers={numbers}
          cards={cards}
          onSaved={load}
          onGoWallet={() => setTab('wallet')}
        />
      )}

      {/* ===== MODALS ====================================================== */}
      {topUpFor && (
        <AddMinutesModal
          number={topUpFor}
          packs={packs}
          currentUser={currentUser}
          onClose={() => setTopUpFor(null)}
          onSuccess={() => { load(); }}
        />
      )}
      {topUpGeneric && (
        <AddMinutesModal
          number={numbers[0] || null}        // tag the topup with the primary DID for the ledger
          packs={packs}
          currentUser={currentUser}
          onClose={() => setTopUpGeneric(false)}
          onSuccess={() => { load(); }}
        />
      )}
      {restartPlanFor && (
        <RestartPlanModal
          number={restartPlanFor}
          currentUser={currentUser}
          onClose={() => setRestartPlanFor(null)}
          onApplied={async () => { setRestartPlanFor(null); await load(); }}
        />
      )}
      {changePlanFor && (
        <ChangePlanModal
          // changePlanFor can be either the bare number row (when opened from
          // the per-DID "Change plan" button) or an object { number, defaultPlanId }
          // (when opened from the Plans catalog with a target tier).
          number={changePlanFor.number || changePlanFor}
          defaultPlanId={changePlanFor.defaultPlanId}
          currentUser={currentUser}
          onClose={() => setChangePlanFor(null)}
          onApplied={async () => { setChangePlanFor(null); await load(); }}
        />
      )}
      {pickNumberForPlan && (
        <PickNumberToUpgradeModal
          numbers={numbers}
          targetPlanId={pickNumberForPlan}
          onClose={() => setPickNumberForPlan(null)}
          onPicked={(n) => {
            setPickNumberForPlan(null);
            setChangePlanFor({ number: n, defaultPlanId: pickNumberForPlan });
          }}
        />
      )}
      {showAddPlan && (
        <AddNumberModal
          currentUser={currentUser}
          onClose={() => setShowAddPlan(false)}
          onAdded={async () => { setShowAddPlan(false); await load(); }}
        />
      )}
    </div>
  );
}

// =============================================================================
// MyPlansTab — left: shared-wallet card + "how it works"; right: per-DID
// cards with progress bars, status pills, and 4 action buttons each.
// =============================================================================
function MyPlansTab({
  numbers, wallet, usedMinutesForDid,
  onAddFunds, onChangePlan, onRestartPlan, onTopUpForNumber, onGoAutorecharge, onAddPlan,
}) {
  const walletBalance = wallet?.walletUsd ?? 0;

  // Wallet-card action swap — same pattern as the per-DID action pills:
  // whichever button is hovered becomes the solid white "primary" one, the
  // other falls back to the transparent ghost style. Defaults to Add funds.
  const [hoveredWalletAction, setHoveredWalletAction] = useState(null);
  const activeWalletAction = hoveredWalletAction || 'add-funds';
  const walletSolidPill = 'px-3 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-semibold hover:bg-white/90 transition shadow-sm';
  const walletGhostPill = 'px-3 py-1.5 rounded-lg bg-white/12 hover:bg-white/20 text-white text-xs font-semibold transition border border-white/20';
  const walletPillClass = (id) => (activeWalletAction === id ? walletSolidPill : walletGhostPill);

  return (
    <div className="mt-6 grid lg:grid-cols-[260px_1fr] gap-6">
      {/* ====== Left sidebar ====== */}
      <div className="space-y-4">
        {/* Shared Wallet Balance */}
        <div className={`rounded-2xl p-5 text-white shadow-lg ${BRAND_GRADIENT}`}>
          <div className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 opacity-90">
            <Wallet className="w-3.5 h-3.5" />SHARED WALLET BALANCE
          </div>
          <div className="mt-2 text-4xl font-extrabold tracking-tight">
            {rand(walletBalance)}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onAddFunds}
              onMouseEnter={() => setHoveredWalletAction('add-funds')}
              onMouseLeave={() => setHoveredWalletAction(null)}
              className={walletPillClass('add-funds')}
            >
              + Add funds
            </button>
            <button
              onClick={onGoAutorecharge}
              onMouseEnter={() => setHoveredWalletAction('auto-recharge')}
              onMouseLeave={() => setHoveredWalletAction(null)}
              className={walletPillClass('auto-recharge')}
            >
              Auto-recharge
            </button>
          </div>
        </div>

      </div>

      {/* ====== Active plans ====== */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Active plans</h2>
        </div>

        {numbers.length === 0 ? (
          <div className="form-card text-center py-10">
            <p className="text-mute">No active plan yet.</p>
            <button className="btn-ghost btn-ghost-accent mt-3" onClick={onAddPlan}>Add a plan</button>
          </div>
        ) : (
          <div className="space-y-4">
            {numbers.map((n) => (
              <ActivePlanCard
                key={n.id}
                number={n}
                walletBalance={walletBalance}
                usedMinutes={usedMinutesForDid(n.value)}
                onChangePlan={() => onChangePlan(n)}
                onRestartPlan={() => onRestartPlan(n)}
                onTopUp={() => onTopUpForNumber(n)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ActivePlanCard — a single per-DID card with gradient header, label pill,
// status pill, phone number, minutes progress bar, dates, and action buttons.
// =============================================================================
function ActivePlanCard({ number: n, walletBalance, usedMinutes, onChangePlan, onRestartPlan, onTopUp }) {
  const planMin = Number(n.plan?.min) || 0;
  // Wallet rate for THIS number = the rate from THIS number's plan tier.
  // (Starter $12/min, Growth $11/min, Scale $10/min — never a flat $4.)
  const planRate = Number(n.plan?.rate) || 0;
  const used    = usedMinutes;
  const leftInPlan = Math.max(0, planMin - used);
  const overflow   = Math.max(0, used - planMin);
  const overflowCost = overflow * planRate;
  const planExhausted = used >= planMin && planMin > 0;

  // Progress bar — fills with the product accent while in-plan, switches to a
  // warm warning ramp once minutes overflow onto the wallet.
  const pct = planMin > 0 ? Math.min(100, (used / planMin) * 100) : 0;
  const barClass = planExhausted
    ? 'bg-gradient-to-r from-amber-500 to-red-500'
    : BRAND_GRADIENT;

  const renews = n.nextRentalAt ? new Date(n.nextRentalAt) : null;
  const daysLeft = renews ? Math.ceil((renews.getTime() - Date.now()) / 86400000) : null;
  // Same urgency thresholds as Numbers.jsx's NumberRentalLine — red once
  // overdue, amber inside the last 5 days, muted otherwise.
  const renewalTone =
      daysLeft != null && daysLeft < 0 ? 'text-red-600 font-semibold'
    : daysLeft != null && daysLeft <= 5 ? 'text-amber-600 font-semibold'
    : 'text-mute';
  const isPrimary = !!n.isPrimary;

  // Action-pill hover swap — whichever pill is hovered becomes the solid
  // green "primary" one and the rest fall back to plain white, so only one
  // action ever reads as "the" thing to click. Defaults to Change plan.
  const [hoveredAction, setHoveredAction] = useState(null);
  const activeAction = hoveredAction || 'change';
  const greenPill = `px-4 py-1.5 rounded-full border border-transparent text-white text-xs font-semibold transition-colors ${BRAND_GRADIENT}`;
  const whitePill = 'btn-ghost text-xs px-4 py-1.5 font-semibold transition-colors';
  const pillClass = (id) => (activeAction === id ? greenPill : whitePill);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* ===== Header band ===== */}
      <div className={`${BRAND_GRADIENT} px-5 py-3 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="text-white">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-base sm:text-lg font-bold">
              <Star className="w-4 h-4" fill="currentColor" /> {n.plan?.label || 'Starter'} plan
            </span>
            <span className="text-sm opacity-90">· {rand(n.plan?.amount || 0)}/mo</span>
          </div>
          <div className="text-xs sm:text-sm font-mono mt-0.5 opacity-95">{n.value}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {n.label && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-300 text-amber-900 text-xs font-semibold">
              <Tag className="w-3 h-3" /> {n.label}
            </span>
          )}
          {planExhausted ? (
            <span className="px-2.5 py-1 rounded-full bg-amber-300 text-amber-900 text-xs font-semibold">
              On wallet ${planRate}/min
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-white text-lime-700 text-xs font-semibold">
              ● Live
            </span>
          )}
        </div>
      </div>

      {/* ===== Body ===== */}
      <div className="p-5">
        {/* Minutes progress */}
        <div className="flex items-end justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Phone className="w-3.5 h-3.5" /> AI voice minutes
          </div>
          <div className="text-sm font-bold text-slate-900">
            {used.toFixed(0)} <span className="text-mute font-normal">of {planMin}</span>
            {overflow > 0 && (
              <span className="text-amber-600 font-semibold"> (+{overflow.toFixed(0)} on wallet)</span>
            )}
          </div>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full ${barClass} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-xs text-mute">
          {planExhausted
            ? `0 min left in plan · resets ${fmtDate(n.nextRentalAt)}`
            : `${leftInPlan.toFixed(0)} min left in plan · resets ${fmtDate(n.nextRentalAt)}`
          }
        </div>

        {/* Overflow warning */}
        {overflow > 0 && (
          <div className="mt-3 text-xs text-amber-700">
            Plan minutes used up — extra {overflow.toFixed(0)} min billed from wallet ({rand(overflowCost)}).
            <strong className="text-amber-800"> Restart plan to reset</strong>, or it resets on renewal.
          </div>
        )}

        {/* Dates */}
        <div className="mt-4 flex items-center gap-4 flex-wrap text-xs text-mute">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Activated <span className="text-slate-900 font-semibold">{fmtDate(n.activatedAt)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Renews <span className="text-slate-900 font-semibold">{fmtDate(n.nextRentalAt)}</span>
            {daysLeft != null && (
              <span className={renewalTone}>
                ({daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`})
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {/* Add-wallet-funds is gated by billing cycle:
              - Yearly plans → button visible (top up wallet for overflow)
              - Monthly plans → button hidden; customer must Restart plan
                instead to refresh the minute bucket. */}
        {(() => {
          const isYearly = n.planCycle === 'yearly';
          return (
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <button
                onClick={onChangePlan}
                onMouseEnter={() => setHoveredAction('change')}
                onMouseLeave={() => setHoveredAction(null)}
                className={pillClass('change')}
              >
                Change plan
              </button>
              <button
                onClick={onRestartPlan}
                onMouseEnter={() => setHoveredAction('restart')}
                onMouseLeave={() => setHoveredAction(null)}
                className={pillClass('restart')}
              >
                Restart plan
              </button>
              <Link
                to={`/dashboard/agents?n=${n.id}`}
                onMouseEnter={() => setHoveredAction('edit')}
                onMouseLeave={() => setHoveredAction(null)}
                className={pillClass('edit')}
              >
                Edit agent
              </Link>
              {isPrimary && (
                <span className="text-xs text-mute ml-1">Primary — cannot release</span>
              )}
              {isYearly ? (
                <button onClick={onTopUp} className="btn-ghost text-xs ml-auto">+ Add wallet funds</button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[11px] text-mute ml-auto"
                  title="Wallet top-ups are available on yearly plans. Restart the plan to refresh your minutes."
                >
                  <Lightbulb className="w-3 h-3" /> Monthly plan — restart to refresh minutes
                </span>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// =============================================================================
// PlansTab — catalog of all available plans, marketing-style.
// =============================================================================
function PlansTab({ plans, numbers, onPickPlan }) {
  const ownedPlanIds = new Set(numbers.map((n) => n.plan?.id).filter(Boolean));
  // Single-select card group — Growth is selected by default (it's also the
  // "Most popular" tier, but that badge is independent of selection and
  // always stays put; see isMostPopular below). Clicking any plan's CTA
  // both selects that card AND fires the real pick/upgrade flow — the
  // selection just persists as the visual "current choice" underneath
  // whatever modal onPickPlan opens.
  const [selectedPlan, setSelectedPlan] = useState('growth');
  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Available plans</h2>
      <p className="text-sm text-mute mb-4">
        Each plan provisions one phone number, includes voice minutes, and bills on its own 30-day cycle.
      </p>
      <div className="grid md:grid-cols-3 md:gap-6 gap-4 items-start">
        {plans.length === 0 && <div className="text-mute md:col-span-3">Loading plans…</div>}
        {plans.map((p, idx) => {
          const owned = ownedPlanIds.has(p.id);
          const isMostPopular = p.id === 'growth';
          const isSelected = p.id === selectedPlan;
          return (
            <div
              key={p.id}
              className={`relative rounded-xl overflow-visible bg-white border transition h-fit animate-fade-up ${
                isMostPopular ? 'border-lime-400' : 'border-neutral-200'
              } ${isSelected ? 'ring-4 ring-lime-200' : ''} ${!isMostPopular && !isSelected ? 'hover:border-lime-300' : ''}`}
              style={{ animationDelay: `${idx * 90}ms` }}
            >
              {isMostPopular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-slate-900 text-white text-[11px] font-semibold shadow-lg shadow-black/20 whitespace-nowrap">
                  <Star className="w-3 h-3 fill-current" /> Most Popular
                </span>
              )}
              <div className="rounded-xl overflow-hidden">
                <div className={`px-5 py-4 border-b ${isMostPopular ? 'bg-lime-100 border-lime-200' : 'bg-lime-50 border-lime-100'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">{p.label}</h3>
                    {owned && (
                      <span className="px-2 py-0.5 rounded-full bg-lime-600 text-white text-[10px] font-bold uppercase tracking-wider">
                        Already on it
                      </span>
                    )}
                  </div>
                  {p.sub && <div className="text-xs mt-0.5 text-mute">{p.sub}</div>}
                  <div className="mt-3 flex items-end gap-1">
                    <span className="text-4xl font-semibold text-gray-900">{rand(p.amount)}</span>
                    <span className="text-gray-600">/mo</span>
                  </div>
                </div>

                <div className="px-5 pb-5 pt-4 flex flex-col">
                  <div className="text-[11px] mb-3 text-mute">
                    {p.min} included min · ${p.rate}/min eff. · {p.agents >= 999 ? 'Unlimited agents' : `${p.agents} agents`}
                  </div>
                  <ul className="space-y-2.5 mb-5 flex-1">
                    {(p.perks || []).map((perk, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold bg-lime-100 text-lime-700">
                          ✓
                        </span>
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                  {/* CTA is hidden entirely for tiers the customer already owns
                      — the "Already on it" pill already conveys the status;
                      a button would just invite a duplicate purchase. */}
                  {!owned && (
                    <button
                      onClick={() => { setSelectedPlan(p.id); onPickPlan(p.id); }}
                      className={`btn-ghost btn-ghost-accent w-full text-sm font-semibold ${isMostPopular ? 'animate-modal-border-shadow' : ''}`}
                    >
                      {numbers.length > 0 ? 'Upgrade to this plan' : 'Pick this plan'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// WalletTab — wallet balance, top-up packs, full transaction history.
// =============================================================================
function WalletTab({ wallet, transactions, packs, currentUser, onSaved }) {
  const balance = wallet?.walletUsd ?? 0;
  // No flat wallet rate is displayed — when wallet covers a call, the
  // billing rate is whichever plan that DID sits on ($12 / $11 / $10).
  // We treat the wallet as a money bucket, not a minute bucket.
  const paymentMethod = wallet?.paymentMethod || null;

  // Pack picker state — defaults to the $1,000 "Best value" pack.
  const defaultPackId = packs?.find((p) => p.amount === 1000)?.id || packs?.[1]?.id || packs?.[0]?.id;
  const [selectedPackId, setSelectedPackId] = useState(defaultPackId);
  const [customAmount, setCustomAmount]     = useState('');
  const [topUpBusy, setTopUpBusy]           = useState(false);
  const [topUpErr, setTopUpErr]             = useState('');

  // Save-card flow
  const [saveCardBusy, setSaveCardBusy] = useState(false);
  const [saveCardErr, setSaveCardErr]   = useState('');

  // Low-minutes alert threshold — syncs from the wallet whenever it (re)loads,
  // but stays locally editable in between so typing isn't fought by refetches.
  const [threshold, setThreshold]         = useState(wallet?.lowBalanceThreshold ?? 20);
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [thresholdMsg, setThresholdMsg]   = useState('');

  useEffect(() => {
    if (wallet?.lowBalanceThreshold != null) setThreshold(wallet.lowBalanceThreshold);
  }, [wallet?.lowBalanceThreshold]);

  const saveThreshold = async () => {
    setThresholdBusy(true); setThresholdMsg('');
    try {
      await api('/api/wallet/preferences', {
        method: 'PATCH',
        body: { lowBalanceThreshold: Number(threshold) || 0 },
      });
      setThresholdMsg('✓ Saved');
      await onSaved?.();
    } catch (e) {
      setThresholdMsg(e.message || 'Could not save');
    } finally {
      setThresholdBusy(false);
    }
  };

  useEffect(() => {
    if (!selectedPackId && defaultPackId) setSelectedPackId(defaultPackId);
  }, [defaultPackId, selectedPackId]);

  const pickedPack = packs?.find((p) => p.id === selectedPackId) || null;
  const customAmountInt = Math.max(0, Math.floor(Number(customAmount) || 0));
  const finalAmount = customAmountInt > 0 ? customAmountInt : (pickedPack?.amount || 0);

  // Opens the native Razorpay Checkout popup (UPI / cards / netbanking /
  // wallet) instead of redirecting off-page. The server creates a real
  // Razorpay order first; the popup's success handler posts the returned
  // payment id + signature back to the server, which verifies the HMAC
  // signature before crediting the wallet — the amount credited always
  // comes from the verified Razorpay payment, never from anything the
  // browser sends directly.
  const addFunds = async () => {
    if (!finalAmount) return;
    setTopUpBusy(true); setTopUpErr('');
    try {
      const body = customAmountInt > 0
        ? { customAmount: customAmountInt }
        : { pack: selectedPackId };
      const order = await api('/api/razorpay/order/topup', { method: 'POST', body });
      const Razorpay = await loadRazorpay();

      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'KallUS',
        description: `Wallet top-up · ${rand(order.pack.amount)}`,
        order_id: order.orderId,
        prefill: order.prefill,
        theme: { color: '#4d7c0f' },
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
            setCustomAmount('');
            await onSaved?.();
          } catch (e) {
            setTopUpErr(e.message || 'Payment succeeded but crediting the wallet failed — contact support.');
          } finally {
            setTopUpBusy(false);
          }
        },
        modal: { ondismiss: () => setTopUpBusy(false) },
      });
      rzp.on('payment.failed', (resp) => {
        setTopUpErr(resp.error?.description || 'Payment failed');
        setTopUpBusy(false);
      });
      rzp.open();
    } catch (e) {
      setTopUpErr(e.message);
      setTopUpBusy(false);
    }
  };

  const saveCard = async () => {
    setSaveCardBusy(true); setSaveCardErr('');
    try {
      await startAddCard();
      await onSaved?.();
    } catch (e) {
      setSaveCardErr(e.message);
    } finally {
      setSaveCardBusy(false);
    }
  };

  const removeCard = async () => {
    if (!confirm('Remove the saved card? You\'ll need to add it again before auto-recharge can run.')) return;
    try {
      await api('/api/payment-method', { method: 'DELETE' });
      await onSaved?.();
    } catch (e) {
      setSaveCardErr(e.message);
    }
  };

  return (
    <div className="mt-6 grid lg:grid-cols-2 gap-5">
      {/* ====== Left column: Current Balance + Add funds ====== */}
      <div className="space-y-5">
        {/* Current Balance card */}
        <div className={`rounded-2xl p-6 text-white shadow-lg ${BRAND_GRADIENT}`}>
          <div className="text-xs font-semibold uppercase tracking-wider opacity-90 flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5" />CURRENT BALANCE
          </div>
          <div className="mt-2 text-4xl font-extrabold">{rand(balance)}</div>
          <div className="text-xs opacity-90 mt-1">
            Used as backup when a number's plan minutes run out.
          </div>
        </div>

        {/* Low-minutes alert card */}
        <div className="form-card">
          <div className="text-lg font-bold text-slate-900">Low-minutes alert</div>
          <div className="text-xs text-mute mt-1">
            We'll warn you on the dashboard and by email when your remaining minutes drop to this level.
          </div>
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <input
              type="number"
              min={0}
              step={1}
              className="input text-sm w-28"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={thresholdBusy}
            />
            <span className="text-sm text-slate-700">minutes left</span>
            <button
              onClick={saveThreshold}
              disabled={thresholdBusy}
              className="ml-auto btn-ghost btn-ghost-accent px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              {thresholdBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {thresholdMsg && <div className="mt-2 text-xs text-mute">{thresholdMsg}</div>}
        </div>

        {/* Add funds card */}
        <div className="form-card">
          <div className="text-lg font-bold text-slate-900">Add funds</div>
          <div className="text-xs text-mute mt-1">
            Pay-per-minute backup for when plan minutes run out.
          </div>

          {/* Pack grid */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(packs || []).map((p) => {
              const isPicked = !customAmountInt && selectedPackId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelectedPackId(p.id); setCustomAmount(''); }}
                  disabled={topUpBusy}
                  className={`rounded-lg border-2 p-3 text-center transition ${
                    isPicked
                      ? 'border-lime-500 ring-2 ring-lime-100 bg-lime-50/50'
                      : 'border-slate-200 bg-white hover:border-lime-300'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <div className="text-lg font-extrabold text-slate-900">{rand(p.amount)}</div>
                </button>
              );
            })}
          </div>

          {/* Custom amount */}
          <div className="mt-3">
            <input
              type="number"
              min={1}
              step={1}
              className="input text-sm"
              placeholder="Custom amount ($)"
              value={customAmount}
              onChange={(e) => { setCustomAmount(e.target.value); setSelectedPackId(null); }}
              disabled={topUpBusy}
            />
          </div>

          {/* CTA */}
          <button
            onClick={addFunds}
            disabled={topUpBusy || !finalAmount}
            className={`mt-4 w-full px-4 py-2.5 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT} disabled:opacity-60`}
          >
            {topUpBusy ? 'Opening Stripe…' : `Add ${rand(finalAmount)} to wallet`}
          </button>

          {topUpErr && <div className="mt-2 text-xs text-red-600">⚠ {topUpErr}</div>}

          <div className="mt-3 text-[11px] text-mute">
            Wallet funds never expire and are shared across all your numbers.
          </div>
        </div>
      </div>

      {/* ====== Right column: Payment method + Wallet history ====== */}
      <div className="space-y-5">
        {/* Payment method card */}
        <div className="form-card">
          <div className="text-lg font-bold text-slate-900">Payment method</div>
          {paymentMethod ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="shrink-0 w-12 h-8 rounded-md bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center uppercase tracking-wider">
                  {paymentMethod.network || 'CARD'}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {paymentMethod.network || 'Card'} ···· {paymentMethod.last4 || '••••'}
                  </div>
                  <div className="text-xs text-mute truncate">
                    Default · charged for plans &amp; recharge
                  </div>
                </div>
              </div>
              <button onClick={removeCard} className="btn-ghost text-xs">Remove</button>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3 text-xs text-mute text-center">
              No card on file yet. Save one to enable auto-recharge.
            </div>
          )}

          <button
            onClick={saveCard}
            disabled={saveCardBusy}
            className="mt-3 w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            {saveCardBusy ? 'Opening Stripe…' : (paymentMethod ? '+ Replace card' : '+ Add payment method')}
          </button>

          {saveCardErr && <div className="mt-2 text-xs text-red-600">⚠ {saveCardErr}</div>}
        </div>

        {/* Wallet history */}
        <div className="form-card">
          <div className="text-lg font-bold text-slate-900 mb-3">Wallet history</div>
          {transactions.length === 0 ? (
            <div className="text-mute text-sm py-3">No transactions yet.</div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-mute text-xs uppercase tracking-wider">
                    <th className="text-left font-semibold py-2 pl-1">Date</th>
                    <th className="text-left font-semibold py-2">Description</th>
                    <th className="text-right font-semibold py-2">Minutes</th>
                    <th className="text-right font-semibold py-2 pr-1">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="py-3 pl-1 text-xs text-mute whitespace-nowrap">
                        {fmtDate(t.createdAt)}
                      </td>
                      <td className="py-3 text-slate-900">
                        {t.description || t.kind}
                      </td>
                      <td className={`py-3 text-right ${t.minutesDelta < 0 ? 'text-slate-700' : 'text-slate-900'}`}>
                        {t.minutesDelta ? (t.minutesDelta > 0 ? `+${t.minutesDelta}` : t.minutesDelta) : '—'}
                      </td>
                      <td className={`py-3 pr-1 text-right font-semibold ${
                        Number(t.amountUsd) > 0 ? 'text-emerald-600' : 'text-slate-700'
                      }`}>
                        {t.amountUsd
                          ? (Number(t.amountUsd) > 0 ? `+${rand(Math.abs(t.amountUsd))}` : `−${rand(Math.abs(t.amountUsd))}`)
                          : '—'
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small reusable card pill (BRAND ···· 4242).
function CardPill({ card }) {
  if (!card) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 w-9 h-6 rounded bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center uppercase tracking-wider">
        {(card.brand || 'CARD').slice(0, 4)}
      </div>
      <div className="text-xs font-semibold text-slate-900">
        {card.brand || 'Card'} ···· {card.last4 || '••••'}
        {card.isDefault && <span className="ml-1 text-[10px] text-mute font-normal">(default)</span>}
      </div>
    </div>
  );
}

// Redirect to Stripe's hosted page to add a card. If a plan id is passed, we
// stash it so we can re-open that plan's chooser when Stripe redirects back.
// Saves a card via the native Razorpay popup instead of a page redirect —
// Razorpay tokenises the card when Checkout runs with a customer_id + a
// tiny $100 verification charge, which gets credited straight back to the
// wallet server-side so the customer isn't out of pocket for it. Resolves
// once the card is actually saved (server-verified), so callers can refresh
// their card list immediately instead of round-tripping through a redirect.
async function startAddCard() {
  const order = await api('/api/razorpay/order/save-card', { method: 'POST' });
  const Razorpay = await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'KallUS',
      description: 'Save card for auto-recharge',
      order_id: order.orderId,
      customer_id: order.customerId,
      recurring: 1,
      prefill: order.prefill,
      theme: { color: '#4d7c0f' },
      handler: async (response) => {
        try {
          const result = await api('/api/razorpay/verify/save-card', {
            method: 'POST',
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            },
          });
          resolve(result);
        } catch (e) { reject(e); }
      },
      modal: { ondismiss: () => reject(new Error('Card setup cancelled')) },
    });
    rzp.on('payment.failed', (resp) => reject(new Error(resp.error?.description || 'Payment failed')));
    rzp.open();
  });
}

// =============================================================================
// CardChooserModal — pick which saved card a plan's auto-recharge should use,
// or add a new one. Confirming enables auto-recharge for that plan.
// =============================================================================
function CardChooserModal({ number: n, cards, onClose, onConfirm, onCardSaved }) {
  const preselect = n.autoRechargePmId && cards.some((c) => c.id === n.autoRechargePmId)
    ? n.autoRechargePmId
    : (cards.find((c) => c.isDefault)?.id || cards[0]?.id || null);
  const [selected, setSelected] = useState(preselect);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = async () => {
    if (!selected) { setErr('Pick a card or add a new one.'); return; }
    setBusy(true); setErr('');
    try { await onConfirm(selected); }
    catch (e) { setErr(e.message || 'Could not enable auto-recharge'); setBusy(false); }
  };

  const addNew = async () => {
    setBusy(true); setErr('');
    try {
      await startAddCard();
      await onCardSaved?.();   // refreshes the cards list so the new one appears below
    } catch (e) {
      setErr(e.message || 'Could not save card');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-slate-900">Card for auto-recharge</div>
            <div className="inline-flex items-center gap-1 text-xs text-mute mt-0.5">
              <Star className="w-3 h-3" fill="currentColor" /> {n.plan?.label || 'Starter'} plan · <span className="font-mono">{n.value}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-mute hover:text-slate-900">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {cards.length === 0 ? (
            <div className="text-sm text-slate-700">
              No saved cards yet. Add one to turn on auto-recharge — it’s stored securely for future top-ups.
            </div>
          ) : (
            cards.map((c) => (
              <label key={c.id} className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 cursor-pointer transition ${
                selected === c.id ? 'border-lime-500 ring-2 ring-lime-100' : 'border-slate-200 hover:border-slate-300'
              }`}>
                <input
                  type="radio"
                  name="ar-card"
                  className="accent-lime-600"
                  checked={selected === c.id}
                  onChange={() => setSelected(c.id)}
                />
                <CardPill card={c} />
                {c.expMonth && c.expYear && (
                  <span className="ml-auto text-[11px] text-mute">exp {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}</span>
                )}
              </label>
            ))
          )}

          <button
            onClick={addNew}
            disabled={busy}
            className="w-full mt-1 px-3 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-700 hover:border-lime-300 hover:text-lime-700 transition disabled:opacity-60"
          >
            {busy ? 'Opening Razorpay…' : '+ Add a new card'}
          </button>
        </div>

        {err && <div className="px-5 pb-2 text-xs text-red-600">⚠ {err}</div>}

        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={confirm}
            disabled={busy || !cards.length || !selected}
            className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT} disabled:opacity-60`}
          >
            {busy ? 'Saving…' : 'Turn on with this card'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// AutoRechargeTab — per-plan toggle; each plan picks (or adds) its own card.
// =============================================================================
function AutoRechargeTab({ numbers, cards = [], onSaved, onGoWallet }) {
  const [pending, setPending] = useState({});      // { [id]: true | false } while a PATCH settles
  const [err, setErr]         = useState('');
  const [chooserFor, setChooserFor] = useState(null);   // the number whose chooser modal is open

  const cardById = (id) => cards.find((c) => c.id === id) || null;

  // Toggle OFF immediately; toggle ON opens the card chooser (the actual
  // enable happens once a card is confirmed in the modal).
  const onToggle = async (n, next) => {
    setErr('');
    if (next) { setChooserFor(n); return; }
    setPending((p) => ({ ...p, [n.id]: false }));
    try {
      await api(`/api/numbers/${n.id}`, { method: 'PATCH', body: { autoRechargeEnabled: false } });
      invalidateNumbersCaches();
      await onSaved?.();
    } catch (e) {
      setErr(e.message || 'Could not update auto-recharge');
    } finally {
      setPending((p) => { const c = { ...p }; delete c[n.id]; return c; });
    }
  };

  const confirmCard = async (n, pmId) => {
    await api(`/api/numbers/${n.id}`, {
      method: 'PATCH',
      body: { autoRechargeEnabled: true, autoRechargePmId: pmId },
    });
    invalidateNumbersCaches();
    setChooserFor(null);
    await onSaved?.();
  };

  const displayNumbers = numbers;
  const offCount = displayNumbers.filter((n) => {
    const isOn = pending[n.id] !== undefined ? pending[n.id] : !!n.autoRechargeEnabled;
    return !isOn;
  }).length;

  return (
    <div className="mt-6 grid lg:grid-cols-[1fr_300px] gap-6">
      {/* ====== Left column: per-plan list ====== */}
      <div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-lg font-bold text-slate-900">Auto-recharge per plan</div>
            <div className="text-xs text-mute mt-1">
              Turn auto-recharge on for the plans you want Razorpay to top up automatically using your saved card.
            </div>
          </div>
          <span className="pill bg-slate-100 text-slate-600 text-xs font-semibold whitespace-nowrap">○ {offCount} OFF</span>
        </div>

        {err && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>
        )}

        <div className="mt-4 space-y-3">
          {displayNumbers.length === 0 && (
            <div className="form-card text-center py-8 text-mute">No plans yet.</div>
          )}
          {displayNumbers.map((n) => {
            const isOn = pending[n.id] !== undefined ? pending[n.id] : !!n.autoRechargeEnabled;
            const planLabel = n.plan?.label || 'Starter';
            const planAmount = n.plan?.amount || 0;
            const assigned = cardById(n.autoRechargePmId);
            return (
              <div key={n.id} className="max-w-md rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`shrink-0 rounded-lg flex items-center justify-center text-white font-bold text-sm ${planAvatarClass(planLabel)}`}
                      style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, maxWidth: 36, maxHeight: 36, boxSizing: 'border-box' }}
                    >
                      {planLabel.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{planLabel} plan</span>
                        <span className={`pill text-[10px] font-semibold ${isOn ? 'bg-lime-100 text-lime-700' : 'bg-slate-100 text-slate-500'}`}>
                          {isOn ? 'ON' : 'OFF'}
                        </span>
                      </div>
                      <div className="text-sm font-mono text-blue-600 truncate">{n.value}</div>
                      <div className="text-xs text-mute">
                        {rand(planAmount)} /mo · {n.agentName || n.label || 'Unnamed agent'}
                      </div>
                    </div>
                  </div>

                  {/* Toggle — disabled only while its PATCH is in flight. */}
                  <label className="inline-flex items-center gap-2 select-none shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={isOn}
                      onChange={(e) => onToggle(n, e.target.checked)}
                      disabled={pending[n.id] !== undefined}
                    />
                    <span className="relative w-11 h-6 bg-slate-300 rounded-full transition peer-checked:bg-lime-500 after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:w-5 after:h-5 after:transition peer-checked:after:translate-x-5" />
                    <span className="text-sm font-semibold text-slate-900 w-7">{isOn ? 'On' : 'Off'}</span>
                  </label>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100">
                  {isOn ? (
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-xs text-mute">
                        <strong className="text-slate-900">Razorpay will charge</strong> when this plan's minutes run out:
                      </div>
                      {assigned ? (
                        <div className="flex items-center gap-3">
                          <CardPill card={assigned} />
                          <button onClick={() => setChooserFor(n)} className="text-xs text-lime-700 font-semibold hover:underline">
                            Change
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setChooserFor(n)} className="text-xs text-lime-700 font-semibold hover:underline">
                          Choose a card →
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-mute">
                      Attach a card, then turn this on to keep this line running without manual top-ups.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ====== Right column: saved cards + how-it-works ====== */}
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold text-mute uppercase tracking-wider">Saved cards</div>
          {cards.length ? (
            <div className="mt-2 space-y-2">
              {cards.map((c) => <CardPill key={c.id} card={c} />)}
            </div>
          ) : (
            <div className="mt-2 text-sm text-slate-700">
              No cards yet. Add one when you turn on a plan, or here.
            </div>
          )}
          <button
            className={`mt-3 w-full px-3 py-2 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT}`}
            onClick={onGoWallet}
          >
            + Add a card
          </button>
        </div>

        <div className="rounded-xl border border-lime-200 bg-lime-50/50 p-4 text-xs text-slate-700">
          <div className="flex items-center gap-1 font-semibold text-slate-900 mb-1">
            <Lightbulb className="w-3.5 h-3.5" /> How it works
          </div>
          <p>
            When a plan you've enabled runs out of minutes, Razorpay charges
            that plan's chosen card for the plan's amount and resets the cycle —
            calls keep going without manual intervention.
          </p>
        </div>
      </div>

      {chooserFor && (
        <CardChooserModal
          number={chooserFor}
          cards={cards}
          onClose={() => setChooserFor(null)}
          onConfirm={(pmId) => confirmCard(chooserFor, pmId)}
          onCardSaved={onSaved}
        />
      )}
    </div>
  );
}

// =============================================================================
// RestartPlanModal — confirm + Stripe flow that re-buys the same plan for
// a DID, resets minutes used, and bumps the cycle dates forward 30 days.
// =============================================================================
function RestartPlanModal({ number: n, currentUser, onClose, onApplied }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const purchase = async () => {
    setBusy(true); setErr('');
    try {
      
      const order = await api('/api/stripe/order/restart-plan', {
        method: 'POST', body: { numberId: Number(n.id) },
      });
      if (order.url) { window.location.href = order.url; return; }
    } catch (e) {
      setErr(e.message); setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="relative w-full max-w-md mt-24 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">Restart plan</div>
            <div className="mt-1 text-base font-bold text-slate-900">{n.value}</div>
            <div className="text-xs text-mute">{n.plan?.label} plan · {rand(n.plan?.amount)}</div>
          </div>
          <button onClick={onClose} className="text-2xl text-mute hover:text-slate-900">×</button>
        </div>
        <div className="px-6 py-5 space-y-3 text-sm text-slate-700">
          <p>
            Buying the same plan again resets the minutes counter to <strong>0 of {n.plan?.min}</strong> and
            extends the renewal date by <strong>30 days</strong> from today.
          </p>
          <p className="text-xs text-mute">
            Useful if you've burnt through the plan minutes early and want to refresh the bucket without waiting for the cycle to end.
          </p>
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={purchase}
            disabled={busy}
            className={`px-5 py-2 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT}`}
          >
            {busy ? 'Opening Stripe…' : `Pay ${rand(n.plan?.amount)} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PickNumberToUpgradeModal — shown when the customer clicks "Pick this plan"
// on the Plans catalog and has 2+ DIDs. They pick which DID to upgrade; the
// parent then opens ChangePlanModal pre-selected to the target tier.
// =============================================================================
function PickNumberToUpgradeModal({ numbers, targetPlanId, onClose, onPicked }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl mt-24 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">Upgrade a plan</div>
            <div className="mt-1 text-base font-bold text-slate-900">
              Which number do you want to upgrade?
            </div>
            <div className="text-xs text-mute mt-0.5">
              You'll get credit for the unused days on its current plan.
            </div>
          </div>
          <button onClick={onClose} className="text-2xl text-mute hover:text-slate-900">×</button>
        </div>

        <div className="p-5 space-y-2">
          {numbers.map((n) => {
            const isCurrent = n.plan?.id === targetPlanId;
            return (
              <button
                key={n.id}
                type="button"
                disabled={isCurrent}
                onClick={() => onPicked(n)}
                className={`w-full text-left rounded-xl border-2 p-4 transition flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                    : 'border-slate-200 bg-white hover:border-rose-400 hover:ring-2 hover:ring-rose-100'
                }`}
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-slate-900">{n.value}</div>
                  <div className="mt-0.5 text-xs text-mute flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Star className="w-3 h-3" fill="currentColor" /> Currently on <strong className="text-slate-700">{n.plan?.label || 'Starter'}</strong>
                    </span>
                    {n.label && (
                      <span className="inline-flex items-center gap-1">
                        · <Tag className="w-3 h-3" /> {n.label}
                      </span>
                    )}
                  </div>
                </div>
                {isCurrent
                  ? <span className="pill bg-slate-700 text-white text-[10px] uppercase tracking-wider">Already on it</span>
                  : <span className="text-xs font-semibold text-rose-600">Upgrade →</span>
                }
              </button>
            );
          })}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
