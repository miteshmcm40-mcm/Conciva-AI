import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Check, Pencil, X } from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';
// The app's real buy-a-plan flow — the same modal the global
// "+ Add plan / number" button opens. Reused rather than reimplemented so
// there's only one purchase path to keep working.
import { AddNumberModal } from './Numbers.jsx';

// =============================================================================
// Plans & pricing — the full catalog on one page.
//
// Every value here comes from GET /api/plans (source of truth: server/plans.js).
// Nothing is hardcoded or invented: amount, yearlyAmount, yearlySavingsUsd,
// min, rate, overage, dids, concurrent, agents, voiceStack, support, tag, sub
// and perks are all real fields on the plan objects.
//
// This page deliberately surfaces what the Billing → Plans tab does NOT: the
// yearly prices (the API already returns yearlyAmount + yearlySavingsUsd) and
// the per-tier capacity fields, which had no UI anywhere before.
// =============================================================================

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// Capacity rows for the comparison table. `get` reads only fields the API
// actually returns — a plan missing one renders "—" rather than a guess.
const COMPARE_ROWS = [
  { label: 'Included minutes',   get: (p) => (p.min != null ? Number(p.min).toLocaleString('en-US') : null) },
  { label: 'Effective rate',     get: (p) => (p.rate != null ? `$${p.rate}/min` : null) },
  { label: 'Overage rate',       get: (p) => (p.overage != null ? `$${p.overage}/min` : null) },
  { label: 'Phone numbers',      get: (p) => (p.dids != null ? p.dids : null) },
  { label: 'Concurrent calls',   get: (p) => (p.concurrent != null ? p.concurrent : null) },
  { label: 'AI voice agents',    get: (p) => (p.agents == null ? null : p.agents >= 999 ? 'Unlimited' : p.agents) },
  { label: 'Voice stack',        get: (p) => p.voiceStack || null },
  { label: 'Support',            get: (p) => p.support || null },
];

