import { useEffect, useMemo, useState } from 'react';
import { Star, ShieldCheck, Pencil, Check, RefreshCw } from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

// =============================================================================
// Reseller Plans — the three tiers a reseller can white-label. Pricing/edit
// logic is unchanged from before (still PATCH /api/reseller/plans/:id with
// the same platform-floor validation); this redesign adds the plan
// descriptions, "MOST POPULAR" tag, and feature bullets, all pulled from the
// real base-plan catalog (GET /api/plans?portal=<own slug>, the exact same
// merged data the reseller's own signup page renders) rather than invented.
// =============================================================================
export default function Plans() {
  const { currentUser } = useApp();
  const [list, setList]       = useState(null);
  const [floors, setFloors]   = useState({});      // basePlanId → { amount, rate }
  const [meta, setMeta]       = useState({});       // basePlanId → { tag, sub, perks }
  const [editingId, setEditingId] = useState(null); // basePlanId currently in edit mode
  const [draft, setDraft]     = useState(null);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [msg, setMsg]         = useState('');

  const loadAll = async () => {
    setErr('');
    try {
      const calls = [
        api('/api/reseller/plans'),
        api('/api/plans'), // canonical platform plans = the floors
      ];
      if (currentUser?.resellerPortal) {
        calls.push(api(`/api/plans?portal=${encodeURIComponent(currentUser.resellerPortal)}`));
      }
      const [mine, base, branded] = await Promise.all(calls);
      setList(mine.plans || []);

      const f = {};
      for (const bp of (base.plans || [])) f[bp.id] = { amount: bp.amount, rate: bp.rate };
      setFloors(f);

      const m = {};
      for (const bp of ((branded || base).plans || [])) {
        m[bp.id] = { tag: bp.tag || null, sub: bp.sub || '', perks: bp.perks || [] };
      }
      setMeta(m);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (p) => {
    setEditingId(p.basePlanId);
    setDraft({ label: p.label, amount: p.amount, rate: p.rate, min: p.min, agents: p.agents });
    setErr(''); setMsg('');
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); setErr(''); };

  const floorForCurrent = floors[editingId] || { amount: 0, rate: 0 };
  const violatesFloor = useMemo(() => {
    if (!draft) return null;
    if (Number(draft.amount) < floorForCurrent.amount) {
      return `Price must be at least ${money(floorForCurrent.amount)} (platform base).`;
    }
    if (Number(draft.rate) < floorForCurrent.rate) {
      return `Per-min rate must be at least $${floorForCurrent.rate} (platform base).`;
    }
    return null;
  }, [draft, floorForCurrent]);

  const save = async () => {
    if (!draft || !editingId) return;
    if (violatesFloor) { setErr(violatesFloor); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api(`/api/reseller/plans/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        body: { label: draft.label, amount: Number(draft.amount), rate: Number(draft.rate), min: Number(draft.min), agents: Number(draft.agents) },
      });
      setList((cur) => (cur || []).map((p) => p.basePlanId === r.plan.basePlanId ? r.plan : p));
      setMsg(`✓ ${r.plan.label} updated`);
      cancelEdit();
    } catch (e) {
      setErr(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  // A short, real bullet list per card — minutes, overage rate, agents, then
  // whichever support/voice perk the base catalog has for this tier (the
  // last entry in `perks`, which is always the support-tier line).
  const bulletsFor = (p) => {
    const perks = meta[p.basePlanId]?.perks || [];
    const supportPerk = perks.find((line) => /support|SLA/i.test(line));
    return [
      `${p.min.toLocaleString('en-US')} included minutes`,
      `$${p.rate} / min overage rate`,
      `${p.agents >= 999 ? 'Unlimited' : p.agents} agents`,
      ...(supportPerk ? [supportPerk] : []),
    ];
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="font-bold text-black text-[15px] max-w-lg">
          Customers signing up through your portal see these prices.<br />
          Edit any plan to raise its retail price or per-min rate — both must stay at or above the platform's base.
        </p>
        <button className="btn-ghost btn-ghost-accent text-sm flex items-center gap-1.5" onClick={loadAll}>
          <RefreshCw size={14} strokeWidth={2} /> Refresh
        </button>
      </div>

      {err && (
        <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">⚠ {err}</div>
      )}
      {msg && (
        <div className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>
      )}

      {/* Plan cards */}
      <div className="mt-5 grid md:grid-cols-3 gap-4 items-start">
        {list === null && <div className="text-mute md:col-span-3">Loading…</div>}
        {list?.length === 0 && <div className="text-mute md:col-span-3">No plans yet.</div>}
        {(list || []).map((p) => {
          const isEditing = editingId === p.basePlanId;
          const floor = floors[p.basePlanId] || { amount: 0, rate: 0 };
          const m = meta[p.basePlanId] || {};
          const popular = !!m.tag;

          if (isEditing && draft) {
            return (
              <div key={p.basePlanId} className="form-card flex flex-col border-2 border-lime-500 ring-2 ring-lime-100">
                <div className="text-xs uppercase tracking-wider font-semibold text-mute">{p.basePlanId}</div>
                <div className="mt-2">
                  <label className="field-label">Plan label</label>
                  <input className="input text-sm" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                </div>
                <div className="mt-3">
                  <label className="field-label">Retail price ($/mo)</label>
                  <input type="number" min={floor.amount} className="input text-sm" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                  <div className="text-[11px] text-mute mt-1">Floor: <strong>{money(floor.amount)}</strong> · what you owe us</div>
                </div>
                <div className="mt-3">
                  <label className="field-label">Per-minute rate ($)</label>
                  <input type="number" min={floor.rate} step="0.5" className="input text-sm" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
                  <div className="text-[11px] text-mute mt-1">Floor: <strong>${floor.rate}/min</strong> · what you owe us</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Included min</label>
                    <input type="number" min={0} className="input text-sm" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} />
                  </div>
                  <div>
                    <label className="field-label">Agents</label>
                    <input type="number" min={0} className="input text-sm" value={draft.agents} onChange={(e) => setDraft({ ...draft, agents: e.target.value })} />
                  </div>
                </div>

                {violatesFloor && <div className="mt-3 text-xs text-red-600">⚠ {violatesFloor}</div>}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button className="btn-ghost text-xs" onClick={cancelEdit} disabled={busy}>Cancel</button>
                  <button onClick={save} disabled={busy || !!violatesFloor} className="px-4 py-1.5 rounded-lg bg-lime-500 hover:bg-lime-600 disabled:bg-slate-300 text-white text-xs font-semibold">
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={p.basePlanId} className={`relative form-card flex flex-col ${popular ? 'border-2 border-lime-500 ring-1 ring-lime-100' : ''}`}>
              {popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 pill bg-lime-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 px-3 py-1 shadow">
                  <Star size={11} strokeWidth={2.5} fill="currentColor" /> {m.tag}
                </div>
              )}

              <span className="pill bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wider">{p.basePlanId}</span>

              <div className="mt-3 text-xl font-extrabold text-slate-900">{p.label}</div>
              {m.sub && <div className="text-sm text-mute mt-0.5">{m.sub}</div>}

              <div className="mt-4 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-slate-900">{money(p.amount)}</span>
                <span className="text-sm text-mute pb-1">/mo</span>
              </div>

              <ul className="mt-4 space-y-2 text-sm text-slate-700 flex-1">
                {bulletsFor(p).map((line) => (
                  <li key={line} className="flex items-center gap-2">
                    <Check size={15} strokeWidth={2.5} className="text-lime-600 shrink-0" /> {line}
                  </li>
                ))}
              </ul>

              <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1">
                <div className="flex items-center justify-between text-mute">
                  <span>Platform base</span>
                  <span>{money(floor.amount)}/mo · ${floor.rate}/min</span>
                </div>
                <div className="flex items-center justify-between font-semibold text-slate-700">
                  <span>Your margin</span>
                  <span>{money(p.amount - floor.amount)}/mo · ${(Number(p.rate) - Number(floor.rate)).toFixed(2)}/min</span>
                </div>
              </div>

              <button
                onClick={() => startEdit(p)}
                className={`mt-4 w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 ${
                  popular ? 'bg-lime-600 hover:bg-lime-700 text-white' : 'btn-ghost'
                }`}
              >
                Edit plan <Pencil size={13} strokeWidth={2.2} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      {list && list.length > 0 && (
        <div className="mt-5 form-card flex items-center gap-3 flex-wrap">
          <div className="shrink-0 w-9 h-9 rounded-full bg-lime-100 text-lime-700 flex items-center justify-center">
            <ShieldCheck size={16} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-sm font-semibold text-slate-900">Your prices are visible to customers during signup.</div>
            <div className="text-xs text-mute mt-0.5">Make sure your retail price and per-min rate are always at or above the platform base.</div>
          </div>
        </div>
      )}
    </div>
  );
}
