import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const inr = (n) => '$' + Number(n || 0).toLocaleString('en-US');

export default function Plans() {
  const { currentUser } = useApp();
  // Subscription plans (source of truth: server/plans.js → GET /api/plans).
  const [plans, setPlans] = useState(() => readCache('admin.plans.plans', currentUser?.id) ?? null);
  const [plansMeta, setPlansMeta] = useState({ perDidPriceInr: 400, yearlyDiscountPercent: 20 });
  // Wallet top-up packs (server/wallet.js → GET /api/wallet/packs).
  const [packs, setPacks] = useState(() => readCache('admin.plans.packs', currentUser?.id) ?? null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [p, w] = await Promise.all([
          api('/api/plans', { auth: false }),
          api('/api/wallet/packs', { auth: false }),
        ]);
        const nextPlans = p.plans || [];
        const nextPacks = w.packs || [];
        setPlans(nextPlans);
        setPlansMeta({
          perDidPriceInr: Number(p.perDidPriceInr) || 400,
          yearlyDiscountPercent: Number(p.yearlyDiscountPercent) || 20,
        });
        setPacks(nextPacks);
        writeCache('admin.plans.plans', currentUser?.id, nextPlans);
        writeCache('admin.plans.packs', currentUser?.id, nextPacks);
      } catch (e) {
        setErr(e.message);
        setPlans([]); setPacks([]);
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold">Plans &amp; pricing</h1>
      <p className="text-mute mt-1">
        Live snapshot of what customers see on the marketing site, signup flow,
        and Numbers tab.
      </p>

      {err && (
        <div className="mt-4 text-sm text-red-500 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>
      )}

      {/* === SUBSCRIPTION PLANS ============================================ */}
      <h2 className="mt-8 text-lg font-semibold">Subscription plans</h2>
      <p className="text-xs text-mute mt-1">
        Yearly auto-derived at <strong>{plansMeta.yearlyDiscountPercent}% off</strong>{' '}
        (unless an explicit <code>yearlyAmount</code> override is set per plan).
        Each phone number adds a one-time <strong>{inr(plansMeta.perDidPriceInr)}</strong>{' '}
        activation fee on top.
      </p>

      <div className="mt-4 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Monthly</th>
              <th>Yearly</th>
              <th>Save / yr</th>
              <th>Included min</th>
              <th>Rate</th>
              <th>Overage</th>
              <th>DIDs</th>
              <th>Concurrent</th>
              <th>Agents</th>
              <th>Voice stack</th>
              <th>Support</th>
            </tr>
          </thead>
          <tbody>
            {plans === null && <tr><td colSpan={12} className="text-center text-mute py-6">Loading plans…</td></tr>}
            {plans?.length === 0 && <tr><td colSpan={12} className="text-center text-mute py-6">No plans configured.</td></tr>}
            {(plans || []).map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="font-semibold text-slate-900 flex items-center gap-2">
                    {p.label}
                    {p.tag && <span className="pill pill-teal text-[10px]">{p.tag}</span>}
                  </div>
                  <div className="text-xs text-mute">{p.sub}</div>
                </td>
                <td className="font-mono text-slate-900">{inr(p.amount)}<span className="text-xs text-mute">/mo</span></td>
                <td className="font-mono text-slate-900">{inr(p.yearlyAmount)}<span className="text-xs text-mute">/yr</span></td>
                <td className="font-mono text-lime-600 text-sm">{inr(p.yearlySavingsInr)}</td>
                <td className="font-mono">{Number(p.min).toLocaleString('en-US')}</td>
                <td className="font-mono">{inr(p.rate)}/min</td>
                <td className="font-mono text-amber-700">{inr(p.overage)}/min</td>
                <td className="font-mono">{p.dids}</td>
                <td className="font-mono">{p.concurrent}</td>
                <td className="font-mono">{p.agents >= 999 ? 'Unlimited' : p.agents}</td>
                <td className="text-xs">{p.voiceStack}</td>
                <td className="text-xs">{p.support}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-mute mt-3">
        To edit, update <code>PLANS</code> in <code>server/plans.js</code>, then{' '}
        <code>npm run build &amp;&amp; systemctl restart voice-agent-portal</code>.
      </p>

      {/* === WALLET TOP-UP PACKS =========================================== */}
      <h2 className="mt-10 text-lg font-semibold">Wallet top-up packs</h2>
      <p className="text-xs text-mute mt-1">
        Shown on the customer Billing tab + auto-recharge dropdown.
      </p>

      <div className="mt-4 grid md:grid-cols-3 gap-4">
        {packs === null && (
          <div className="text-mute text-sm">Loading packs…</div>
        )}
        {packs?.length === 0 && (
          <div className="text-mute text-sm">No packs configured.</div>
        )}
        {(packs || []).map((p) => (
          <div key={p.id} className="form-card">
            <div className="text-xs text-lime-600 uppercase font-semibold">{p.id}</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{inr(p.amount)}</div>
            <div className="text-sm text-mute">{Number(p.mins).toLocaleString('en-US')} minutes</div>
            <div className="text-xs text-mute mt-1">{inr(p.rate)} / min</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-mute mt-6">
        To edit packs, update <code>PACKS</code> in <code>server/wallet.js</code> and restart the API.
      </p>
    </div>
  );
}
