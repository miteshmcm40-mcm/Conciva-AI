import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { useVoicePreview } from '../../hooks/useVoicePreview.js';
import { readCache, writeCache, invalidateNumbersCaches } from '../../utils/swrCache.js';

// Google Gemini TTS voices (multilingual — speak any of the languages below
// natively, not phonetically). Kore is the calm, articulate default.
// `gender` matches the voice the preview actually renders (server/tts.js
// GEMINI_TO_GOOGLE_EN) so the label agrees with what the customer hears.
export const VOICES = [
  { value: 'Kore',     label: 'Kore',     desc: 'Calm, articulate (default)', gender: 'female', allLang: true },
  { value: 'Puck',     label: 'Puck',     desc: 'Bright, energetic',          gender: 'male',   allLang: true },
  { value: 'Charon',   label: 'Charon',   desc: 'Informative, steady',        gender: 'male',   allLang: true },
  { value: 'Aoede',    label: 'Aoede',    desc: 'Warm, breathy',              gender: 'female', allLang: true },
  { value: 'Fenrir',   label: 'Fenrir',   desc: 'Excitable, young',           gender: 'male'   },
  { value: 'Leda',     label: 'Leda',     desc: 'Youthful, friendly',         gender: 'female' },
  { value: 'Orus',     label: 'Orus',     desc: 'Firm, authoritative',        gender: 'male'   },
  { value: 'Zephyr',   label: 'Zephyr',   desc: 'Bright, lively',             gender: 'female' },
  { value: 'Algieba',  label: 'Algieba',  desc: 'Smooth, balanced',           gender: 'female' },
  { value: 'Sulafat',  label: 'Sulafat',  desc: 'Refined, professional',      gender: 'male'   },
];

// Deterministic avatar gradient per agent so each card has a stable colour.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#7c3aed,#a855f7)',  // purple
  'linear-gradient(135deg,#0ea5e9,#22d3ee)',  // sky
  'linear-gradient(135deg,#14b8a6,#2dd4bf)',  // rose
  'linear-gradient(135deg,#10b981,#34d399)',  // emerald
  'linear-gradient(135deg,#f59e0b,#fbbf24)',  // amber
  'linear-gradient(135deg,#6366f1,#818cf8)',  // indigo
];
export const gradientFor = (key) => {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
};

// Map a number's provisioning status → { dot colour, human label }.
export const statusMeta = (status) => {
  const s = String(status || '').toLowerCase();
  if (['active', 'provisioned', 'ready', 'ok', 'synced'].includes(s)) return { dot: 'bg-emerald-500', label: 'Active' };
  if (['error', 'failed'].includes(s))                                 return { dot: 'bg-red-500',     label: 'Error' };
  if (['unprovisioned', '', 'none'].includes(s))                       return { dot: 'bg-slate-400',   label: 'Not set up' };
  return { dot: 'bg-amber-500', label: s.charAt(0).toUpperCase() + s.slice(1) };
};

// Small ♀/♂ gender chip shown next to each voice.
const GenderChip = ({ gender }) => (
  <span className={`ml-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold align-middle ${
    gender === 'female'
      ? 'bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300'
      : 'bg-lime-100 text-lime-600 dark:bg-lime-500/20 dark:text-lime-300'
  }`}>
    {gender === 'female' ? '♀ Female' : '♂ Male'}
  </span>
);

