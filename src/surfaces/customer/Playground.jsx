import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, MessageCircle, ChevronDown, Phone, SlidersHorizontal,
  Send, Check,
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

const CONFIG_TABS = [
  { id: 'behavior',  label: 'Behavior' },
  { id: 'greeting',  label: 'Greeting' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'voice',     label: 'Voice' },
];

function AgentPicker({ agents, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const current = agents.find((a) => a.id === selectedId) || agents[0];
  if (!current) return null;
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center gap-2.5"
        style={{ minWidth: 220 }}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
          style={{ background: gradientFor(current.id) }}
        >
          {(current.agentName || '?')[0].toUpperCase()}
        </span>
        <span className="flex-1 text-left min-w-0">
          <span className="block font-semibold text-sm truncate">{current.agentName}</span>
          <span className="block text-xs text-mute truncate">{current.type === 'chat' ? 'Chat agent' : current.value}</span>
        </span>
        <ChevronDown size={14} className="text-mute flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 py-1">
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
  const [configTab, setConfigTab] = useState('behavior');
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
  useEffect(() => {
    if (!loaded && !hadCachedNumbersRef.current) return;
    const effectiveMode = mode === 'voice' && voiceAgents.length === 0 ? 'chat' : mode;
    if (effectiveMode !== mode) setMode(effectiveMode);
    const wantType = effectiveMode === 'chat' ? 'chat' : 'voice';
    const stillValid = agents.find((a) => a.id === selectedId && a.type === wantType);
    if (!stillValid) setSelectedId(agents.find((a) => a.type === wantType)?.id || null);
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
  if (!draft) {
    return (
      <div>
        {/* Icon + "Playground" title now live in the sticky top bar instead of
            here — matches the main return path below. */}
        <p className="font-semibold text-base tracking-wide" style={{ color: 'var(--ink-2)' }}>Test your agents and tune them right here — no page hopping. Free, no plan minutes used.</p>
        {!loaded ? (
          <div className="mt-8 form-card text-center py-12 text-mute">Loading…</div>
        ) : (
          <div className="mt-8 form-card text-center py-12 text-mute">
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

  return (
    <div>
      {/* Icon + "Playground" title now live in the sticky top bar instead of here. */}
      <p className="font-semibold text-base tracking-wide" style={{ color: 'var(--ink-2)' }}>Test your agents and tune them right here — no page hopping. Free, no plan minutes used.</p>

      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
            {[{ id: 'voice', label: 'Voice', Icon: Mic }, { id: 'chat', label: 'Chat', Icon: MessageCircle }].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition inline-flex items-center gap-1.5"
                style={mode === m.id ? { background: '#fff', color: 'var(--ink)', boxShadow: '0 1px 2px rgba(15,23,42,.08)' } : { color: 'var(--ink-3)' }}
              >
                <m.Icon size={14} /> {m.label}
              </button>
            ))}
          </div>
          <AgentPicker agents={agents.filter((a) => a.type === mode)} selectedId={selectedId} onChange={setSelectedId} />
        </div>
        <button type="button" className="btn-ghost btn-ghost-accent text-sm inline-flex items-center gap-1.5" onClick={() => setConfigOpen((v) => !v)}>
          <SlidersHorizontal size={14} /> {configOpen ? 'Hide config' : 'Show config'}
        </button>
      </div>

      {/* lg:min-h ensures the grid row is always taller than the test panel
          (which can otherwise end up taller than a short Configure tab like
          Behavior), since a sticky item can only stay pinned while there's
          leftover room in its own row — without this, sticky silently does
          nothing whenever the left column happens to be the taller one. */}
      <div className={`mt-4 grid gap-6 items-start ${configOpen ? 'lg:grid-cols-[1fr_380px] lg:min-h-[820px]' : ''}`}>
        {/* === Test panel ================================================ */}
        {/* Sticky on desktop so it stays visible while the taller Configure
            panel next to it scrolls — no need to scroll back up to reach
            Start voice test / the transcript after editing config. */}
        <div className="form-card lg:sticky lg:top-20">
          <div className="flex items-center gap-2.5">
            <span
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ background: gradientFor(selected.id) }}
            >
              {(selected.agentName || '?')[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{selected.agentName}</div>
              <div className="text-xs text-mute truncate">
                {isChatAgent ? 'Chat agent' : selected.value}{!isChatAgent && draft.voice ? ` · ${draft.voice}` : ''}
              </div>
            </div>
          </div>

          {mode === 'voice' ? (
            <div className="mt-3 flex flex-col items-center text-center py-2">
              {/* Live Voice Status — listening/processing are brief
                  simulated phases right after Start; speaking/error track
                  the real playingVoice/previewError signals from
                  useVoicePreview, so those two always take priority. */}
              <div
                className="w-full max-w-xs rounded-xl border bg-white px-4 py-2.5 text-left transition-all duration-300"
                style={{ borderColor: 'var(--line)' }}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${VOICE_STATUS_CONFIG[voiceStatus].dot}`} />
                  <span className="text-sm font-semibold text-slate-900">{VOICE_STATUS_CONFIG[voiceStatus].title}</span>
                </div>
                <div className="mt-1 text-xs text-mute space-y-0.5">
                  {voiceStatus === 'ready' && (
                    <>
                      <div>Microphone connected</div>
                      <div>Voice: {draft.voice}</div>
                    </>
                  )}
                  {voiceStatus === 'listening' && <div>Waiting for user input</div>}
                  {voiceStatus === 'processing' && <div>Generating response</div>}
                  {voiceStatus === 'speaking' && <div>AI is responding</div>}
                  {voiceStatus === 'error' && <div>{speechError || previewError || 'Please connect your microphone.'}</div>}
                </div>
                {voiceStatus !== 'ready' && (
                  <div className="mt-1.5 pt-1.5 border-t text-[11px] text-mute space-y-0.5" style={{ borderColor: 'var(--line-2)' }}>
                    {(voiceStatus === 'processing' || voiceStatus === 'speaking') && <div>Latency: 220 ms</div>}
                    {voiceStatus === 'speaking' && <div>Response time: 1.3 s</div>}
                    {voiceStatus !== 'error' && <div>Session duration: {fmtSessionDuration(sessionElapsedMs)}</div>}
                  </div>
                )}
              </div>

              <div className="relative w-20 h-20 rounded-full flex items-center justify-center mt-3" style={{ background: 'var(--surface-tint)' }}>
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg ${testing ? 'animate-pulse' : ''}`}
                  style={{ background: gradientFor(selected.id) }}
                >
                  {(selected.agentName || '?')[0].toUpperCase()}
                </div>
              </div>

              {/* Live Conversation transcript — simulated (no live
                  speech-to-text pipeline yet), appended progressively so it
                  reads like a real conversation while the voice sample plays. */}
              <div className="mt-3 w-full max-w-sm text-left rounded-xl border bg-white overflow-hidden" style={{ borderColor: 'var(--line)' }}>
                <div className="px-3 py-1.5 border-b text-xs font-semibold text-slate-900" style={{ borderColor: 'var(--line)' }}>
                  Live Conversation
                </div>
                <div ref={transcriptScrollRef} className="p-2.5 space-y-2 overflow-y-auto" style={{ height: 160 }}>
                  {transcript.length === 0 ? (
                    <p className="text-xs text-mute">
                      Your conversation transcript will appear here once the voice test begins.
                    </p>
                  ) : (
                    transcript.map((m, i) => (
                      <div key={i} className={`animate-fade-up flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] ${m.from === 'user' ? 'text-right' : 'text-left'}`}>
                          <div className="text-[10px] text-mute mb-1">
                            {m.from === 'user' ? 'User' : 'Agent'} · {m.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </div>
                          <div
                            className={`inline-block rounded-xl px-3 py-2 text-sm text-left ${
                              m.from === 'user'
                                ? 'bg-slate-100 text-slate-900 rounded-tr-sm'
                                : 'bg-lime-50 text-slate-900 rounded-tl-sm'
                            }`}
                          >
                            {m.text}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <button
                type="button"
                className="btn-ghost btn-ghost-accent mt-3 inline-flex items-center gap-2"
                onClick={isListening ? stopSpeechRecognition : startVoiceTest}
                disabled={!draft.voice}
              >
                <Phone size={15} /> {isListening ? 'Stop listening' : testing ? 'Playing…' : 'Start voice test'}
              </button>
              <p className="mt-2 text-xs text-mute max-w-xs">
                {isListening
                  ? 'Listening now — speak after the greeting to add your words to the transcript.'
                  : 'Plays a sample of ' + draft.voice + '\'s voice and transcribes your microphone in supported browsers.'}
              </p>
              {/* Space is always reserved (not just when an error exists) so
                  the panel's total height stays constant whether or not
                  this line is showing — an error appearing/disappearing
                  used to change the panel's height, which (since both grid
                  columns share one row) could make it taller than the
                  Configure panel and eliminate the room sticky needs. */}
              <p className="mt-1 text-xs text-red-600 min-h-[1em]">{speechError || previewError || ' '}</p>
            </div>
          ) : (
            <div className="mt-5">
              <div className="min-h-[220px] max-h-[320px] overflow-y-auto rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                <div className="max-w-[85%] rounded-xl rounded-tl-sm px-3 py-2 text-sm bg-white" style={{ color: 'var(--ink)' }}>
                  {draft.greeting || 'Hi! How can I help you today?'}
                </div>
                {chatLog.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.from === 'user' ? 'ml-auto rounded-tr-sm text-white' : 'rounded-tl-sm bg-white'}`}
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
                  <div className="max-w-[85%] rounded-xl rounded-tl-sm px-3 py-2 text-sm bg-white text-mute italic">
                    Thinking…
                  </div>
                )}
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
                <button type="button" className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50" style={{ background: 'var(--primary)' }} onClick={sendChatMessage} disabled={chatBusy || !chatInput.trim()}>
                  <Send size={15} color="#fff" />
                </button>
              </div>
              <p className="mt-2 text-xs text-mute">Free, no plan minutes used.</p>
            </div>
          )}
        </div>

        {/* === Configure panel =========================================== */}
        {configOpen && (
          <div className="form-card lg:sticky lg:top-20">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold inline-flex items-center gap-1.5"><SlidersHorizontal size={15} /> Configure</div>
              <span className="pill text-[9px]" style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}>
                {isChatAgent ? 'CHAT AGENT' : 'VOICE AGENT'}
              </span>
            </div>

            <div className="mt-3 flex border-b" style={{ borderColor: 'var(--line-2)' }}>
              {CONFIG_TABS.filter((t) => !(isChatAgent && t.id === 'voice')).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setConfigTab(t.id)}
                  className="flex-1 py-2.5 text-xs font-semibold border-b-2"
                  style={configTab === t.id ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : { borderColor: 'transparent', color: 'var(--ink-3)' }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-4">
              {configTab === 'behavior' && (
                <>
                  <label className="field-label">System prompt</label>
                  <textarea className="input" rows={10} value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} />
                  <div className="field-help">{draft.prompt.length.toLocaleString()} / 50,000</div>
                </>
              )}
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
              {configTab === 'voice' && !isChatAgent && (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {VOICES.map((v) => {
                    const sel = draft.voice === v.value;
                    return (
                      <button
                        key={v.value}
                        type="button"
                        onClick={() => set({ voice: v.value })}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left"
                        style={sel ? { background: 'var(--surface-tint)' } : undefined}
                      >
                        <span>
                          <span className="block text-sm font-semibold">{v.label}</span>
                          <span className="block text-xs text-mute">{v.desc}</span>
                        </span>
                        {sel && <Check size={14} style={{ color: 'var(--primary)' }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--line-2)' }}>
              <span className="text-xs text-mute inline-flex items-center gap-1">
                {isChatAgent ? "Preview — not saved" : dirty ? 'Unsaved' : (<><Check size={12} className="text-lime-600" /> Saved</>)}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost text-sm" disabled={!dirty} onClick={() => setDraft(savedDraft)}>Reset</button>
                <button type="button" className="btn-ghost btn-ghost-accent text-sm" disabled={!dirty || saving || isChatAgent} onClick={save}>
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
