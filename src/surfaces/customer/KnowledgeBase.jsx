import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Bot, Info, Copy, Plus, X, Link2, Upload, Loader2 } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api, getToken } from '../../api.js';
import { loadKbTemplates as loadSaved, persistKbTemplates as persistSaved, qaCount } from './kbTemplatesStore.js';
import { readCache, writeCache, invalidateNumbersCaches } from '../../utils/swrCache.js';

// =============================================================================
// Knowledge Base — a library view on top of the per-agent knowledge editor
// (KbAgent.jsx, mounted at "Agents"). Two lists:
//  - "From your agents": each agent's live kbCompany/kbFaqs/prompt, read
//    straight from /api/numbers. "Edit on agent" jumps to the real editor;
//    "Save a copy" snapshots it into a reusable template.
//  - "Saved knowledge bases": reusable templates, shared with AgentDetail.jsx
//    via kbTemplatesStore.js (see that file for why it's localStorage, not a
//    backend table).
// =============================================================================

export default function KnowledgeBase() {
  const { currentUser } = useApp();
  const isAdminTier = currentUser?.userType === 'superadmin' || currentUser?.userType === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  const [numbers, setNumbers] = useState(() => readCache('knowledgeBase.numbers', currentUser?.id) ?? []);
  const [saved, setSaved] = useState(() => loadSaved());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', kbCompany: '', kbFaqs: '' });

  // Import into the "New knowledge base" form from a website URL or an
  // uploaded PDF/DOCX — both run the same AI extraction prompt server-side
  // (see /api/kb/import-from-website and /api/kb/import-from-file).
  const [importUrl, setImportUrl] = useState('');
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState('');
  const [justImported, setJustImported] = useState(false);

  // Clicking a card (anywhere except its two action links) opens a quick
  // edit right here, centered on this page — "Edit on agent" still jumps to
  // the full per-agent editor for deeper changes (voice, language, etc.).
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ prompt: '', kbCompany: '', kbFaqs: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState('');
  const editingAgent = numbers.find((n) => n.id === editingId) || null;

  useEffect(() => {
    (async () => {
      try {
        const r = await api('/api/numbers');
        const next = r.numbers || [];
        setNumbers(next);
        writeCache('knowledgeBase.numbers', currentUser?.id, next);
      } catch {}
    })();
  }, []);

  const saveCopy = (n) => {
    const tpl = {
      id: `tpl-${saved.length}-${n.id}-${saved.length + 1}`,
      name: `${n.agentName || 'Agent'} copy`,
      kbCompany: n.kbCompany || '',
      kbFaqs: n.kbFaqs || '',
      prompt: n.prompt || '',
    };
    const next = [tpl, ...saved];
    setSaved(next);
    persistSaved(next);
  };

  const createTemplate = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const tpl = {
      id: `tpl-custom-${saved.length + 1}`,
      name: form.name.trim(),
      kbCompany: form.kbCompany.trim(),
      kbFaqs: form.kbFaqs.trim(),
      prompt: '',
    };
    const next = [tpl, ...saved];
    setSaved(next);
    persistSaved(next);
    setForm({ name: '', kbCompany: '', kbFaqs: '' });
    closeCreate();
  };

  const applyImported = (r, sourceName) => {
    setForm((f) => ({
      name: f.name.trim() || sourceName,
      kbCompany: [f.kbCompany, r.kbCompany].filter(Boolean).join('\n\n'),
      kbFaqs: [f.kbFaqs, r.kbFaqs].filter(Boolean).join('\n\n'),
    }));
    setJustImported(true);
    setTimeout(() => setJustImported(false), 1000);
  };

  const runUrlImport = async () => {
    if (!importUrl.trim()) return;
    setImportBusy(true); setImportErr('');
    try {
      const r = await api('/api/kb/import-from-website', { method: 'POST', body: { url: importUrl.trim() } });
      applyImported(r, importUrl.trim().replace(/^https?:\/\//i, '').replace(/\/$/, ''));
      setImportUrl('');
    } catch (e) {
      setImportErr(e.message || 'Could not import from that URL');
    } finally {
      setImportBusy(false);
    }
  };

  const runFileImport = async () => {
    if (!importFile) return;
    setImportBusy(true); setImportErr('');
    try {
      const body = new FormData();
      body.append('file', importFile);
      const token = getToken();
      const res = await fetch('/api/kb/import-from-file', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      applyImported(data, importFile.name.replace(/\.[^.]+$/, ''));
      setImportFile(null);
    } catch (e) {
      setImportErr(e.message || 'Could not import that file');
    } finally {
      setImportBusy(false);
    }
  };

  const closeCreate = () => {
    setCreating(false);
    setImportUrl(''); setImportFile(null); setImportErr(''); setImportBusy(false); setJustImported(false);
  };

  const deleteTemplate = (id) => {
    const next = saved.filter((t) => t.id !== id);
    setSaved(next);
    persistSaved(next);
  };

  const openEdit = (n) => {
    setEditingId(n.id);
    setEditForm({ prompt: n.prompt || '', kbCompany: n.kbCompany || '', kbFaqs: n.kbFaqs || '' });
    setEditMsg('');
  };

  const saveAgentEdit = async (e) => {
    e.preventDefault();
    setEditMsg('');
    setEditBusy(true);
    try {
      await api(`/api/numbers/${editingId}`, { method: 'PATCH', body: editForm });
      setNumbers((prev) => prev.map((n) => (n.id === editingId ? { ...n, ...editForm } : n)));
      invalidateNumbersCaches();
      setEditMsg('✓ Saved — the agent picks this up on its next call.');
    } catch (err) {
      setEditMsg(`⚠ ${err.message || 'Could not save'}`);
    } finally {
      setEditBusy(false);
    }
  };

  const NewButton = ({ className = '' }) => (
    <button
      onClick={() => setCreating(true)}
      className={`btn-ghost btn-ghost-accent inline-flex items-center gap-2 ${className}`}
    >
      <Plus className="w-4 h-4" /> New knowledge base
    </button>
  );

  return (
    <div>
      {/* Icon + "Knowledge Base" title now live in the sticky top bar instead of here. */}
      <p className="font-semibold text-base tracking-wide" style={{ color: 'var(--ink-2)' }}>Reusable templates — a greeting, company info, and behavior you can apply to any agent.</p>

      <div className="mt-4 rounded-xl border border-lime-200 bg-lime-50 dark:border-lime-500/30 dark:bg-lime-500/10 p-3 flex gap-2.5">
        <Info className="w-3.5 h-3.5 text-lime-600 dark:text-lime-400 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Every agent already has its own knowledge base. Save one here to <strong>reuse it across numbers</strong> — then
          apply it from the <Link to={`${basePath}/agents`} className="text-lime-600 dark:text-lime-400 font-semibold hover:underline">Agents</Link> page
          under <strong>Import from knowledge base</strong>. The agent keeps its own editable copy.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-2">
        <h2 className="font-bold text-slate-900 dark:text-slate-100">From your agents</h2>
        <span className="pill bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 text-xs">{numbers.length}</span>
      </div>
      <p className="text-sm text-mute mt-0.5">Each agent's live knowledge — click a card to edit it, or save a copy to reuse elsewhere.</p>

      {numbers.length === 0 ? (
        <div className="mt-4 rounded-xl border-2 border-dashed py-10 px-6 text-center">
          <div className="mx-auto w-10 h-10 rounded-xl bg-lime-100 dark:bg-lime-500/20 flex items-center justify-center text-lime-600 dark:text-lime-400">
            <Bot className="w-4 h-4" />
          </div>
          <div className="mt-3 font-bold text-slate-900 dark:text-slate-100">No agents yet</div>
          <p className="mt-1 text-sm text-mute max-w-md mx-auto">
            Add a plan to get an agent, then its knowledge base shows up here.
          </p>
        </div>
      ) : (
      <div className="mt-4 space-y-2">
        {numbers.map((n, i) => (
          <div
            key={n.id}
            onClick={() => openEdit(n)}
            className="form-card !p-4 ring-1 ring-lime-500/10 animate-fade-up animate-border-glow transition hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-start justify-between">
              <div className="w-8 h-8 rounded-lg bg-lime-100 dark:bg-lime-500/20 flex items-center justify-center text-lime-600 dark:text-lime-400">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <span className="pill bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300 text-xs">
                <span className="live-dot" /> Live
              </span>
            </div>
            <div className="mt-1.5 font-bold text-slate-900 dark:text-slate-100">{n.agentName || 'Unnamed agent'}</div>
            <a href={`tel:${n.value}`} onClick={(e) => e.stopPropagation()} className="text-sm text-lime-600 dark:text-lime-400 font-mono hover:underline">{n.value}</a>
            {n.prompt && (
              <p className="mt-1.5 text-sm text-mute italic line-clamp-2">“{n.prompt}”</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
                {(n.kbCompany || '').length.toLocaleString()} chars info
              </span>
              <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
                {qaCount(n.kbFaqs)} Q&amp;A
              </span>
              {n.prompt && (
                <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
                  behavior set
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Link
                to={`${basePath}/agents`}
                onClick={(e) => e.stopPropagation()}
                className="text-sm text-lime-600 dark:text-lime-400 font-semibold hover:underline"
              >
                Edit on agent →
              </Link>
              <button
                onClick={(e) => { e.stopPropagation(); saveCopy(n); }}
                className="inline-flex items-center gap-1.5 text-sm text-lime-600 dark:text-lime-400 font-semibold hover:underline"
              >
                <Copy className="w-3.5 h-3.5" /> Save a copy
              </button>
            </div>
          </div>
        ))}
      </div>
      )}

      <div className="mt-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-slate-900 dark:text-slate-100">Saved knowledge bases</h2>
          <span className="pill bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 text-xs">{saved.length}</span>
        </div>
        {saved.length > 0 && <NewButton className="text-sm py-2 px-4" />}
      </div>
      <p className="text-sm text-mute mt-0.5">Reusable templates you can apply to any agent — save as many as your plan allows.</p>

      {saved.length === 0 ? (
        <div className="mt-4 rounded-xl border-2 border-dashed py-10 px-6 text-center animate-fade-up animate-border-glow transition duration-300 ease-out hover:-translate-y-0.5">
          <div className="mx-auto w-10 h-10 rounded-xl bg-lime-100 dark:bg-lime-500/20 flex items-center justify-center text-lime-600 dark:text-lime-400 transition duration-300 ease-out hover:scale-110 hover:shadow-md">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="mt-3 font-bold text-slate-900 dark:text-slate-100">No saved knowledge bases yet</div>
          <p className="mt-1 text-sm text-mute max-w-md mx-auto">
            Build one from scratch, or hit <strong>Save a copy</strong> on an agent above to turn its setup into a reusable template.
          </p>
          <NewButton className="mt-4" />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {saved.map((t, i) => (
            <div key={t.id} className="form-card !p-4 animate-fade-up animate-border-glow transition hover:shadow-md hover:-translate-y-0.5" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="font-bold text-slate-900 dark:text-slate-100">{t.name}</div>
                <button onClick={() => deleteTemplate(t.id)} className="text-mute hover:text-slate-900 dark:hover:text-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
                  {(t.kbCompany || '').length.toLocaleString()} chars info
                </span>
                <span className="pill bg-white text-slate-700 border border-slate-200 dark:bg-transparent dark:text-slate-300 dark:border-slate-700 text-xs">
                  {qaCount(t.kbFaqs)} Q&amp;A
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New knowledge base — a blank reusable template, saved locally. */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 animate-backdrop-in">
          <form onSubmit={createTemplate} className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border p-6 animate-modal-in animate-modal-border-shadow max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">New knowledge base</h2>
                <p className="mt-1 text-sm text-mute">A reusable template you can apply to any agent later.</p>
              </div>
              <button type="button" onClick={closeCreate} className="text-mute hover:text-slate-900 dark:hover:text-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className={`mt-4 rounded-lg border p-3 transition-colors ${importBusy ? 'animate-import-glow' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">Import from</div>

              <div className="mt-2 flex gap-2 animate-fade-up" style={{ animationDelay: '40ms' }}>
                <input
                  className="input text-sm transition duration-200 ease-out focus:shadow-md"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  disabled={importBusy}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runUrlImport(); } }}
                />
                <button
                  type="button"
                  onClick={runUrlImport}
                  disabled={importBusy || !importUrl.trim()}
                  className="btn-ghost btn-ghost-accent text-sm px-3 whitespace-nowrap inline-flex items-center gap-1.5 transition duration-200 ease-out hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 disabled:opacity-90"
                >
                  {importBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} URL
                </button>
              </div>

              <div className="mt-2 flex gap-2 animate-fade-up" style={{ animationDelay: '80ms' }}>
                <label className="input text-sm text-mute flex items-center cursor-pointer overflow-hidden transition duration-200 ease-out hover:shadow-sm">
                  <span className="truncate">{importFile ? importFile.name : 'Choose a PDF or DOCX…'}</span>
                  <input
                    type="file"
                    accept=".pdf,.docx"
                    className="hidden"
                    disabled={importBusy}
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  />
                </label>
                <button
                  type="button"
                  onClick={runFileImport}
                  disabled={importBusy || !importFile}
                  className="btn-ghost btn-ghost-accent text-sm px-3 whitespace-nowrap inline-flex items-center gap-1.5 transition duration-200 ease-out hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 disabled:opacity-90"
                >
                  {importBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} File
                </button>
              </div>

              <p className="mt-2 text-[11px] text-mute">
                {importBusy ? 'Reading…' : 'Extracted company info and FAQs are appended below — review before creating.'}
              </p>
              {importErr && <div className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 animate-shake">⚠ {importErr}</div>}
            </div>

            <label className="field-label mt-4">Name *</label>
            <input className="input transition duration-200 ease-out focus:shadow-md" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Support desk template" />

            <label className="field-label mt-3">Company info</label>
            <textarea className={`input transition duration-200 ease-out focus:shadow-md ${justImported ? 'animate-flash' : ''}`} rows={4} value={form.kbCompany} onChange={(e) => setForm((f) => ({ ...f, kbCompany: e.target.value }))} placeholder="Hours, pricing, policies…" />

            <label className="field-label mt-3">FAQs</label>
            <textarea className={`input transition duration-200 ease-out focus:shadow-md ${justImported ? 'animate-flash' : ''}`} rows={4} value={form.kbFaqs} onChange={(e) => setForm((f) => ({ ...f, kbFaqs: e.target.value }))} placeholder={'Q: ...\nA: ...'} />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={closeCreate} className="btn-ghost text-sm py-2 px-4 transition duration-200 ease-out hover:scale-[1.03] active:scale-95">Cancel</button>
              <button type="submit" className="btn-ghost btn-ghost-accent text-sm py-2 px-4 transition duration-200 ease-out hover:scale-[1.03] active:scale-95">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Quick edit — opened by clicking a card. Centered on this page
          instead of navigating away; "Edit on agent" still jumps to the
          full editor for anything beyond prompt/company-info/FAQs. */}
      {editingAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 animate-backdrop-in"
          onClick={() => setEditingId(null)}
        >
          <form
            onSubmit={saveAgentEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border p-6 animate-modal-in animate-modal-border-shadow max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{editingAgent.agentName || 'Unnamed agent'}</h2>
                <p className="mt-0.5 text-sm text-mute font-mono">{editingAgent.value}</p>
              </div>
              <button type="button" onClick={() => setEditingId(null)} className="text-mute hover:text-slate-900 dark:hover:text-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="field-label mt-4">Behavior / prompt</label>
            <textarea className="input" rows={3} value={editForm.prompt} onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))} placeholder="You are the AI receptionist for…" />

            <label className="field-label mt-3">Company info</label>
            <textarea className="input" rows={4} value={editForm.kbCompany} onChange={(e) => setEditForm((f) => ({ ...f, kbCompany: e.target.value }))} placeholder="Hours, pricing, policies…" />
            <div className="field-help">{editForm.kbCompany.length.toLocaleString()} characters</div>

            <label className="field-label mt-3">FAQs</label>
            <textarea className="input" rows={4} value={editForm.kbFaqs} onChange={(e) => setEditForm((f) => ({ ...f, kbFaqs: e.target.value }))} placeholder={'Q: ...\nA: ...'} />
            <div className="field-help">{qaCount(editForm.kbFaqs)} Q&amp;A pairs</div>

            {editMsg && (
              <div className={`mt-3 text-sm rounded px-3 py-2 border ${editMsg.startsWith('⚠')
                ? 'text-red-600 bg-red-50 border-red-200'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200'}`}
              >
                {editMsg}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setEditingId(null)} className="btn-ghost text-sm py-2 px-4">Close</button>
              <button type="submit" disabled={editBusy} className="btn-ghost btn-ghost-accent text-sm py-2 px-4">
                {editBusy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
