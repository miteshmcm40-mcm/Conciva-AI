import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const emptyForm = () => ({
  name: '', company: '', email: '', phone: '',
  username: '', password: '',
  resellerPortal: '',
  kycAddress: '', kycLocation: '',
});

// =============================================================================
// Resellers — superadmin-only page to register whitelabel resellers (with
// KYC) and see the existing reseller list. Each newly registered reseller
// is auto-seeded with the platform's default Starter / Growth / Scale plans.
// =============================================================================
export default function Resellers() {
  const { currentUser } = useApp();
  const [list, setList]       = useState(() => readCache('admin.resellers', currentUser?.id) ?? null);
  const [err, setErr]         = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState(emptyForm);
  const [busy, setBusy]       = useState(false);
  const [formErr, setFormErr] = useState('');
  const [createdMsg, setCreatedMsg] = useState('');
  // When set to a reseller object, opens the customer-detail drawer.
  const [drilledReseller, setDrilledReseller] = useState(null);

  const load = async () => {
    setErr('');
    try {
      const r = await api('/api/admin/resellers');
      const next = r.resellers || [];
      setList(next);
      writeCache('admin.resellers', currentUser?.id, next);
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
      const r = await api('/api/admin/resellers', { method: 'POST', body: form });
      setCreatedMsg(`✓ Created ${r.reseller.email} (portal: ${r.reseller.resellerPortal})`);
      setForm(emptyForm());
      setShowForm(false);
      await load();
    } catch (e) {
      setFormErr(e.message || 'Could not create reseller');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-mute text-sm">
          Whitelabel partners with their own customer portal. Each reseller
          starts with the platform's default plans and can edit them upward.
        </p>
        <button
          onClick={() => { setShowForm((v) => !v); setFormErr(''); }}
          className="btn-ghost btn-ghost-accent text-sm whitespace-nowrap"
        >
          {showForm ? '× Cancel' : '+ Register new reseller'}
        </button>
      </div>

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

      {/* === Registration form ============================================== */}
      {showForm && (
        <form onSubmit={submit} className="mt-6 form-card space-y-4">
          <div className="text-sm font-semibold text-slate-900">
            Register a new reseller
          </div>
          <div className="text-xs text-mute">
            All fields are required. KYC details are stored on the reseller's user row;
            the password is bcrypt-hashed before being saved. The reseller will be
            auto-seeded with default Starter / Growth / Scale plans.
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Company name *</label>
              <input className="input text-sm" required value={form.company} onChange={setField('company')} placeholder="Acme Voice Solutions" />
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
                  // Quick generator — same 16-char alphanumeric shape as the
                  // node script used to seed earlier accounts.
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
              <label className="field-label">Reseller portal slug *</label>
              <input
                className="input text-sm font-mono lowercase"
                required
                value={form.resellerPortal}
                onChange={(e) => setForm((f) => ({ ...f, resellerPortal: e.target.value.toLowerCase() }))}
                placeholder="acme.io"
              />
              <div className="field-help">
                The portal slug their branded signup form posts. Customers signing
                up there are auto-attributed to this reseller. Must be unique
                across all resellers.
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
              className="btn-teal text-sm whitespace-nowrap"
            >
              {busy ? 'Registering…' : 'Register reseller'}
            </button>
          </div>
        </form>
      )}

      {/* === Reseller list ================================================== */}
      <div className="mt-6 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Reseller</th>
              <th>Type</th>
              <th>Parent</th>
              <th>Portal slug</th>
              <th>Phone</th>
              <th>Customers</th>
              <th>KYC location</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {list === null && <tr><td colSpan={8} className="text-center text-mute py-6">Loading…</td></tr>}
            {list?.length === 0 && (
              <tr><td colSpan={8} className="text-center text-mute py-6">
                No resellers yet — click <strong>+ Register new reseller</strong> above to add one.
              </td></tr>
            )}
            {(list || []).map((r) => {
              const isSub = r.userType === 'sub-reseller';
              return (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium">{r.company || r.name}</div>
                    <div className="text-xs text-mute">{r.email} · @{r.username}</div>
                  </td>
                  <td>
                    <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${
                      isSub
                        ? 'bg-purple-500/15 text-purple-700'
                        : 'bg-amber-500/15 text-amber-700'
                    }`}>
                      {isSub ? 'sub-reseller' : 'reseller'}
                    </span>
                  </td>
                  <td>
                    {r.parent ? (
                      <>
                        <div className="text-sm font-medium">{r.parent.company || r.parent.name}</div>
                        <div className="text-xs text-mute font-mono text-lime-600">
                          {r.parent.resellerPortal || r.parent.email}
                        </div>
                      </>
                    ) : (
                      <span className="text-mute text-xs italic">— top level —</span>
                    )}
                  </td>
                  <td className="font-mono text-sm text-lime-600">{r.resellerPortal || '—'}</td>
                  <td className="text-xs text-mute">{r.phone || '—'}</td>
                  <td>
                    {r.customerCount > 0 ? (
                      <button
                        onClick={() => setDrilledReseller(r)}
                        className="pill bg-lime-500/10 text-lime-700 hover:bg-lime-500/20 hover:text-lime-800 transition cursor-pointer"
                        title="Click to see all customers under this reseller"
                      >
                        {r.customerCount} {r.customerCount === 1 ? 'customer' : 'customers'} →
                      </button>
                    ) : (
                      <span className="pill bg-slate-200 text-slate-600">
                        0 customers
                      </span>
                    )}
                  </td>
                  <td className="text-xs text-mute">
                    {r.kycLocation || '—'}
                  </td>
                  <td className="text-xs text-mute">{fmtDate(r.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {drilledReseller && (
        <ResellerCustomersModal
          reseller={drilledReseller}
          onClose={() => setDrilledReseller(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// ResellerCustomersModal — drilled-down view triggered by clicking a customer
// count pill on the Resellers list. Shows every customer under that reseller
// with their plan / DID / minute usage / dates.
// =============================================================================
function ResellerCustomersModal({ reseller, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/api/admin/resellers/${reseller.id}/customers`);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Could not load customers');
      }
    })();
    return () => { cancelled = true; };
  }, [reseller.id]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl mt-12 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">Reseller customers</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{reseller.company || reseller.name}</div>
            <div className="text-xs text-mute flex items-center gap-2 flex-wrap">
              <span>Portal: <span className="font-mono text-lime-600">{reseller.resellerPortal}</span></span>
              <span>· {reseller.email}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-2xl text-mute hover:text-slate-900" aria-label="Close">×</button>
        </div>

        {err && (
          <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            ⚠ {err}
          </div>
        )}

        <div className="p-5">
          {data === null && !err && (
            <div className="text-mute text-center py-10">Loading customers…</div>
          )}
          {data && data.customers.length === 0 && (
            <div className="text-mute text-center py-10">
              No customers under this reseller yet — they'll appear here as soon as someone signs up via{' '}
              <span className="font-mono text-lime-600">{reseller.resellerPortal}</span>.
            </div>
          )}
          {data && data.customers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-mute text-xs uppercase tracking-wider border-b border-slate-200">
                    <th className="text-left font-semibold py-2 pl-1">Customer</th>
                    <th className="text-left font-semibold py-2">Phone (DID)</th>
                    <th className="text-left font-semibold py-2">Plan</th>
                    <th className="text-left font-semibold py-2">Cycle</th>
                    <th className="text-right font-semibold py-2">Min used</th>
                    <th className="text-left font-semibold py-2">Activated</th>
                    <th className="text-left font-semibold py-2 pr-1">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.flatMap((c) => {
                    // Prefer the per-DID list; fall back to legacy primary
                    // for any row that pre-dates the user_numbers backfill.
                    const dids = (Array.isArray(c.numbers) && c.numbers.length)
                      ? c.numbers
                      : c.number ? [{
                          id: `legacy-${c.id}`,
                          value: c.number,
                          isPrimary: true,
                          planCycle: 'monthly',
                          plan: c.plan ? { ...c.plan, id: (c.plan.label || 'unknown').toLowerCase() } : null,
                        }] : [];

                    if (dids.length === 0) {
                      return [(
                        <tr key={c.id} className="border-b border-slate-100">
                          <td className="py-3 pl-1">
                            <div className="font-semibold text-slate-900">{c.company || c.name}</div>
                            <div className="text-xs text-mute">{c.email} · {c.phone || '—'}</div>
                          </td>
                          <td className="py-3 text-mute italic text-xs" colSpan={3}>— No DID provisioned —</td>
                          <td className="py-3 text-right text-mute">—</td>
                          <td className="py-3 text-xs text-mute">—</td>
                          <td className="py-3 pr-1 text-xs text-mute">{fmtDate(c.createdAt)}</td>
                        </tr>
                      )];
                    }

                    return dids.map((d, i) => (
                      <tr key={`${c.id}-${d.id}`} className={i === dids.length - 1 ? 'border-b border-slate-100' : ''}>
                        {i === 0 ? (
                          <td rowSpan={dids.length} className="py-3 pl-1 align-top">
                            <div className="font-semibold text-slate-900">{c.company || c.name}</div>
                            <div className="text-xs text-mute">{c.email} · {c.phone || '—'}</div>
                            {dids.length > 1 && (
                              <div className="mt-1 text-[10px] uppercase tracking-wider text-lime-600 font-semibold">
                                {dids.length} plans
                              </div>
                            )}
                          </td>
                        ) : null}
                        <td className="py-3 font-mono text-xs">
                          {d.value}
                          {d.isPrimary && dids.length > 1 && (
                            <span className="ml-2 pill bg-lime-500/15 text-lime-700 text-[9px] uppercase tracking-wider font-semibold">primary</span>
                          )}
                        </td>
                        <td className="py-3">
                          {d.plan ? (
                            <>
                              <div className="text-sm font-semibold">{d.plan.label}</div>
                              <div className="text-[11px] text-mute">
                                ${Number(d.plan.amount).toLocaleString('en-US')} · {d.plan.min} min · ${d.plan.rate}/min
                              </div>
                            </>
                          ) : <span className="text-mute">—</span>}
                        </td>
                        <td className="py-3">
                          <span className={`pill text-[10px] uppercase tracking-wider font-semibold ${
                            d.planCycle === 'yearly'
                              ? 'bg-emerald-500/15 text-emerald-700'
                              : 'bg-slate-500/15 text-slate-700'
                          }`}>
                            {d.planCycle === 'yearly' ? 'Yearly' : 'Monthly'}
                          </span>
                        </td>
                        {i === 0 ? (
                          <td rowSpan={dids.length} className="py-3 text-right align-top">
                            <strong>{c.minutesUsed.toFixed(1)}</strong>
                            <span className="text-mute"> / {dids[0].plan?.min || 0}</span>
                          </td>
                        ) : null}
                        {i === 0 ? (
                          <td rowSpan={dids.length} className="py-3 text-xs text-mute align-top">
                            {fmtDate(c.planActivated)}
                          </td>
                        ) : null}
                        {i === 0 ? (
                          <td rowSpan={dids.length} className="py-3 pr-1 text-xs text-mute align-top">
                            {fmtDate(c.createdAt)}
                          </td>
                        ) : null}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-mute text-right">
                {data.customers.length} {data.customers.length === 1 ? 'customer' : 'customers'} ·{' '}
                {data.customers.reduce((a, c) => a + (Array.isArray(c.numbers) ? c.numbers.length : (c.number ? 1 : 0)), 0)} plans
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="btn-ghost text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