export default function Pricing() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [plans, setPlans] = useState(() => readCache('pricing.plans', currentUser?.id) ?? []);
  const [numbers, setNumbers] = useState(() => readCache('pricing.numbers', currentUser?.id) ?? []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [cycle, setCycle] = useState('monthly');
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingPlan, setEditingPlan] = useState(null);

  // Matches the server's own check (requireAdmin: req.user.role !== 'admin')
  // exactly, so the pencil never shows for someone whose PATCH would 403 —
  // e.g. a superadmin whose role happens to still read 'user'/'customer'.
  const canEditPlans = currentUser?.role === 'admin';

  useEffect(() => {
    let cancelled = false;

    // Two independent endpoints — fire both immediately instead of waiting
    // for /api/plans to fully resolve before /api/numbers even starts.
    // auth:false — /api/plans is public and works with no DB attached,
    // so the catalog renders even when everything else is offline.
    api('/api/plans', { auth: false })
      .then((r) => {
        if (cancelled) return;
        const nextPlans = r.plans || [];
        setPlans(nextPlans);
        writeCache('pricing.plans', currentUser?.id, nextPlans);
      })
      .catch((e) => { if (!cancelled) setErr(e.message || 'Could not load plans'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Only used to mark tiers the customer already owns. Optional — a
    // failure here just means no "Current plan" badges.
    api('/api/numbers')
      .then((n) => {
        if (cancelled) return;
        const nextNumbers = n.numbers || [];
        setNumbers(nextNumbers);
        writeCache('pricing.numbers', currentUser?.id, nextNumbers);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [reloadKey]);

  const ownedPlanIds = new Set(numbers.map((n) => n.plan?.id).filter(Boolean));

  // This component renders under both /dashboard and /admin.
  const isAdminTier = currentUser?.userType === 'superadmin' || currentUser?.userType === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  // Buying a first plan and changing an existing one are two different flows,
  // and only the first one lives in a reusable component. AddNumberModal
  // provisions a new plan + number (the same thing the "+ Add plan / number"
  // button does). Upgrading an existing number needs Billing's ChangePlanModal
  // plus its "which number?" step, so that case hands off to Billing rather
  // than growing a second, drifting copy of that flow here.
  const pickPlan = () => {
    if (numbers.length === 0) return setShowAddPlan(true);
    navigate(`${basePath}/billing`);
  };
  const isYearly = cycle === 'yearly';

  // Cheapest tier that actually reports a yearly saving — drives the
  // "save up to N%" hint. Omitted entirely if the API returns no yearly data.
  const bestSavingPct = plans.reduce((best, p) => {
    if (!p.yearlySavingsUsd || !p.amount) return best;
    const pct = Math.round((p.yearlySavingsUsd / (p.amount * 12)) * 100);
    return Math.max(best, pct);
  }, 0);

  return (
    <div>
      {/* Icon + "Plans & pricing" title now live in the sticky top bar instead of here. */}
      <p className="text-base font-semibold tracking-wide animate-fade-up" style={{ color: 'var(--ink-2)' }}>
        Every plan provisions phone numbers, includes voice minutes, and bills on its own cycle.
      </p>

      {/* Monthly / yearly switch — yearly figures come straight from the API's
          yearlyAmount, not computed in the browser. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full p-1" style={{ background: 'var(--surface-2)' }}>
          {['monthly', 'yearly'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className="px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition"
              style={cycle === c
                ? { background: 'var(--primary)', color: '#fff' }
                : { color: 'var(--ink-2)' }}
            >
              {c}
            </button>
          ))}
        </div>
        {bestSavingPct > 0 && (
          <span className="text-sm text-mute">Save up to {bestSavingPct}% paying yearly.</span>
        )}
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>
      )}

      {/* === Plan cards ============================================== */}
      <div className="mt-6 grid md:grid-cols-3 md:gap-6 gap-4 items-start">
        {loading && <div className="text-mute md:col-span-3">Loading plans…</div>}
        {!loading && plans.length === 0 && !err && (
          <div className="text-mute md:col-span-3">No plans available.</div>
        )}
        {plans.map((p, idx) => {
          const owned = ownedPlanIds.has(p.id);
          const popular = !!p.tag;
          const isGrowth = p.id === 'growth';
          const price = isYearly ? p.yearlyAmount : p.amount;
          return (
            <div
              key={p.id}
              className={`relative rounded-xl overflow-visible bg-white border transition h-fit animate-fade-up ${
                popular ? 'border-lime-400' : 'border-neutral-200'
              }`}
              style={{ animationDelay: `${idx * 90}ms` }}
            >
              {/* Badge text is the plan's own `tag` field, not a hardcoded string. */}
              {popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-slate-900 text-white text-[11px] font-semibold shadow-lg shadow-black/20 whitespace-nowrap">
                  <Star className="w-3 h-3 fill-current" /> {p.tag}
                </span>
              )}
              {/* Admin-only — PATCH /api/admin/base-plans/:id. Hidden for
                  everyone else; the customer-facing card is unchanged. */}
              {canEditPlans && (
                <button
                  type="button"
                  onClick={() => setEditingPlan(p)}
                  title={`Edit ${p.label}`}
                  className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full grid place-items-center bg-white border border-neutral-200 text-neutral-500 shadow-sm hover:border-lime-400 hover:text-lime-700 transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <div className="rounded-xl overflow-hidden">
                <div className={`px-5 py-4 border-b ${popular ? 'bg-lime-100 border-lime-200' : 'bg-lime-50 border-lime-100'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">{p.label}</h3>
                    {owned && (
                      <span className="px-2 py-0.5 rounded-full bg-lime-600 text-white text-[10px] font-bold uppercase tracking-wider">
                        Current plan
                      </span>
                    )}
                  </div>
                  {p.sub && <div className="text-xs mt-0.5 text-mute">{p.sub}</div>}
                  <div className="mt-3 flex items-end gap-1">
                    <span className="text-4xl font-semibold text-gray-900">
                      {price != null ? usd(price) : '—'}
                    </span>
                    <span className="text-gray-600">{isYearly ? '/yr' : '/mo'}</span>
                  </div>
                  {isYearly && p.yearlySavingsUsd > 0 && (
                    <div className="mt-1 text-xs font-semibold text-lime-700">
                      Save {usd(p.yearlySavingsUsd)} vs monthly
                    </div>
                  )}
                </div>

                <div className="px-5 pb-5 pt-4 flex flex-col">
                  <div className="text-[11px] mb-3 text-mute">
                    {p.min != null && <>{Number(p.min).toLocaleString('en-US')} included min</>}
                    {p.rate != null && <> · ${p.rate}/min eff.</>}
                    {p.agents != null && <> · {p.agents >= 999 ? 'Unlimited agents' : `${p.agents} agents`}</>}
                  </div>
                  <ul className="space-y-2.5 mb-5 flex-1">
                    {(p.perks || []).map((perk, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center bg-lime-100 text-lime-700">
                          <Check className="w-2.5 h-2.5" strokeWidth={3} />
                        </span>
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Hidden for tiers already owned — the "Current plan" pill
                      says it, and a button would invite a duplicate purchase.
                      Same call Billing's Plans tab makes. */}
                  {!owned && (
                    <button
                      onClick={pickPlan}
                      className={`btn-ghost btn-ghost-accent w-full text-sm font-semibold ${isGrowth ? 'animate-modal-border-shadow' : ''}`}
                    >
                      {numbers.length > 0 ? 'Change plan in Billing' : 'Pick this plan'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* === Comparison table ======================================== */}
      {plans.length > 0 && (
        <div className="mt-6 form-card p-0 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Compare plans</th>
                {plans.map((p) => <th key={p.id} className="text-right">{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="font-semibold">{isYearly ? 'Price / year' : 'Price / month'}</td>
                {plans.map((p) => {
                  const price = isYearly ? p.yearlyAmount : p.amount;
                  return <td key={p.id} className="text-right font-semibold">{price != null ? usd(price) : '—'}</td>;
                })}
              </tr>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <td className="font-semibold">{row.label}</td>
                  {plans.map((p) => {
                    const v = row.get(p);
                    return <td key={p.id} className="text-right">{v == null ? <span className="text-mute">—</span> : v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-mute">
        Prices in USD. Wallet top-ups, auto-recharge, and per-number plan changes
        live on <strong>Billing &amp; minutes</strong>.
      </p>

      {showAddPlan && (
        <AddNumberModal
          currentUser={currentUser}
          onClose={() => setShowAddPlan(false)}
          onAdded={() => { setShowAddPlan(false); setReloadKey((k) => k + 1); }}
        />
      )}

      {editingPlan && (
        <EditPlanModal
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSaved={() => { setEditingPlan(null); setReloadKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

// =============================================================================
// EditPlanModal — admin-only. Every field maps 1:1 to a column on base_plans
// (server/plans.js EDITABLE_PLAN_FIELDS) and to a real card/table field
// above; nothing here is decorative. PATCHes only the fields the admin
// touched isn't necessary — the backend accepts a full or partial patch, so
// this always sends the complete editable set for simplicity.
// =============================================================================
function EditPlanModal({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({
    label: plan.label || '',
    sub: plan.sub || '',
    tag: plan.tag || '',
    amount: plan.amount ?? '',
    yearlyAmount: plan.yearlyAmount ?? '',
    min: plan.min ?? '',
    rate: plan.rate ?? '',
    overage: plan.overage ?? '',
    dids: plan.dids ?? '',
    concurrent: plan.concurrent ?? '',
    agents: plan.agents ?? '',
    voiceStack: plan.voiceStack || '',
    support: plan.support || '',
    perks: (plan.perks || []).join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api(`/api/admin/base-plans/${plan.id}`, {
        method: 'PATCH',
        body: {
          label: form.label,
          sub: form.sub,
          tag: form.tag,
          amount: form.amount,
          // Blank clears the override so the server auto-derives yearly again.
          yearlyAmount: form.yearlyAmount === '' ? null : form.yearlyAmount,
          min: form.min,
          rate: form.rate,
          overage: form.overage,
          dids: form.dids,
          concurrent: form.concurrent,
          agents: form.agents,
          voiceStack: form.voiceStack,
          support: form.support,
          perks: form.perks.split('\n').map((s) => s.trim()).filter(Boolean),
        },
      });
      onSaved();
    } catch (ex) {
      setErr(ex.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900">Edit {plan.label}</div>
            <div className="text-xs text-mute mt-1">Changes apply immediately — display, checkout, and quotes.</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={save} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Label</label>
              <input className="input" value={form.label} onChange={set('label')} required />
            </div>
            <div>
              <label className="field-label">Badge tag</label>
              <input className="input" placeholder="e.g. MOST POPULAR" value={form.tag} onChange={set('tag')} />
            </div>
          </div>

          <div>
            <label className="field-label">Tagline</label>
            <input className="input" value={form.sub} onChange={set('sub')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Price / month (USD)</label>
              <input className="input" type="number" min="0" step="1" value={form.amount} onChange={set('amount')} required />
            </div>
            <div>
              <label className="field-label">Price / year (USD)</label>
              <input className="input" type="number" min="0" step="1" placeholder="auto (20% off)" value={form.yearlyAmount} onChange={set('yearlyAmount')} />
              <div className="field-help">Blank = auto-derived from monthly.</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">Included min</label>
              <input className="input" type="number" min="0" step="1" value={form.min} onChange={set('min')} required />
            </div>
            <div>
              <label className="field-label">Rate ($/min)</label>
              <input className="input" type="number" min="0" step="0.01" value={form.rate} onChange={set('rate')} required />
            </div>
            <div>
              <label className="field-label">Overage ($/min)</label>
              <input className="input" type="number" min="0" step="0.01" value={form.overage} onChange={set('overage')} required />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label">Numbers</label>
              <input className="input" type="number" min="0" step="1" value={form.dids} onChange={set('dids')} required />
            </div>
            <div>
              <label className="field-label">Concurrent calls</label>
              <input className="input" type="number" min="0" step="1" value={form.concurrent} onChange={set('concurrent')} required />
            </div>
            <div>
              <label className="field-label">Agents</label>
              <input className="input" type="number" min="0" step="1" value={form.agents} onChange={set('agents')} required />
              <div className="field-help">999 = unlimited.</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Voice stack</label>
              <input className="input" value={form.voiceStack} onChange={set('voiceStack')} />
            </div>
            <div>
              <label className="field-label">Support</label>
              <input className="input" value={form.support} onChange={set('support')} />
            </div>
          </div>

          <div>
            <label className="field-label">Perks (one per line)</label>
            <textarea className="input" rows={6} value={form.perks} onChange={set('perks')} />
          </div>

          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-ghost btn-ghost-accent" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
