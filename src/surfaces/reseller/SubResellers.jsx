import { useEffect, useMemo, useState } from 'react';
import {
  Users, UsersRound, CalendarDays, Search, Plus,
  Mail, Link2, MoreVertical, ArrowUpDown,
} from 'lucide-react';
import { api } from '../../api.js';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const ymd = (d) => {
  const x = new Date(d);
  return isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 10);
};

const BRAND_GRADIENT = 'bg-[linear-gradient(135deg,#0ea5e9_0%,#6366f1_55%,#8b5cf6_110%)]';

const emptyForm = () => ({
  name: '', company: '', email: '', phone: '',
  username: '', password: '',
  resellerPortal: '',
  kycAddress: '', kycLocation: '',
});

const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name',   label: 'Name (A–Z)' },
  { id: 'customers', label: 'Most customers' },
];

// =============================================================================
// SubResellers — reseller-only page to on-board sub-resellers. Redesigned
// with a stat strip, search/sort, and an icon-per-row table, but every
// number is computed from GET /api/reseller/sub-resellers — there's no
// per-sub-reseller revenue or account-status field in the schema, so those
// mockup elements were left out rather than faked.
// =============================================================================
export default function SubResellers() {
  const [list, setList]       = useState(null);
  const [err, setErr]         = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState(emptyForm);
  const [busy, setBusy]       = useState(false);
  const [formErr, setFormErr] = useState('');
  const [createdMsg, setCreatedMsg] = useState('');
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('newest');
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  const load = async () => {
    setErr('');
    try {
      const r = await api('/api/reseller/sub-resellers');
      setList(r.subResellers || []);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setFormErr(''); setBusy(true);
    try {
      const r = await api('/api/reseller/sub-resellers', { method: 'POST', body: form });
      setCreatedMsg(`✓ Created ${r.subReseller.email} (portal: ${r.subReseller.resellerPortal})`);
      setForm(emptyForm());
      setShowForm(false);
      await load();
    } catch (e) {
      setFormErr(e.message || 'Could not create sub-reseller');
    } finally {
      setBusy(false);
    }
  };

  // ---- Real stats, derived from the loaded list only ----
  const totalCustomers = useMemo(() => (list || []).reduce((a, r) => a + (r.customerCount || 0), 0), [list]);
  const avgCustomers = list && list.length ? (totalCustomers / list.length) : 0;
  const now = new Date();
  const thisMonthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const newThisMonth = useMemo(
    () => (list || []).filter((r) => ymd(r.createdAt) >= thisMonthStart).length,
    [list, thisMonthStart],
  );

  const filtered = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toLowerCase();
    let rows = list.filter((r) => {
      if (!q) return true;
      return (
        (r.company || '').toLowerCase().includes(q) ||
        (r.name    || '').toLowerCase().includes(q) ||
        (r.email   || '').toLowerCase().includes(q) ||
        (r.resellerPortal || '').toLowerCase().includes(q)
      );
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'oldest')    return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === 'name')      return (a.company || a.name || '').localeCompare(b.company || b.name || '');
      if (sortBy === 'customers') return (b.customerCount || 0) - (a.customerCount || 0);
      return new Date(b.createdAt) - new Date(a.createdAt); // newest
    });
    return rows;
  }, [list, search, sortBy]);

  return (
    <div onClick={() => setMenuOpenFor(null)}>
      <p className="font-bold text-black text-[15px] max-w-xl">
        On-board partners under your brand. Each sub-reseller gets their own
        portal slug and customer list — all rolled up to your downstream.
      </p>

      {err && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {err}
        </div>
      )}
      {createdMsg && (
        <div className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          {createdMsg}
        </div>
      )}

      {/* Stat strip */}
      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="form-card flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-lime-100 text-lime-700 flex items-center justify-center"><UsersRound size={16} strokeWidth={2} /></div>
          <div>
            <div className="text-xs text-mute uppercase tracking-wider font-semibold">Total sub-resellers</div>
            <div className="mt-0.5 text-2xl font-bold text-slate-900">{list === null ? '—' : list.length}</div>
            <div className="text-xs text-mute mt-0.5">{list?.length ? 'partners on-boarded' : 'No partners yet'}</div>
          </div>
        </div>
        <div className="form-card flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center"><Users size={16} strokeWidth={2} /></div>
          <div>
            <div className="text-xs text-mute uppercase tracking-wider font-semibold">Total customers</div>
            <div className="mt-0.5 text-2xl font-bold text-slate-900">{list === null ? '—' : totalCustomers}</div>
            <div className="text-xs text-mute mt-0.5">Across all partners</div>
          </div>
        </div>
        <div className="form-card flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center"><ArrowUpDown size={16} strokeWidth={2} /></div>
          <div>
            <div className="text-xs text-mute uppercase tracking-wider font-semibold">Avg. customers / partner</div>
            <div className="mt-0.5 text-2xl font-bold text-slate-900">{list === null ? '—' : avgCustomers.toFixed(1)}</div>
            <div className="text-xs text-mute mt-0.5">Per sub-reseller</div>
          </div>
        </div>
        <div className="form-card flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><CalendarDays size={16} strokeWidth={2} /></div>
          <div>
            <div className="text-xs text-mute uppercase tracking-wider font-semibold">This month</div>
            <div className="mt-0.5 text-2xl font-bold text-slate-900">{list === null ? '—' : newThisMonth}</div>
            <div className="text-xs text-mute mt-0.5">{newThisMonth === 1 ? 'new partner' : 'new partners'} this month</div>
          </div>
        </div>
      </div>

      {/* === Registration form ============================================== */}
      {showForm && (
        <form onSubmit={submit} className="mt-6 form-card space-y-4">
          <div className="text-sm font-semibold text-slate-900">
            Register a new sub-reseller
          </div>
          <div className="text-xs text-mute">
            All fields are required. The sub-reseller will be created under your
            account — every customer they on-board rolls up to your downstream.
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Company name *</label>
              <input className="input text-sm" required value={form.company} onChange={setField('company')} placeholder="Acme Voice Partners" />
            </div>
            <div>
              <label className="field-label">Authorised contact name *</label>
              <input className="input text-sm" required value={form.name} onChange={setField('name')} placeholder="Jane Acme" />
            </div>
            <div>
              <label className="field-label">Registered phone *</label>
              <input className="input text-sm" required value={form.phone} onChange={setField('phone')} placeholder="+91 98765 43210" />
            </div>
            <div>
              <label className="field-label">Work email (login) *</label>
              <input type="email" className="input text-sm" required value={form.email} onChange={setField('email')} placeholder="ops@acme.com" />
            </div>
            <div>
              <label className="field-label">Username *</label>
              <input className="input text-sm" required value={form.username} onChange={setField('username')} placeholder="acme" />
            </div>
            <div>
              <label className="field-label">Password * (8+ chars)</label>
              <input type="text" className="input text-sm font-mono" required value={form.password} onChange={setField('password')} placeholder="Auto-generate or paste" />
              <button
                type="button"
                className="mt-1 text-xs text-lime-600 hover:underline"
                onClick={() => {
                  const arr = new Uint8Array(12);
                  window.crypto.getRandomValues(arr);
                  const pwd = btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, '').slice(0, 16);
                  setForm((f) => ({ ...f, password: pwd }));
                }}
              >
                ⟳ Generate strong password
              </button>
            </div>
            <div className="sm:col-span-2">
              <label className="field-label">Portal slug *</label>
              <input
                className="input text-sm font-mono lowercase"
                required
                value={form.resellerPortal}
                onChange={(e) => setForm((f) => ({ ...f, resellerPortal: e.target.value.toLowerCase() }))}
                placeholder="acme-voice.io"
              />
              <div className="field-help">
                Sub-reseller's branded signup slug. Customers signing up there are
                auto-attributed to this sub-reseller and roll up to you. Must be
                unique platform-wide.
              </div>
            </div>
            <div>
              <label className="field-label">KYC address</label>
              <input className="input text-sm" value={form.kycAddress} onChange={setField('kycAddress')} placeholder="Registered office address" />
            </div>
            <div>
              <label className="field-label">KYC location / city</label>
              <input className="input text-sm" value={form.kycLocation} onChange={setField('kycLocation')} placeholder="Mumbai, IN" />
            </div>
          </div>

          {formErr && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              ⚠ {formErr}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={() => setShowForm(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className={`px-5 py-2 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT}`}
            >
              {busy ? 'Registering…' : 'Register sub-reseller'}
            </button>
          </div>
        </form>
      )}

      {/* Search + sort */}
      {list !== null && list.length > 0 && (
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={15} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
            <input
              type="search"
              className="input pl-9 text-sm"
              placeholder="Search by name, email or portal slug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="input text-sm py-1.5 ml-auto sm:max-w-[190px]" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      )}

      {/* === Sub-reseller list ============================================== */}
      <div className="mt-4 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Sub-reseller</th>
              <th>Portal slug</th>
              <th>Phone</th>
              <th>Customers</th>
              <th>KYC location</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list === null && <tr><td colSpan={7} className="text-center text-mute py-6">Loading…</td></tr>}
            {list?.length === 0 && (
              <tr><td colSpan={7} className="text-center py-14">
                <div className="text-base font-semibold text-slate-900">No sub-resellers yet</div>
                <p className="text-sm text-mute mt-1 max-w-sm mx-auto">
                  Invite your first partner and start growing your network.
                </p>
                <button
                  onClick={() => setShowForm(true)}
                  className={`mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-semibold ${BRAND_GRADIENT}`}
                >
                  <Plus size={15} strokeWidth={2.2} /> Add sub-reseller
                </button>
              </td></tr>
            )}
            {list && list.length > 0 && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center text-mute py-10">No sub-resellers match your search.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="font-medium">{r.company || r.name}</div>
                  <div className="text-xs text-mute">{r.email} · @{r.username}</div>
                </td>
                <td className="font-mono text-sm text-lime-600">{r.resellerPortal || '—'}</td>
                <td className="text-xs text-mute">{r.phone || '—'}</td>
                <td>
                  <span className={r.customerCount > 0
                    ? 'pill bg-lime-500/10 text-lime-700'
                    : 'pill bg-slate-200 text-slate-600'}>
                    {r.customerCount} {r.customerCount === 1 ? 'customer' : 'customers'}
                  </span>
                </td>
                <td className="text-xs text-mute">{r.kycLocation || '—'}</td>
                <td className="text-xs text-mute">{fmtDate(r.createdAt)}</td>
                <td className="text-right">
                  <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full flex items-center justify-center text-mute hover:bg-slate-100"
                      onClick={() => setMenuOpenFor((cur) => (cur === r.id ? null : r.id))}
                      aria-label="More actions"
                    >
                      <MoreVertical size={16} strokeWidth={2} />
                    </button>
                    {menuOpenFor === r.id && (
                      <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1 text-sm">
                        <a href={`mailto:${r.email}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-slate-700">
                          <Mail size={14} strokeWidth={2} /> Email sub-reseller
                        </a>
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-slate-700 text-left"
                          onClick={async () => { try { await navigator.clipboard.writeText(r.resellerPortal); } catch {} setMenuOpenFor(null); }}
                        >
                          <Link2 size={14} strokeWidth={2} /> Copy portal slug
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
