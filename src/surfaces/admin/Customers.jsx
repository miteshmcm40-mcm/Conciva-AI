import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

export default function Customers() {
  const { currentUser } = useApp();
  const [users, setUsers] = useState(() => readCache('admin.customers', currentUser?.id) ?? null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setErr('');
    try {
      const data = await api('/api/admin/users');
      const next = data.users.filter((u) => u.role === 'customer' && (u.plan || u.number)); // Only active plan/number users
      setUsers(next);
      writeCache('admin.customers', currentUser?.id, next);
    } catch (e) {
      setErr(e.message);
      setUsers([]);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.company || u.email}? This also releases any Twilio number.`)) return;
    setBusyId(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const provision = async (u) => {
    setBusyId(u.id + ':prov');
    try {
      const r = await api(`/api/admin/provision/${u.id}`, { method: 'POST' });
      alert('Provisioning OK:\n' + (r.log || []).join('\n'));
      await load();
    } catch (e) {
      alert('Provisioning failed:\n' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-800 font-semibold text-base">All live customers.</p>
        </div>
        <button className="btn-ghost btn-ghost-accent text-sm" onClick={load}>↻ Refresh</button>
      </div>

      {err && <div className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{err}</div>}

      <div className="mt-6 form-card p-0 overflow-x-auto">
        <table className="w-full whitespace-nowrap">
          <thead>
            <tr><th>Customer</th><th>Type</th><th>Portal</th><th>Phone</th><th>Plan</th><th>Min used</th><th>Status</th><th>Joined</th><th></th></tr>
          </thead>
          <tbody>
            {users === null && <tr><td colSpan={9} className="text-center text-mute py-6">Loading…</td></tr>}
            {users?.length === 0 && <tr><td colSpan={9} className="text-center text-mute py-6">No customers yet.</td></tr>}
            {(users || []).map((c) => {
              const typeClass = c.userType === 'superadmin' ? 'bg-purple-500/15 text-purple-700'
                              : c.userType === 'reseller'   ? 'bg-amber-500/15 text-amber-700'
                              : c.userType === 'admin'      ? 'bg-lime-500/15 text-lime-700'
                              :                                'bg-slate-200 text-slate-700';
              return (
              <tr key={c.id}>
                <td>
                  <div className="font-medium">{c.company || c.name}</div>
                  <div className="text-xs text-mute">{c.email}</div>
                </td>
                <td>
                  <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${typeClass}`}>
                    {c.userType || 'user'}
                  </span>
                </td>
                <td className="font-mono text-xs">
                  {c.viaPortal
                    ? <span className="text-lime-600">{c.viaPortal}</span>
                    : <span className="text-mute">—</span>
                  }
                </td>
                <td className="font-mono text-sm">{c.number || '—'}</td>
                <td>{c.plan ? `$${Number(c.plan.amount).toLocaleString("en-US")} / ${c.plan.min} min` : '—'}</td>
                <td>{c.minutesUsed.toFixed(1)} / {c.plan?.min || 0}</td>
                <td>
                  <span className={c.number
                    ? 'pill bg-lime-500/20 text-lime-400'
                    : 'pill bg-amber-500/20 text-amber-400'}>
                    {c.number ? 'Live' : 'No number'}
                  </span>
                </td>
                <td className="text-xs text-mute">{fmtDate(c.createdAt)}</td>
                <td>
                  <div className="flex gap-2">
                    {c.number && (
                      <button
                        className="btn-ghost text-xs"
                        disabled={busyId === c.id + ':prov'}
                        onClick={() => provision(c)}
                        title="Recreate inbound trunk + dispatch rule + voice agent"
                      >
                        {busyId === c.id + ':prov' ? '…' : 'Provision'}
                      </button>
                    )}
                    <button
                      className="btn-red text-xs"
                      disabled={busyId === c.id}
                      onClick={() => remove(c)}
                    >
                      {busyId === c.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
