import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const fmtCurrency = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// Same fallback logic as Signups: prefer `user.numbers[]` (per-DID plan
// tiers) and fall back to the legacy primary fields for old rows.
const didsFor = (u) => {
  if (Array.isArray(u.numbers) && u.numbers.length) return u.numbers;
  if (u.number) {
    return [{
      id: `legacy-${u.id}`,
      value: u.number,
      isPrimary: true,
      planCycle: 'monthly',
      plan: u.plan
        ? { ...u.plan, id: u.plan.label?.toLowerCase() || 'unknown' }
        : null,
    }];
  }
  return [];
};

// Per-month recurring for a single DID. Yearly plans get divided by 12
// so the per-customer "/mo" total is apples-to-apples.
const monthlyFor = (did) => {
  const a = Number(did?.plan?.amount) || 0;
  return did?.planCycle === 'yearly' ? a / 12 : a;
};

export default function Payments() {
  const { currentUser } = useApp();
  const [users, setUsers] = useState(() => readCache('admin.payments.users', currentUser?.id) ?? null);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const u = await api('/api/admin/users');
      const nextUsers = u.users.filter((x) => x.role === 'customer');
      setUsers(nextUsers);
      writeCache('admin.payments.users', currentUser?.id, nextUsers);
    } catch (e) {
      setErr(e.message);
      setUsers([]);
    }
  };

  useEffect(() => { load(); }, []);

  const didRows = useMemo(() => {
    if (!users) return null;
    return users.flatMap((u) =>
      didsFor(u)
        .filter((d) => d.plan)
        .map((d) => ({
          id: `${u.id}-${d.id}`,
          customerName: u.company || u.name,
          email: u.email,
          did: d.value,
          isPrimary: !!d.isPrimary,
          planLabel: d.plan?.label || '—',
          billedAmount: Number(d.plan?.amount) || 0,
          cycle: d.planCycle === 'yearly' ? 'yearly' : 'monthly',
          mrr: monthlyFor(d),
        })),
    );
  }, [users]);

  const summary = useMemo(() => {
    if (!didRows) return null;
    const totalMrr = didRows.reduce((sum, row) => sum + row.mrr, 0);
    const yearlyCount = didRows.filter((row) => row.cycle === 'yearly').length;
    const customerCount = new Set(didRows.map((row) => row.email)).size;
    return {
      totalMrr,
      didCount: didRows.length,
      customerCount,
      yearlyCount,
    };
  }, [didRows]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold tracking-wide animate-fade-up" style={{ color: 'var(--ink-2)' }}>Recurring revenue across every plan a customer is on — one row per DID.</p>
        <button className="btn-ghost btn-ghost-accent text-sm transition duration-200 ease-out hover:scale-105 active:scale-95" onClick={load}>↻ Refresh</button>
      </div>

      {err && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}

      <div className="mt-6 grid sm:grid-cols-4 gap-3">
        <div className="form-card"><div className="text-xs text-mute uppercase">Total MRR</div><div className="mt-1 text-2xl font-semibold text-lime-400">{summary ? fmtCurrency(summary.totalMrr) : '—'}</div></div>
        <div className="form-card"><div className="text-xs text-mute uppercase">Paid DIDs</div><div className="mt-1 text-2xl font-semibold">{summary?.didCount ?? '—'}</div></div>
        <div className="form-card"><div className="text-xs text-mute uppercase">Paying customers</div><div className="mt-1 text-2xl font-semibold">{summary?.customerCount ?? '—'}</div></div>
        <div className="form-card"><div className="text-xs text-mute uppercase">Yearly plans</div><div className="mt-1 text-2xl font-semibold">{summary?.yearlyCount ?? '—'}</div></div>
      </div>

      <div className="mt-6 form-card p-0 overflow-x-auto">
        <table className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th>Customer</th>
              <th>DID</th>
              <th>Plan</th>
              <th>Cycle</th>
              <th className="text-right">Billed</th>
              <th className="text-right">MRR</th>
            </tr>
          </thead>
          <tbody>
            {didRows === null && <tr><td colSpan={6} className="text-center text-mute py-6">Loading…</td></tr>}
            {didRows?.length === 0 && <tr><td colSpan={6} className="text-center text-mute py-6">No recurring plans yet.</td></tr>}
            {(didRows || []).map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="font-medium">{row.customerName}</div>
                  <div className="text-xs text-mute">{row.email}</div>
                </td>
                <td className="font-mono text-sm">
                  {row.did}
                  {row.isPrimary && (
                    <span className="ml-2 pill bg-lime-500/15 text-lime-700 text-[10px] uppercase tracking-wider font-semibold">primary</span>
                  )}
                </td>
                <td className="text-sm font-semibold text-slate-900">{row.planLabel}</td>
                <td>
                  <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${
                    row.cycle === 'yearly'
                      ? 'bg-emerald-500/15 text-emerald-700'
                      : 'bg-slate-500/15 text-slate-700'
                  }`}>
                    {row.cycle === 'yearly' ? 'Yearly' : 'Monthly'}
                  </span>
                </td>
                <td className="text-right">{fmtCurrency(row.billedAmount)}</td>
                <td className="text-right text-lime-400 font-semibold">{fmtCurrency(row.mrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