// South Africa's official languages (English + the other 10), matching the
// South African phone number / Rand currency used elsewhere in the demo data.
export const LANGUAGES = [
  { value: 'en-ZA',  label: 'English (South Africa)', native: 'English',    flag: '🇿🇦' },
  { value: 'af-ZA',  label: 'Afrikaans',               native: 'Afrikaans',  flag: '🇿🇦' },
  { value: 'zu-ZA',  label: 'Zulu',                     native: 'isiZulu',   flag: '🇿🇦' },
  { value: 'xh-ZA',  label: 'Xhosa',                    native: 'isiXhosa',  flag: '🇿🇦' },
  { value: 'st-ZA',  label: 'Sesotho',                  native: 'Sesotho',   flag: '🇿🇦' },
  { value: 'tn-ZA',  label: 'Setswana',                 native: 'Setswana',  flag: '🇿🇦' },
  { value: 'nso-ZA', label: 'Sepedi',                   native: 'Sepedi',    flag: '🇿🇦' },
  { value: 'ts-ZA',  label: 'Tsonga',                   native: 'Xitsonga',  flag: '🇿🇦' },
  { value: 'ss-ZA',  label: 'Swati',                    native: 'siSwati',   flag: '🇿🇦' },
  { value: 've-ZA',  label: 'Venda',                    native: 'Tshivenda', flag: '🇿🇦' },
  { value: 'nr-ZA',  label: 'Ndebele',                  native: 'isiNdebele', flag: '🇿🇦' },
];

const emptyDraft = () => ({
  // Label is the human-friendly nickname for this DID — surfaced on Numbers
  // and Billing as a pill. Edited here alongside the agent so the customer
  // sets all per-number metadata in one place.
  label: '',
  agentName: '', greeting: '', prompt: '',
  voice: 'Kore', language: 'en-US',
  kbCompany: '', kbFaqs: '',
});

