import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const fmtRelative = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return d.toLocaleDateString();
};

const fmtUSD = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// Build the canonical list of DIDs for a signup row. We prefer the
// `user.numbers[]` array (one row per provisioned DID, each with its own
// plan tier), and fall back to the legacy single-number shape for any
// row that pre-dates the user_numbers backfill.
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

export default function Signups() {
  const { currentUser } = useApp();
  const [stats, setStats] = useState(() => readCache('admin.signups.stats', currentUser?.id) ?? null);
  const [users, setUsers] = useState(() => readCache('admin.signups.users', currentUser?.id) ?? null);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const [s, u] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/users'),
      ]);
      const nextUsers = u.users.filter((x) => x.role === 'customer');
      setStats(s);
      setUsers(nextUsers);
      writeCache('admin.signups.stats', currentUser?.id, s);
      writeCache('admin.signups.users', currentUser?.id, nextUsers);
    } catch (e) {
      setErr(e.message);
      setUsers([]);
    }
  };

  useEffect(() => { load(); }, []);

  const liveCount     = (users || []).filter((u) => didsFor(u).length > 0).length;
  const noNumberCount = (users || []).filter((u) => didsFor(u).length === 0).length;
  const totalDids     = useMemo(
    () => (users || []).reduce((a, u) => a + didsFor(u).length, 0),
    [users],
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-800 font-semibold text-base">Every customer who completed signup — with every DID + plan they bought.</p>
        </div>
        <button className="btn-ghost btn-ghost-accent text-sm" onClick={load}>↻ Refresh</button>
      </div>

      {err && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}

      <div className="mt-6 grid sm:grid-cols-4 gap-3">
        <div className="form-card"><div className="text-xs text-mute uppercase">Total customers</div><div className="mt-1 text-2xl font-semibold">{stats?.customers ?? '—'}</div></div>
        <div className="form-card"><div className="text-xs text-mute uppercase">Last 24 hr</div><div className="mt-1 text-2xl font-semibold">{stats?.signupsLast24h ?? '—'}</div></div>
        <div className="form-card"><div className="text-xs text-mute uppercase">Last 7 days</div><div className="mt-1 text-2xl font-semibold">{stats?.signupsLast7d ?? '—'}</div></div>
        <div className="form-card"><div className="text-xs text-mute uppercase">Live (with #)</div><div className="mt-1 text-2xl font-semibold text-lime-400">{liveCount}</div></div>
      </div>

      <div className="mt-6 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Number</th>
              <th>Plan</th>
              <th>Cycle</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {users === null && <tr><td colSpan={6} className="text-center text-mute py-6">Loading…</td></tr>}
            {users?.length === 0 && <tr><td colSpan={6} className="text-center text-mute py-6">No signups yet.</td></tr>}
            {(users || []).flatMap((u) => {
              const dids = didsFor(u);
              if (dids.length === 0) {
                return [(
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium">{u.company || u.name}</div>
                      <div className="text-xs text-mute">{u.email}</div>
                    </td>
                    <td colSpan={3} className="text-mute text-sm italic">— No DID provisioned —</td>
                    <td>
                      <span className="pill bg-amber-500/15 text-amber-700 text-[10px] uppercase tracking-wider font-semibold">
                        No number
                      </span>
                    </td>
                    <td className="text-xs text-mute">{fmtRelative(u.createdAt)}</td>
                  </tr>
                )];
              }
              return dids.map((d, i) => (
                <tr key={`${u.id}-${d.id}`}>
                  {i === 0 ? (
                    <td rowSpan={dids.length} className="align-top">
                      <div className="font-medium">{u.company || u.name}</div>
                      <div className="text-xs text-mute">{u.email}</div>
                      {dids.length > 1 && (
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-lime-600 font-semibold">
                          {dids.length} plans
                        </div>
                      )}
                    </td>
                  ) : null}
                  <td className="font-mono text-sm">
                    <span>{d.value}</span>
                    {d.isPrimary && dids.length > 1 && (
                      <span className="ml-2 pill bg-lime-500/15 text-lime-700 text-[10px] uppercase tracking-wider font-semibold">
                        primary
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="text-sm font-semibold text-slate-900">{d.plan?.label || '—'}</div>
                    <div className="text-xs text-mute">
                      {fmtUSD(d.plan?.amount)} · {d.plan?.min || 0} min
                    </div>
                  </td>
                  <td>
                    <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${
                      d.planCycle === 'yearly'
                        ? 'bg-emerald-500/15 text-emerald-700'
                        : 'bg-slate-500/15 text-slate-700'
                    }`}>
                      {d.planCycle === 'yearly' ? 'Yearly' : 'Monthly'}
                    </span>
                  </td>
                  {i === 0 ? (
                    <td rowSpan={dids.length} className="align-top">
                      <span className="pill bg-lime-500/15 text-lime-700 text-[10px] uppercase tracking-wider font-semibold">
                        Live
                      </span>
                    </td>
                  ) : null}
                  {i === 0 ? (
                    <td rowSpan={dids.length} className="align-top text-xs text-mute">
                      {fmtRelative(u.createdAt)}
                    </td>
                  ) : null}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
