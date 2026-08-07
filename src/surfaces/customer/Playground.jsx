import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, MessageCircle, ChevronDown, Phone, SlidersHorizontal,
  Send, Check, Volume2,
} from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { readCache, writeCache, invalidateNumbersCaches } from '../../utils/swrCache.js';
import { useVoicePreview } from '../../hooks/useVoicePreview.js';
import { VOICES, gradientFor } from './KbAgent.jsx';

// Same single preview chat agent shown on the Agents list — this account
// doesn't have a real chat-agent backend, so its config here is local-only
// (see ChatAgentDetail.jsx for the fuller version of this same honesty note).
const PREVIEW_CHAT_AGENT = {
  id: 'preview-chat',
  agentName: 'My Agent',
  greeting: 'Hi! How can I help you today?',
  prompt: 'You are a helpful customer support assistant. Be concise, friendly, and professional.',
  kbCompany: '', kbFaqs: '',
};

// Configure is tab-based: only one of these three renders at a time. Voice
// is intentionally NOT one of these tabs — voice/chat mode is controlled
// solely by the Voice/Chat toggle in the left panel, so a Voice entry here
// would just duplicate that control.
const CONFIG_TABS = [
  { id: 'greeting',  label: 'Greeting' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'behavior',  label: 'Behavior' },
];