export default function KbAgent() {
  const { currentUser } = useApp();
  const { playingVoice, error: previewError, play } = useVoicePreview();
  const [searchParams, setSearchParams] = useSearchParams();

  const [numbers, setNumbers] = useState(() => readCache('kbAgent.numbers', currentUser?.id) ?? []);
  const [selectedId, setSelectedId] = useState(searchParams.get('n') || '');
  const [draft, setDraft] = useState(emptyDraft);
  const [voicePrompt, setVoicePrompt] = useState(null);   // voice being considered in the apply/preview popup
  const [savedMsg, setSavedMsg] = useState({});
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  // Website-import wizard state. `importing` is the modal flag; the rest is
  // the form / loading / result state held while it's open.
  const [importing, setImporting]   = useState(false);
  const [importUrl, setImportUrl]   = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr]   = useState('');
  const [importPreview, setImportPreview] = useState(null);  // { kbCompany, kbFaqs, url, faqCount }

  // Language-change propagation (~120s for the dashboard to translate + reload).
  const PROPAGATION_SECONDS = 120;
  const [propagating, setPropagating] = useState(null);
  useEffect(() => {
    if (!propagating) return;
    if (propagating.secondsLeft <= 0) return;
    const t = setTimeout(() => {
      setPropagating((p) => p && { ...p, secondsLeft: p.secondsLeft - 1 });
    }, 1000);
    return () => clearTimeout(t);
  }, [propagating]);

  const loadNumbers = async () => {
    try {
      const r = await api('/api/numbers');
      const next = r.numbers || [];
      setNumbers(next);
      writeCache('kbAgent.numbers', currentUser?.id, next);
      setLoadErr('');
      // Only auto-select when deep-linked via ?n=<id>. Otherwise leave nothing
      // selected so the page shows the agent cards + a "pick an agent"
      // placeholder until the user clicks one.
      const want = searchParams.get('n');
      const active = r.numbers.find((n) => n.id === want);
      if (active) setSelectedId(active.id);
    } catch (e) {
      setLoadErr(e.message);
    }
  };

  useEffect(() => { loadNumbers(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => numbers.find((n) => n.id === selectedId) || null,
    [numbers, selectedId],
  );

  // Reset draft whenever the selected number changes.
  useEffect(() => {
    if (!selected) { setDraft(emptyDraft()); return; }
    setDraft({
      label:     selected.label     || '',
      agentName: selected.agentName || '',
      greeting:  selected.greeting  || '',
      prompt:    selected.prompt    || '',
      voice:     selected.voice     || 'Kore',
      language:  selected.language  || 'en-US',
      kbCompany: selected.kbCompany || '',
      kbFaqs:    selected.kbFaqs    || '',
    });
  }, [selected]);

  if (!currentUser) return null;

  const pickNumber = (id) => {
    setSelectedId(id);
    setSearchParams((sp) => { sp.set('n', id); return sp; }, { replace: true });
    setSavedMsg({});
  };

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Two-step save flow:
  //   • requestSave()  — opens the confirmation modal with a brief explainer
  //   • confirmSave()  — runs after the user clicks Proceed; does the actual
  //                       PATCH and starts the propagation countdown
  //   • cancelSave()   — dismisses the modal
  // For language changes the countdown is 120 s (the dashboard's existing
  // re-translate loop). For everything else it's 120 s (KB re-sync + prompt-
  // version snapshot + agent restart).
  const PROPAGATION_GENERAL = 120;
  const [pendingSave, setPendingSave] = useState(null);

  const requestSave = (which, fields) => {
    if (!selected) return;
    setPendingSave({ which, fields });
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    const { which, fields } = pendingSave;
    const languageChanged = fields.language && fields.language !== selected.language;
    setPendingSave(null);
    setBusy(true);
    setSavedMsg((m) => ({ ...m, [which]: 'Saving…' }));
    try {
      const r = await api(`/api/numbers/${selected.id}`, { method: 'PATCH', body: fields });
      setNumbers((ns) => ns.map((n) => (n.id === selected.id ? r.number : n)));
      invalidateNumbersCaches();
      setSavedMsg((m) => ({ ...m, [which]: '✓ Saved · syncing' }));
      // Start the propagation countdown — 120 s for both language and other changes.
      const total = languageChanged ? PROPAGATION_SECONDS : PROPAGATION_GENERAL;
      const lang = LANGUAGES.find((l) => l.value === fields.language);
      setPropagating({
        languageLabel: languageChanged && lang
          ? `${lang.label}${lang.native && !lang.value.startsWith('en') ? ` (${lang.native})` : ''}`
          : null,
        secondsLeft: total,
        totalSeconds: total,
      });
    } catch (e) {
      setSavedMsg((m) => ({ ...m, [which]: `✗ ${e.message}` }));
    } finally {
      setBusy(false);
    }
  };

  const cancelSave = () => setPendingSave(null);

  const propagationLocked = !!propagating && propagating.secondsLeft > 0;

  if (loadErr) {
    return (
      <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-500">
        Couldn't load your numbers: {loadErr}
      </div>
    );
  }
  if (!numbers.length) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Knowledge &amp; Agent</h1>
        <p className="text-mute mt-2">
          You don't have any phone numbers yet. Go to the <strong>Numbers</strong> tab to add one
          before configuring the agent.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Knowledge &amp; Agent</h1>
          <p className="text-mute">Each number has its own agent and knowledge base. Pick which one to edit.</p>
        </div>
        <span className="pill bg-lime-500/20 text-lime-400">● Synced</span>
      </div>

      <div className="mt-4 form-card">
        <label className="field-label">Editing agent for</label>
        <div className="mt-2 space-y-2">
          {numbers.map((n) => {
            const active = n.id === selected?.id;
            const name = (n.agentName || n.label || 'Agent').trim();
            const initial = (name[0] || '#').toUpperCase();
            const st = statusMeta(n.status);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => pickNumber(n.id)}
                className={`w-full flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                  active
                    ? 'border-lime-400 ring-2 ring-lime-100 dark:ring-lime-500/20 bg-lime-50/60 dark:bg-lime-500/10'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {/* Avatar + status dot */}
                <div className="relative shrink-0">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm"
                    style={{ background: gradientFor(n.id) }}
                  >
                    {initial}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${st.dot}`} />
                </div>

                {/* Name + meta line */}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{name}</div>
                  <div className="text-xs text-mute truncate flex items-center gap-1.5">
                    <span className="font-mono">{n.value}</span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span>{n.plan?.label || 'Starter'}</span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span>{st.label}</span>
                    {n.isPrimary && (<><span className="text-slate-300 dark:text-slate-600">|</span><span>Primary</span></>)}
                  </div>
                </div>

                {active && <span className="shrink-0 text-lime-500 text-lg font-bold">✓</span>}
              </button>
            );
          })}
        </div>
        <div className="field-help mt-2">
          Pick an agent to edit. Saves on this page apply only to the selected agent.
        </div>
      </div>

      {selected ? (
      <>
      {/* Prominent top-right action — import the whole knowledge base from a website. */}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm bg-[linear-gradient(135deg,#0b0b0c_0%,#171717_45%,#0d9488_100%)] hover:opacity-95 transition"
          onClick={() => { setImporting(true); setImportErr(''); setImportPreview(null); setImportUrl(''); }}
        >
          🌐 Import knowledge from website
        </button>
      </div>

      {propagating && (() => {
        const fmtTime = (s) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
        const total = propagating.totalSeconds || PROPAGATION_SECONDS;
        return (
          <div className={`mt-4 rounded-xl border p-4 ${propagationLocked ? 'border-lime-300 bg-lime-50' : 'border-green-300 bg-green-50'}`}>
            {propagationLocked ? (
              <>
                <div className="flex items-center gap-2 text-sm font-semibold text-lime-700">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="50" strokeDashoffset="20" />
                  </svg>
                  {propagating.languageLabel
                    ? <>Updating your agent for <strong>{propagating.languageLabel}</strong> …</>
                    : <>Updating your agent …</>
                  }
                </div>
                <p className="text-xs text-slate-700 mt-1">
                  {propagating.languageLabel
                    ? 'Translating the greeting and restarting your voice agent.'
                    : 'Re-syncing knowledge base, rebuilding the prompt-version snapshot, and restarting your voice agent.'}
                  {' '}
                  <strong>Please wait {fmtTime(propagating.secondsLeft)} before placing a test call.</strong>
                </p>
                <div className="mt-3 h-1.5 w-full rounded-full bg-lime-100 overflow-hidden">
                  <div
                    className="h-full bg-lime-500 transition-all"
                    style={{ width: `${((total - propagating.secondsLeft) / total) * 100}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-semibold text-green-700">
                  ✓ Ready — your agent is live
                  {propagating.languageLabel && <> in <strong>{propagating.languageLabel}</strong></>}
                  {selected?.value && (
                    <span className="font-normal text-slate-700"> · dial <span className="font-mono">{selected.value}</span> to test</span>
                  )}
                </div>
                <button onClick={() => setPropagating(null)} className="text-xs text-mute hover:text-slate-900">dismiss</button>
              </div>
            )}
          </div>
        );
      })()}

      <div className="mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="form-card">
              <div className="text-xs text-lime-600 uppercase font-semibold mb-3">Agent identity</div>

              {/* Label for the DID itself — moved here from the Numbers page
                  so all per-number settings (label, agent, voice, language,
                  KB) live in one place. The pill on Numbers/Billing reflects
                  whatever the customer saves here. */}
              <label className="field-label">🏷 Label for this number</label>
              <input
                className="input"
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder="e.g. Sales, Support, Gujarat Police Station…"
                disabled={propagationLocked}
              />
              <div className="text-[11px] text-mute mt-1">
                Appears as a pill on Numbers, Billing, Call history, and Recordings.
              </div>

              <label className="field-label mt-3">Agent name</label>
              <input className="input" value={draft.agentName} onChange={(e) => set({ agentName: e.target.value })} placeholder="e.g. Acme Receptionist" disabled={propagationLocked} />

              <label className="field-label mt-3">Greeting (first line on every call)</label>
              <textarea className="input" rows={3} value={draft.greeting} onChange={(e) => set({ greeting: e.target.value })} placeholder="Hi, thanks for calling…" disabled={propagationLocked} />
              <label className="field-label mt-3">Behavior &amp; routing instructions</label>
              <textarea className="input" rows={6} value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="You are the AI receptionist for…" disabled={propagationLocked} />
            </div>
            <div className="form-card">
              <div className="text-xs text-lime-400 uppercase font-semibold mb-3">Voice</div>
              <div className="space-y-1">
                {VOICES.map((v) => {
                  const sel = draft.voice === v.value;
                  const playing = playingVoice === v.value;
                  return (
                    <div
                      key={v.value}
                      className={`voice-row${sel ? ' selected' : ''}`}
                      onClick={() => setVoicePrompt(v)}
                    >
                      <div>
                        <div className="voice-name font-medium text-sm">
                          {v.label}{sel ? ' ✓' : ''}
                          <GenderChip gender={v.gender} />
                        </div>
                        <div className="text-xs text-mute">{v.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); play(v.value, 'en-US'); }}
                        className="ml-2 w-7 h-7 rounded-full flex items-center justify-center text-xs hover:bg-lime-500/20"
                        style={{
                          color: playing ? '#06121a' : (sel ? '#5eead4' : '#94a3b8'),
                          background: playing ? 'linear-gradient(135deg, #2dd4bf, #22d3ee)' : 'transparent',
                        }}
                        title={playing ? 'Stop preview' : 'Play 5-second preview'}
                      >
                        {playing ? '◼' : '▶'}
                      </button>
                    </div>
                  );
                })}
              </div>
              {previewError && (
                <div className="mt-3 text-xs text-amber-400">⚠ {previewError}</div>
              )}
              <div className="mt-3 text-[11px] text-mute">Click a voice to apply it or preview it · ▶ plays a 5-second sample.</div>
            </div>
          </div>

          {/* Apply / preview popup — opened by clicking a voice row. */}
          {voicePrompt && (() => {
            const playing = playingVoice === voicePrompt.value;
            return (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-sm"
                onClick={() => setVoicePrompt(null)}
              >
                <div
                  className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center">
                      <span className="text-base font-bold text-slate-900 dark:text-slate-100">{voicePrompt.label}</span>
                      <GenderChip gender={voicePrompt.gender} />
                      {draft.voice === voicePrompt.value && (
                        <span className="ml-2 text-[10px] font-semibold text-lime-600">✓ current</span>
                      )}
                    </div>
                    <div className="text-xs text-mute mt-0.5">{voicePrompt.desc}</div>
                  </div>

                  <div className="px-5 py-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { play(voicePrompt.value, 'en-US'); }}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
                    >
                      {playing ? '◼ Stop' : '▶ Just preview'}
                    </button>
                    <button
                      type="button"
                      disabled={propagationLocked}
                      onClick={() => { set({ voice: voicePrompt.value }); setVoicePrompt(null); }}
                      className="px-3 py-2.5 rounded-lg btn-ghost btn-ghost-accent text-sm font-semibold disabled:opacity-60"
                    >
                      ✓ Apply to agent
                    </button>
                  </div>
                  {previewError && (
                    <div className="px-5 pb-2 -mt-1 text-xs text-amber-500">⚠ {previewError}</div>
                  )}
                  <div className="px-5 pb-3 text-[11px] text-mute">
                    Applying sets this as the agent's voice — remember to save your agent settings.
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

      {/* === Knowledge base — Company info, then FAQ (import is the top-right button) === */}
      <div className="mt-8">
        <div className="text-lg font-bold text-slate-900 dark:text-slate-100">📚 Knowledge base</div>
        <div className="text-xs text-mute">What this agent knows — company info and the FAQs it answers from.</div>
      </div>

      <div className="mt-4">
          <div className="form-card">
            <div className="text-xs text-lime-600 uppercase font-semibold mb-2">Company info</div>
            <p className="text-sm text-mute mb-3">Free-form info this number's agent should always know — services, hours, pricing, policies.</p>
            <textarea
              className="input"
              rows={20}
              value={draft.kbCompany}
              onChange={(e) => set({ kbCompany: e.target.value })}
              placeholder="ABOUT YOUR COMPANY…"
            />
            <div className="mt-3 text-xs text-mute">
              {draft.kbCompany.length.toLocaleString()} / 50,000 characters
            </div>
          </div>
        </div>

      <div className="mt-4">
          <div className="form-card">
            <div className="text-xs text-lime-600 uppercase font-semibold mb-2">FAQ Q&amp;A</div>
            <p className="text-sm text-mute mb-3">Q&amp;A pairs for this number's agent. Format: <code>Q:</code> on one line, <code>A:</code> on the next, blank line between pairs.</p>
            <textarea
              className="input"
              rows={20}
              value={draft.kbFaqs}
              onChange={(e) => set({ kbFaqs: e.target.value })}
              placeholder="Q: What are your business hours?&#10;A: We're open Mon–Fri 9–6 PT.&#10;&#10;Q: …"
            />
            <div className="mt-3 text-xs text-mute">
              {(draft.kbFaqs.match(/^Q:/gm) || []).length} Q&amp;A pairs
            </div>
          </div>
        </div>

      {/* === One common Save — persists agent settings + company info + FAQs together === */}
      <div className="mt-6 sticky bottom-0 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-t border-slate-100 dark:border-slate-800 py-3 flex items-center gap-3 flex-wrap">
        <button
          className="btn-ghost btn-ghost-accent"
          disabled={busy || propagationLocked}
          onClick={() => requestSave('all', {
            label: draft.label,
            agentName: draft.agentName,
            greeting: draft.greeting,
            prompt: draft.prompt,
            voice: draft.voice,
            language: 'en-US',
            kbCompany: draft.kbCompany,
            kbFaqs: draft.kbFaqs,
          })}
        >
          {propagationLocked ? `⏳ Locked · ${propagating.secondsLeft}s` : '💾 Save all changes'}
        </button>
        <span className="text-xs text-mute">{savedMsg.all || ''}</span>
      </div>

      {/* Save-confirmation modal — explains the 2-minute propagation window
          BEFORE the PATCH fires. Clicking Proceed runs the actual save and
          starts the countdown; Cancel just dismisses with no API call. */}
      {pendingSave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6">
            <div className="flex items-start gap-3">
              <span className="text-3xl shrink-0">⏱️</span>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Allow up to 2 minutes for changes to go live
                </h2>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  After you save, the dashboard needs around <strong>2 minutes</strong>{' '}
                  to re-sync the knowledge base, rebuild the prompt-version
                  snapshot, and restart your agent. Please don&apos;t place a
                  test call to{' '}
                  {selected?.value ? <span className="font-mono">{selected.value}</span> : 'your number'}{' '}
                  before the countdown finishes — calls placed earlier may
                  still hit the previous version.
                </p>
                <p className="mt-3 text-xs text-mute">
                  Click <strong>Proceed</strong> to save and start the 2-minute
                  window now.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={cancelSave}
                className="btn-ghost text-sm py-2 px-4"
              >
                Cancel
              </button>
              <button
                onClick={confirmSave}
                className="btn-ghost btn-ghost-accent text-sm py-2 px-4"
                autoFocus
              >
                Proceed → start 2-minute window
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      ) : (
        <div className="mt-6 form-card text-center py-12">
          <div className="text-4xl mb-2">🎛️</div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">Select an agent to edit</div>
          <div className="text-sm text-mute mt-1">
            {numbers.length
              ? 'Click an agent card above to view and edit its greeting, prompt, voice, language and knowledge base.'
              : 'No agents yet — add a number from Plan & Numbers to create one.'}
          </div>
        </div>
      )}

      {/* Website-import modal — paste a URL, Grok extracts company info +
          FAQs from the visible page text, customer reviews the preview and
          chooses Replace or Append into the draft. Still requires the
          existing Save button on each tab to persist. */}
      {importing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-sm px-4 py-10 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold">🌐 Build knowledge base from your website</div>
                <p className="text-xs text-mute mt-1">
                  Paste your homepage URL. We'll read it, extract the most
                  receptionist-relevant facts, and generate Company info +
                  FAQs you can review before saving.
                </p>
              </div>
              <button
                onClick={() => !importBusy && setImporting(false)}
                className="text-2xl text-mute hover:text-slate-900"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label className="field-label mt-4">Website URL</label>
            <input
              className="input text-sm font-mono"
              placeholder="https://yourcompany.com"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              disabled={importBusy}
              onKeyDown={(e) => { if (e.key === 'Enter' && !importBusy) runImport(); }}
            />
            <div className="field-help">
              Single-page fetch — works best on a homepage or "About" page that
              already names your services / hours / location.
            </div>

            {importErr && (
              <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                ⚠ {importErr}
              </div>
            )}

            {importPreview && (
              <div className="mt-4 space-y-3">
                <div className="text-xs text-mute uppercase tracking-wider font-semibold">Preview</div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">Company info ({importPreview.kbCompany.length.toLocaleString()} chars)</div>
                  <pre className="text-xs whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-3 max-h-48 overflow-y-auto">
                    {importPreview.kbCompany || '(empty)'}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">FAQs ({importPreview.faqCount} Q&amp;A pairs)</div>
                  <pre className="text-xs whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-3 max-h-48 overflow-y-auto">
                    {importPreview.kbFaqs || '(no FAQs extracted)'}
                  </pre>
                </div>
                <div className="text-[11px] text-mute">
                  Source: <span className="font-mono text-lime-600 break-all">{importPreview.url}</span>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {!importPreview ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    onClick={() => setImporting(false)}
                    disabled={importBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={runImport}
                    disabled={importBusy || !importUrl.trim()}
                    className="px-4 py-2 rounded-lg text-white text-sm font-semibold bg-[linear-gradient(135deg,#0ea5e9_0%,#6366f1_55%,#8b5cf6_110%)] disabled:opacity-50"
                  >
                    {importBusy ? '⏳ Reading site…' : '✨ Extract Knowledge Base'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-ghost text-sm" onClick={() => setImporting(false)}>
                    Close (don't import)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Append — keep what the user already wrote, add new content below.
                      set({
                        kbCompany: [draft.kbCompany, importPreview.kbCompany].filter(Boolean).join('\n\n'),
                        kbFaqs:    [draft.kbFaqs,    importPreview.kbFaqs   ].filter(Boolean).join('\n\n'),
                      });
                      setImporting(false);
                    }}
                    className="btn-ghost text-sm"
                  >
                    ➕ Append to existing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Replace — overwrite both fields with the extracted content.
                      set({ kbCompany: importPreview.kbCompany, kbFaqs: importPreview.kbFaqs });
                      setImporting(false);
                    }}
                    className="px-4 py-2 rounded-lg text-white text-sm font-semibold bg-[linear-gradient(135deg,#0ea5e9_0%,#6366f1_55%,#8b5cf6_110%)]"
                  >
                    ✅ Replace draft &amp; close
                  </button>
                </>
              )}
            </div>
            <p className="mt-2 text-[11px] text-mute text-right">
              {!importPreview
                ? "We'll show you the extracted content before anything is saved."
                : "Click ➕ Append or ✅ Replace to load into the editor — you still need to click Save on each tab to persist."}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  // Helper hoisted into the component scope so it can read importUrl/setters
  // and the draft setter without prop drilling. Plain function declaration is
  // hoisted, so the JSX above can reference it.
  function runImport() {
    if (!importUrl.trim()) return;
    setImportBusy(true);
    setImportErr('');
    setImportPreview(null);
    api('/api/kb/import-from-website', {
      method: 'POST',
      body: { url: importUrl.trim() },
    })
      .then((r) => setImportPreview({
        kbCompany: r.kbCompany || '',
        kbFaqs:    r.kbFaqs    || '',
        url:       r.url       || importUrl.trim(),
        faqCount:  r.faqCount  || 0,
      }))
      .catch((e) => setImportErr(e.message || 'Could not import from that URL'))
      .finally(() => setImportBusy(false));
  }
}
