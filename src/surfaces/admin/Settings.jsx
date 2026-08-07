import { useEffect, useState } from 'react';
import { RefreshCw, Pencil, ShieldAlert, ShieldCheck, CircleDot } from 'lucide-react';
import { api } from '../../api.js';
import { useApp } from '../../AppContext.jsx';
import { readCache, writeCache } from '../../utils/swrCache.js';

const SOURCE_META = {
  db:    { label: 'Override', cls: 'bg-lime-100 text-lime-700' },
  env:   { label: 'From .env', cls: 'bg-blue-100 text-blue-700' },
  unset: { label: 'Unset', cls: 'bg-amber-100 text-amber-700' },
};

function StatusPill({ source }) {
  const m = SOURCE_META[source] || SOURCE_META.unset;
  return (
    <span className={`pill text-[10px] font-semibold ${m.cls}`}>
      <CircleDot size={9} /> {m.label}
    </span>
  );
}

function FieldRow({ field, draft, setDraft, editing }) {
  const value = draft[field.key];
  return (
    <div className="setting-row">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-[12px]">{field.key}</code>
          <StatusPill source={field.source} />
        </div>
        <div className="field-help mt-1">{field.label}</div>
        {field.restartHint && (
          <div className="flex items-center gap-1 text-[11px] text-amber-600 mt-1.5">
            <ShieldAlert size={12} /> Server restart required for this change to take effect.
          </div>
        )}
      </div>
      <div>
        {editing ? (
          <>
            <input
              className="input input-mono"
              type={field.secret ? 'password' : 'text'}
              value={value === undefined ? '' : value}
              placeholder={field.placeholder || (field.secret ? '••••' : '')}
              onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
              autoComplete="off"
            />
            {field.secret && (
              <div className="text-[11px] text-mute mt-1">
                Leave blank to keep the current value. Type a new value to replace it. Clear to fall back to the .env default.
              </div>
            )}
          </>
        ) : (
          <input
            className="input input-mono"
            value={field.masked || ''}
            placeholder={field.placeholder || '(empty)'}
            readOnly
          />
        )}
      </div>
    </div>
  );
}

function SectionCard({ section, refresh }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [emoji, ...nameParts] = section.sectionLabel.split(' ');
  const name = nameParts.join(' ');

  const startEdit = () => {
    // Pre-fill non-secret fields with their actual masked-but-not-secret value;
    // secrets stay blank so admin must explicitly type them to change.
    const initial = {};
    for (const f of section.fields) {
      if (f.secret) initial[f.key] = '';
      else initial[f.key] = f.masked || '';
    }
    setDraft(initial);
    setMsg(''); setErr('');
    setEditing(true);
  };

  const cancel = () => { setEditing(false); setDraft({}); setErr(''); setMsg(''); };

  const save = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      // Only send keys the admin actually changed (non-blank for secrets,
      // any change for non-secret).
      const patch = {};
      for (const f of section.fields) {
        const v = draft[f.key];
        if (v === undefined) continue;
        if (f.secret) {
          if (v.trim() !== '') patch[f.key] = v;
        } else {
          if (v !== (f.masked || '')) patch[f.key] = v;
        }
      }
      if (!Object.keys(patch).length) {
        setMsg('Nothing to save.');
        setEditing(false);
        return;
      }
      await api('/api/admin/settings', { method: 'PATCH', body: patch });
      setMsg(`✓ Saved ${Object.keys(patch).length} setting${Object.keys(patch).length === 1 ? '' : 's'}.`);
      setEditing(false);
      await refresh();
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-card mt-5 transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-center justify-between gap-3 pb-3 mb-1 border-b" style={{ borderColor: 'var(--line-2)' }}>
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0" style={{ background: 'var(--surface-2)' }}>
            {emoji}
          </span>
          <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{name}</div>
        </div>
        {!editing ? (
          <button className="btn-ghost btn-ghost-accent text-xs inline-flex items-center gap-1.5" onClick={startEdit}>
            <Pencil size={12} /> Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" onClick={cancel} disabled={busy}>Cancel</button>
            <button className="btn-teal text-xs" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      {section.fields.map((f) => (
        <FieldRow key={f.key} field={f} draft={draft} setDraft={setDraft} editing={editing} />
      ))}

      {msg && <div className="mt-3 text-sm text-lime-700 flex items-center gap-1.5"><ShieldCheck size={14} /> {msg}</div>}
      {err && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
    </div>
  );
}

export default function Settings() {
  const { currentUser } = useApp();
  const [sections, setSections] = useState(() => readCache('admin.settings', currentUser?.id));
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(true);

  const load = async () => {
    setErr('');
    setRefreshing(true);
    try {
      const d = await api('/api/admin/settings');
      setSections(d.sections);
      writeCache('admin.settings', currentUser?.id, d.sections);
    } catch (e) {
      setErr(e.message);
      setSections((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      {/* "Settings" title now lives in the sticky top bar instead of here —
          the "· credentials" distinction moved into this subtitle so it's
          not lost. */}
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <strong className="text-slate-900">Credentials</strong> — edit secrets and external-service URLs. Values you save here are stored
          encrypted in the database and override <code>.env</code>. Clearing a field falls back to
          the env value.
          {refreshing && sections != null && <span className="text-xs text-mute ml-2">Refreshing…</span>}
        </p>
        <button className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5 shrink-0" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {err && <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {sections === null && <div className="mt-6 text-mute text-sm">Loading…</div>}

      {(sections || []).map((sec) => (
        <SectionCard key={sec.section} section={sec} refresh={load} />
      ))}

      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
        <div className="flex items-center gap-1.5 font-semibold text-amber-700">
          <ShieldAlert size={14} /> Notes
        </div>
        <ul className="mt-2 space-y-1 text-amber-800/80 text-xs">
          <li>• <strong>Override</strong> — value lives in the <code>settings</code> table; takes precedence over <code>.env</code>.</li>
          <li>• <strong>From .env</strong> — value comes from the server's <code>.env</code> file; no DB override.</li>
          <li>• Secrets are stored as plain text in DB — make sure DB access is restricted (it is: only Postgres user <code>postgres</code> can read).</li>
          <li>• Settings flagged with ⚠ require a server restart because their SDK client (Stripe, MCP) is constructed at boot.</li>
        </ul>
      </div>
    </div>
  );
}