// Compact pill version of the agent selector — sits in its own row above
// the two-column layout (beside Hide/Show config) instead of spanning the
// left card. Same selection state/logic as before, just smaller and given a
// light glass/transparency treatment to match the rest of the header row.
function AgentPillSelector({ agents, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const current = agents.find((a) => a.id === selectedId) || agents[0];
  if (!current) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border backdrop-blur-sm transition-transform duration-200 hover:scale-105 active:scale-95"
        style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.55)', boxShadow: '0 6px 18px -8px rgba(0,0,0,0.25)' }}
      >
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
          style={{ background: gradientFor(current.id) }}
        >
          {(current.agentName || '?')[0].toUpperCase()}
        </span>
        <span className="font-semibold text-sm truncate max-w-[140px]">{current.agentName}</span>
        <ChevronDown size={14} className={`text-mute flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 w-64 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 py-1"
          style={{ background: 'rgba(255,255,255,0.92)' }}
        >
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--surface-2)]"
            >
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                style={{ background: gradientFor(a.id) }}
              >
                {(a.agentName || '?')[0].toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-sm truncate">{a.agentName}</span>
                <span className="block text-xs text-mute truncate">{a.type === 'chat' ? 'Chat agent' : a.value}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Modern segmented control: a sliding pill glides beneath the active option
// instead of an instant background swap (2026 UI pattern for pill-shaped
// tab groups). Same options/value/onChange contract as the plain button
// groups it replaces — purely how the active state is rendered, no change
// to click handlers or state. Used for the Voice/Chat toggle (both copies)
// and the Configure tabs, which previously duplicated near-identical markup.
function PillTabs({ options, value, onChange, variant = 'solid', dense = false }) {
  const trackRef = useRef(null);
  const [indicator, setIndicator] = useState(null);

  useLayoutEffect(() => {
    const activeBtn = trackRef.current?.querySelector(`[data-pill="${value}"]`);
    if (activeBtn) setIndicator({ left: activeBtn.offsetLeft, width: activeBtn.offsetWidth });
  }, [value, options]);

  const activeColor = variant === 'outline' ? 'var(--primary)' : 'var(--ink)';

  return (
    <div ref={trackRef} className="relative inline-flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--surface-2)' }}>
      {indicator && (
        <span
          className="absolute top-1 bottom-1 rounded-lg bg-white transition-all duration-300 ease-out pointer-events-none"
          style={{
            left: indicator.left,
            width: indicator.width,
            boxShadow: variant === 'outline' ? 'none' : '0 1px 2px rgba(15,23,42,.08)',
            border: variant === 'outline' ? '1px solid var(--primary)' : 'none',
          }}
        />
      )}
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          data-pill={opt.id}
          onClick={() => onChange(opt.id)}
          className={`relative z-10 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 transition-colors duration-200 hover:scale-105 active:scale-95 ${dense ? 'px-3.5 py-1.5' : 'px-4 py-2'}`}
          style={{ color: value === opt.id ? activeColor : 'var(--ink-3)' }}
        >
          {opt.Icon && <opt.Icon size={14} />} {opt.label}
        </button>
      ))}
    </div>
  );
}

const MODE_OPTIONS = [{ id: 'voice', label: 'Voice', Icon: Mic }, { id: 'chat', label: 'Chat', Icon: MessageCircle }];

export default function Playground() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const { playingVoice, error: previewError, play } = useVoicePreview();

  const [numbers, setNumbers] = useState(() => readCache('playground.numbers', currentUser?.id) ?? []);
  const [loaded, setLoaded] = useState(false);
  // Snapshot at mount: true only when a cache hit already gave us real
  // numbers to decide with. The mode/selection effect below normally waits
  // for `loaded` (the real fetch) before picking an agent — but if we
  // already have cached data, waiting anyway just shows a false "No voice
  // agent yet" flash every time this page opens, defeating the whole point
  // of caching it.
  const hadCachedNumbersRef = useRef(numbers.length > 0);
  const [mode, setMode] = useState('voice');
  const [selectedId, setSelectedId] = useState(null);
  const [configOpen, setConfigOpen] = useState(true);
  const [configTab, setConfigTab] = useState('greeting');
  const [draft, setDraft] = useState(null);
  const [savedDraft, setSavedDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [chatLog, setChatLog] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);

  // Live Conversation transcript — simulated (no live speech-to-text
  // pipeline wired up yet, same "isn't wired up yet" state as the voice
  // test itself), but appended progressively like a real conversation so
  // the panel demos properly.
  const [transcript, setTranscript] = useState([]);
  const transcriptScrollRef = useRef(null);
  const transcriptTimers = useRef([]);
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState('');

  useEffect(() => () => {
    transcriptTimers.current.forEach(clearTimeout);
    try { recognitionRef.current?.abort(); } catch {}
  }, []);

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcript]);

  // Live Voice Status — 'listening'/'processing' are simulated (brief
  // transitional phases right after clicking Start), but 'speaking' and
  // 'error' track the real playingVoice/previewError signals from
  // useVoicePreview, so those two always win over the simulated phase.
  const [voiceStatus, setVoiceStatus] = useState('ready');
  const [sessionElapsedMs, setSessionElapsedMs] = useState(0);
  const listeningTimerRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const sessionStartRef = useRef(null);

  useEffect(() => {
    if (previewError) { setVoiceStatus('error'); return; }
    if (playingVoice) { setVoiceStatus('speaking'); return; }
    if (!testing) setVoiceStatus('ready');
  }, [testing, playingVoice, previewError]);

  useEffect(() => {
    if (voiceStatus === 'ready') {
      if (sessionTimerRef.current) { clearInterval(sessionTimerRef.current); sessionTimerRef.current = null; }
      sessionStartRef.current = null;
      setSessionElapsedMs(0);
      return;
    }
    if (!sessionStartRef.current) {
      sessionStartRef.current = Date.now();
      sessionTimerRef.current = setInterval(() => {
        setSessionElapsedMs(Date.now() - sessionStartRef.current);
      }, 250);
    }
  }, [voiceStatus]);

  useEffect(() => () => {
    clearTimeout(listeningTimerRef.current);
    if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
  }, []);

  const fmtSessionDuration = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const VOICE_STATUS_CONFIG = {
    ready:      { dot: 'bg-emerald-500', title: 'Ready' },
    listening:  { dot: 'bg-blue-500 animate-pulse', title: 'Listening...' },
    processing: { dot: 'bg-amber-400 animate-pulse', title: 'Thinking...' },
    speaking:   { dot: 'bg-lime-500 animate-pulse', title: 'Speaking...' },
    error:      { dot: 'bg-red-500', title: 'Voice test error' },
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api('/api/numbers');
        if (!cancelled) {
          const next = r.numbers || [];
          setNumbers(next);
          writeCache('playground.numbers', currentUser?.id, next);
        }
      } catch {}
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const voiceAgents = useMemo(() => numbers.map((n) => ({
    id: n.id, type: 'voice', agentName: n.agentName || n.label || 'Unnamed agent', value: n.value,
    greeting: n.greeting || '', prompt: n.prompt || '', kbCompany: n.kbCompany || '', kbFaqs: n.kbFaqs || '',
    voice: n.voice || 'Kore', language: n.language || 'en-US',
  })), [numbers]);

  const agents = useMemo(() => [
    ...voiceAgents,
    { id: PREVIEW_CHAT_AGENT.id, type: 'chat', agentName: PREVIEW_CHAT_AGENT.agentName, value: null,
      greeting: PREVIEW_CHAT_AGENT.greeting, prompt: PREVIEW_CHAT_AGENT.prompt,
      kbCompany: PREVIEW_CHAT_AGENT.kbCompany, kbFaqs: PREVIEW_CHAT_AGENT.kbFaqs, voice: null, language: null },
  ], [voiceAgents]);

  // Mode governs which agent type is testable — switching modes jumps the
  // picker to the first matching agent instead of showing a mismatched one.
  // A brand-new account has no voice agent yet, but the chat preview agent
  // always exists — default to chat mode instead of falling through to the
  // "No voice agent yet" empty state just because 'voice' is the default.
  // That default should only apply once, on initial load — otherwise this
  // effect re-fires on every mode change (including a manual click on the
  // Voice toggle) and immediately flips back to chat before it can render.
  const didDefaultModeRef = useRef(false);
  useEffect(() => {
    if (!loaded && !hadCachedNumbersRef.current) return;
    if (!didDefaultModeRef.current) {
      didDefaultModeRef.current = true;
      if (mode === 'voice' && voiceAgents.length === 0) { setMode('chat'); return; }
    }
    const wantType = mode === 'chat' ? 'chat' : 'voice';
    const candidates = agents.filter((a) => a.type === wantType);
    // If there's nothing of this type yet (e.g. no voice numbers added),
    // leave the current selection alone rather than nulling it out — the
    // page should keep showing the currently selected agent, just with the
    // voice box in place of the chat box.
    if (candidates.length > 0) {
      const stillValid = candidates.find((a) => a.id === selectedId);
      if (!stillValid) setSelectedId(candidates[0].id);
    }
  }, [mode, loaded, voiceAgents.length]);

  const selected = agents.find((a) => a.id === selectedId) || null;

  useEffect(() => {
    if (!selected) return;
    const d = { greeting: selected.greeting, prompt: selected.prompt, kbCompany: selected.kbCompany, kbFaqs: selected.kbFaqs, voice: selected.voice };
    setDraft(d);
    setSavedDraft(d);
    setChatLog([]);
  }, [selectedId]);

  useEffect(() => { if (!playingVoice) setTesting(false); }, [playingVoice]);
  useEffect(() => { if (previewError) setTesting(false); }, [previewError]);

  if (!currentUser) return null;

  const isAdminTier =
    currentUser.userType === 'superadmin'
    || currentUser.userType === 'admin'
    || currentUser.role === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  // Only the chat preview agent always exists — a brand-new account with no
  // voice agent yet has nothing to test in voice mode. But `draft` is also
  // null on a genuine first-ever visit (no cache) while the numbers fetch is
  // still in flight — showing "No voice agent yet" in that window is a false
  // reading, not a real empty state, and it flashes as a second "page"
  // before the real Playground appears. Only show it once `loaded` confirms
  // the fetch actually finished with nothing to show; until then, a plain
  // loading placeholder — no "add a number" call to action that might not
  // even apply once the real data lands.
  if (!draft || !selected) {
    return (
      <div>
        {!loaded ? (
          <div className="form-card text-center py-12 text-mute">Loading…</div>
        ) : (
          <div className="form-card text-center py-12 text-mute">
            No voice agent yet.
            <div className="mt-3">
              <button type="button" className="btn-ghost btn-ghost-accent" onClick={() => navigate(`${basePath}/numbers`)}>Add a number</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  // Was JSON.stringify(draft) !== JSON.stringify(savedDraft) — re-serializing
  // the whole draft (prompt/company/FAQs can run up to 50,000 chars each) on
  // every render made every keystroke in those fields laggy. A per-field
  // comparison is O(1) for the untouched fields instead.
  const dirty = draft.greeting !== savedDraft.greeting
    || draft.prompt !== savedDraft.prompt
    || draft.kbCompany !== savedDraft.kbCompany
    || draft.kbFaqs !== savedDraft.kbFaqs
    || draft.voice !== savedDraft.voice;
  const isChatAgent = selected.type === 'chat';

  const save = async () => {
    if (isChatAgent) return; // no real backend for the chat agent — stays a local preview
    setSaving(true);
    try {
      const r = await api(`/api/numbers/${selected.id}`, {
        method: 'PATCH',
        body: { greeting: draft.greeting, prompt: draft.prompt, kbCompany: draft.kbCompany, kbFaqs: draft.kbFaqs, voice: draft.voice },
      });
      setNumbers((ns) => ns.map((n) => (n.id === selected.id ? r.number : n)));
      invalidateNumbersCaches();
      setSavedDraft(draft);
    } catch {
      // Save bar below shows dirty state persisting on failure — same
      // pattern as AgentDetail.jsx's save().
    } finally {
      setSaving(false);
    }
  };

  const appendTranscript = (from, text) => {
    setTranscript((t) => [...t, { from, text, time: new Date() }]);
  };

  const stopSpeechRecognition = () => {
    try { recognitionRef.current?.stop(); } catch {}
  };

  const startSpeechRecognition = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechError('Live transcription requires Chrome or another browser that supports speech recognition.');
      return;
    }
    try { recognitionRef.current?.abort(); } catch {}
    const recognition = new Recognition();
    recognition.lang = selected.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => {
      setSpeechError('');
      setIsListening(true);
      setVoiceStatus('listening');
    };
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript?.trim();
          if (text) appendTranscript('user', text);
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const messages = {
        'not-allowed': 'Microphone permission was denied. Allow microphone access and try again.',
        'audio-capture': 'No microphone was found. Connect one and try again.',
        network: 'Speech recognition could not reach the service. Check your connection.',
      };
      setSpeechError(messages[event.error] || 'Speech recognition error: ' + event.error);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const startVoiceTest = () => {
    setTesting(true);
    setVoiceStatus('listening');
    startSpeechRecognition();
    play(draft.voice, selected.language || 'en-US');

    clearTimeout(listeningTimerRef.current);
    listeningTimerRef.current = setTimeout(() => {
      setVoiceStatus((s) => (s === 'listening' ? 'processing' : s));
    }, 600);

    transcriptTimers.current.forEach(clearTimeout);
    transcriptTimers.current = [];
    setTranscript([]);
    transcriptTimers.current.push(setTimeout(() => {
      appendTranscript('agent', draft.greeting || 'Hello! How can I help you today?');
    }, 300));
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const nextLog = [...chatLog, { from: 'user', text }];
    setChatLog(nextLog);
    setChatInput('');
    setChatBusy(true);
    try {
      const r = await api('/api/chat/message', {
        method: 'POST',
        body: {
          messages: nextLog.map((m) => ({ from: m.from, text: m.text })),
          prompt: draft.prompt,
          greeting: draft.greeting,
          kbCompany: draft.kbCompany,
          kbFaqs: draft.kbFaqs,
          agentName: selected.agentName,
        },
      });
      setChatLog((log) => [...log, { from: 'agent', text: r.reply }]);
    } catch (e) {
      setChatLog((log) => [...log, { from: 'system', text: `⚠ ${e.message || 'Could not reach the chat model'}` }]);
    } finally {
      setChatBusy(false);
    }
  };

  const fullEditorPath = isChatAgent ? `${basePath}/agent-detail-chat?n=${encodeURIComponent(selected.id)}` : `${basePath}/agent-detail?n=${encodeURIComponent(selected.id)}`;
  const modeAgents = agents.filter((a) => a.type === mode);
  // Falls back to the full agent list when there's nothing of this type yet
  // (e.g. no voice numbers added) — the Agent Card should still show the
  // currently selected agent rather than rendering nothing.
  const cardAgents = modeAgents.length > 0 ? modeAgents : agents;
  // Solid color pulled out of the avatar's gradient string, for the sonar
  // rings/glow around the mic — a solid border can't use a gradient value.
  const ringColor = gradientFor(selected.id).match(/#[0-9a-f]{6}/i)?.[0] || 'var(--primary)';

  return (
    <div>
      {/* Purely cosmetic keyframes for this page — entrance fade/rise, a
          slow-breathing dark glow behind the mic avatar, and a quick rise-in
          for new chat bubbles. Scoped here (not in a shared stylesheet) so
          nothing outside Playground is affected. */}
      <style>{`
        @keyframes pg-rise   { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pg-fade   { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pg-glow   { 0%, 100% { opacity: .25; transform: scale(0.92); } 50% { opacity: .45; transform: scale(1.05); } }
        @keyframes pg-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pg-sonar  { from { transform: scale(1); opacity: .5; } to { transform: scale(1.7); opacity: 0; } }
        .pg-sonar     { animation: pg-sonar 1.8s ease-out infinite; }
        .pg-rise      { animation: pg-rise .45s cubic-bezier(.16,1,.3,1) both; }
        .pg-rise-1    { animation-delay: .04s; }
        .pg-rise-2    { animation-delay: .1s; }
        .pg-glow      { animation: pg-glow 3.2s ease-in-out infinite; }
        .pg-msg-in    { animation: pg-msg-in .25s ease-out both; }
        /* Fade-only (no transform) so this row never lingers with a non-none
           transform after the animation ends — a transform, even translateY(0),
           makes an element establish its own stacking context, which was
           trapping the agent-selector dropdown's z-index behind the sticky
           panels beside it. The two cards below can safely use pg-rise since
           nothing needs to visually escape above them. */
        .pg-fade      { animation: pg-fade .4s ease-out both; }
      `}</style>

      {/* Selector + config toggle now live in their own row above the
          two-column layout instead of inside the left card. Both keep the
          exact same state/handlers as before, just relocated and given a
          light glass/transparency treatment. */}
      {/* relative + z-20: without an explicit stacking context here, Chrome's
          compositing for the sticky panels below can render them above this
          row's dropdown even though the dropdown has a higher z-index locally
          — giving this row its own explicit (non-auto) z-index above the
          panels' auto one fixes that at the shared parent level. */}
      <div className="pg-fade relative z-20 flex items-center justify-between gap-3">
        <AgentPillSelector agents={cardAgents} selectedId={selectedId} onChange={setSelectedId} />
        <button
          type="button"
          className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5 flex-shrink-0 backdrop-blur-sm bg-white/55 transition-transform duration-200 hover:scale-105 active:scale-95"
          onClick={() => setConfigOpen((v) => !v)}
        >
          <SlidersHorizontal size={14} /> {configOpen ? 'Hide config' : 'Show config'}
        </button>
      </div>

      {/* lg:min-h ensures the grid row is always taller than the test panel
          (which can otherwise end up taller than a short Configure section
          like Behavior alone), since a sticky item can only stay pinned
          while there's leftover room in its own row — without this, sticky
          silently does nothing whenever the left column happens to be the
          taller one. */}
      <div className={`mt-4 grid gap-8 items-start ${configOpen ? 'lg:grid-cols-[1fr_400px] lg:min-h-[820px]' : ''}`}>
        {/* === Test panel (conversation panel) =========================== */}
        {/* Sticky on desktop so it stays visible while the taller Configure
            panel next to it scrolls — no need to scroll back up to reach
            Start voice test / the transcript after editing config. */}
        <div
          className="pg-rise pg-rise-1 form-card p-6 rounded-2xl lg:sticky lg:top-20"
          style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.7) inset, 0 20px 45px -20px rgba(0,0,0,0.28)' }}
        >
          {mode === 'voice' ? (
            <div className="flex flex-col items-center text-center py-6">
              {/* Reuses the same voiceStatus signal as before (still driven
                  by testing/isListening/playingVoice/previewError) — just
                  rendered as a small status chip (using the .dot color that
                  was already defined per-status but previously unused) so it
                  reads like a modern connection/trust indicator. */}
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest backdrop-blur-sm"
                style={{
                  color: voiceStatus === 'error' ? '#dc2626' : 'var(--ink-3)',
                  background: voiceStatus === 'error' ? 'rgba(220,38,38,0.08)' : 'rgba(0,0,0,0.04)',
                  border: `1px solid ${voiceStatus === 'error' ? 'rgba(220,38,38,0.25)' : 'var(--line)'}`,
                }}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${VOICE_STATUS_CONFIG[voiceStatus].dot}`} />
                {voiceStatus === 'ready' ? 'Ready to connect' : VOICE_STATUS_CONFIG[voiceStatus].title}
              </div>

              <div className="relative w-24 h-24 flex items-center justify-center mt-6">
                {/* Soft dark glow sitting behind the avatar for depth — purely
                    decorative, independent of the brand gradient/status colors. */}
                <span
                  className="pg-glow absolute -inset-3 rounded-full blur-xl"
                  style={{ background: 'rgba(0,0,0,0.35)' }}
                />
                {(testing || isListening) && (
                  <>
                    {/* Sonar-style expanding rings, staggered, echoing the
                        waveform/pulse feedback pattern used for "listening"
                        states in modern voice UIs — rather than one flat ping. */}
                    <span className="pg-sonar absolute inset-0 rounded-full border-2" style={{ borderColor: ringColor }} />
                    <span className="pg-sonar absolute inset-0 rounded-full border-2" style={{ borderColor: ringColor, animationDelay: '.6s' }} />
                  </>
                )}
                <div
                  className={`relative w-20 h-20 rounded-full flex items-center justify-center text-white transition-transform duration-300 hover:scale-105 ${testing || isListening ? 'animate-pulse' : ''}`}
                  style={{ background: gradientFor(selected.id), boxShadow: '0 12px 30px -8px rgba(0,0,0,0.45)' }}
                >
                  <Mic size={28} />
                </div>
              </div>

              <h3 className="mt-6 text-lg font-bold" style={{ color: 'var(--ink)' }}>Ready to test your agent</h3>
              <p className="mt-2 text-sm text-mute max-w-sm">
                Start a browser-based voice conversation and evaluate how your agent listens, responds, and handles interruptions.
              </p>

              {/* Change #2: same toggle, same relative position (directly
                  above the primary action) as in the Chat view — kept in
                  sync so switching modes stays available regardless of view. */}
              <div className="mt-6">
                <PillTabs options={MODE_OPTIONS} value={mode} onChange={setMode} />
              </div>

              <button
                type="button"
                className="btn-ghost btn-ghost-accent mt-4 rounded-full px-8 py-3 text-sm inline-flex items-center gap-2 transition-transform duration-200 hover:scale-105 active:scale-95 disabled:hover:scale-100"
                onClick={isListening ? stopSpeechRecognition : startVoiceTest}
                disabled={!draft.voice}
              >
                <Phone size={15} /> {isListening ? 'Stop listening' : testing ? 'Playing…' : 'Start test'}
              </button>

              <div className="mt-4 flex items-center gap-3 text-xs text-mute">
                <span className="inline-flex items-center gap-1"><Mic size={12} /> Microphone required</span>
                <span style={{ color: 'var(--line-2)' }}>|</span>
                <span className="inline-flex items-center gap-1"><Volume2 size={12} /> Audio plays through your browser</span>
              </div>

              {/* Space is always reserved (not just when an error exists) so
                  the panel's total height stays constant whether or not
                  this line is showing — an error appearing/disappearing
                  used to change the panel's height, which (since both grid
                  columns share one row) could make it taller than the
                  Configure panel and eliminate the room sticky needs. */}
              <p className="mt-2 text-xs text-red-600 min-h-[1em]">{speechError || previewError || ' '}</p>
            </div>
          ) : (
            <div>
              <div className="min-h-[220px] max-h-[320px] overflow-y-auto rounded-xl p-4 space-y-2" style={{ background: 'var(--surface-tint)' }}>
                <div className="pg-msg-in max-w-[85%] rounded-xl rounded-tl-sm px-3 py-2 text-sm bg-white" style={{ color: 'var(--ink)' }}>
                  {draft.greeting || 'Hi! How can I help you today?'}
                </div>
                {chatLog.map((m, i) => (
                  <div
                    key={i}
                    className={`pg-msg-in max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.from === 'user' ? 'ml-auto rounded-tr-sm text-white' : 'rounded-tl-sm bg-white'}`}
                    style={
                      m.from === 'user'
                        ? { background: 'var(--primary)' }
                        : m.from === 'system'
                          ? { color: 'var(--ink-3)', fontStyle: 'italic' }
                          : { color: 'var(--ink)' }
                    }
                  >
                    {m.text}
                  </div>
                ))}
                {chatBusy && (
                  <div className="pg-msg-in max-w-[85%] rounded-xl rounded-tl-sm px-3 py-2 text-sm bg-white text-mute italic">
                    Thinking…
                  </div>
                )}
              </div>
              {/* Change #2: the Voice/Chat toggle now lives inside this card,
                  directly above the message input, instead of above the
                  whole grid. Same state/handler as before — only moved. */}
              <div className="mt-4">
                <PillTabs options={MODE_OPTIONS} value={mode} onChange={setMode} />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="Type a message…"
                  value={chatInput}
                  disabled={chatBusy}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendChatMessage(); }}
                />
                <button type="button" className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50 transition-transform duration-200 hover:scale-110 active:scale-95" style={{ background: 'var(--primary)' }} onClick={sendChatMessage} disabled={chatBusy || !chatInput.trim()}>
                  <Send size={15} color="#fff" />
                </button>
              </div>
              <p className="mt-2 text-xs text-mute">Free, no plan minutes used.</p>
            </div>
          )}
        </div>

        {/* === Configure panel =========================================== */}
        {/* Tab-based nav restored: Greeting / Knowledge / Behavior only — no
            Voice tab, since Voice/Chat mode is already controlled by the
            toggle in the left panel. Only the active tab's section renders. */}
        {configOpen && (
          <div
            className="pg-rise pg-rise-2 form-card p-6 rounded-2xl lg:sticky lg:top-20"
            style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.7) inset, 0 20px 45px -20px rgba(0,0,0,0.28)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-lg inline-flex items-center gap-1.5"><SlidersHorizontal size={16} /> Configure</div>
              <span className="pill text-[9px]" style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}>
                {isChatAgent ? 'CHAT AGENT' : 'VOICE AGENT'}
              </span>
            </div>

            <div className="mt-4">
              <PillTabs options={CONFIG_TABS} value={configTab} onChange={setConfigTab} variant="outline" dense />
            </div>

            <div className="mt-5">
              {configTab === 'greeting' && (
                <>
                  <label className="field-label">{isChatAgent ? 'Welcome message' : 'Greeting (first line on every call)'}</label>
                  <textarea className="input" rows={4} value={draft.greeting} onChange={(e) => set({ greeting: e.target.value })} />
                </>
              )}

              {configTab === 'knowledge' && (
                <>
                  <label className="field-label">Company info</label>
                  <textarea className="input" rows={5} value={draft.kbCompany} onChange={(e) => set({ kbCompany: e.target.value })} placeholder="About your company…" />
                  <label className="field-label mt-3">FAQ pairs</label>
                  <textarea className="input" rows={5} value={draft.kbFaqs} onChange={(e) => set({ kbFaqs: e.target.value })} placeholder={'Q: What are your hours?\nA: Mon–Fri 9–6.'} />
                </>
              )}

              {configTab === 'behavior' && (
                <>
                  <div className="flex items-center justify-between">
                    <label className="field-label mb-0">System prompt</label>
                    <span className="field-help">{draft.prompt.length.toLocaleString()} / 50,000</span>
                  </div>
                  <textarea className="input mt-1.5" rows={8} value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} />
                </>
              )}
            </div>

            <div className="mt-5 pt-4 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--line-2)' }}>
              <span className="text-xs text-mute inline-flex items-center gap-1">
                {isChatAgent ? "Preview — not saved" : dirty ? 'Unsaved' : (<><Check size={12} className="text-lime-600" /> Saved</>)}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost text-sm transition-transform duration-200 hover:scale-105 active:scale-95 disabled:hover:scale-100" disabled={!dirty} onClick={() => setDraft(savedDraft)}>Reset</button>
                <button type="button" className="btn-ghost btn-ghost-accent text-sm transition-transform duration-200 hover:scale-105 active:scale-95 disabled:hover:scale-100" disabled={!dirty || saving || isChatAgent} onClick={save}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {!isChatAgent && (
              <p className="mt-3 text-xs text-mute">
                Voice changes take ~2 min to go live, then restart the test to hear them.{' '}
                <button type="button" className="font-semibold" style={{ color: 'var(--primary)' }} onClick={() => navigate(fullEditorPath)}>
                  Full editor →
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
