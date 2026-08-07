import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, Copy, Check } from 'lucide-react';
import { useApp } from '../../AppContext.jsx';

// Chat agents aren't a real feature yet — no backend table, endpoint, or
// embeddable widget exists. This whole page is an honest, fully-interactive
// preview: every field is editable and the Live preview reacts to it in
// real time, but "Save changes" and the Embed snippet both say plainly that
// nothing is wired up yet, instead of pretending a save actually persisted.
const DEFAULT_CONFIG = {
  name: 'My Agent',
  enabled: true,
  welcome: 'Hi! How can I help you today?',
  systemPrompt: 'You are a helpful customer support assistant. Be concise, friendly, and professional.',
  knowledgeBase: 'ABOUT US\n- What we do:\n- Hours:\n\nFAQ\n- Pricing:\n- Returns:',
  widgetTitle: 'Chat with us',
  accentColor: '#4d7c0f',
  position: 'bottom-right',
  mode: 'popup',
  theme: 'light',
  size: 'small',
  showBranding: true,
  inactivityTimeout: 10,
  inactivityMessage: 'This chat has been closed due to inactivity.',
  maxMessages: 100,
  dailySessionCap: 50,
  allowedOrigins: 'https://voice.kallus.io',
};

const SUB_TABS = [
  { id: 'configure', label: 'Configure' },
  { id: 'embed', label: 'Embed' },
  { id: 'history', label: 'History' },
];

function Section({ title, children }) {
  return (
    <div className="form-card">
      <div className="text-xs font-mono uppercase tracking-wide font-semibold" style={{ color: 'var(--primary)' }}>{title}</div>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export default function ChatAgentDetail() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [subTab, setSubTab] = useState('configure');
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!currentUser) return null;

  const isAdminTier =
    currentUser.userType === 'superadmin'
    || currentUser.userType === 'admin'
    || currentUser.role === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const embedSnippet = `<script src="https://widget.kallus.io/embed.js"
  data-agent="preview-chat"
  data-mode="${cfg.mode}"
  data-position="${cfg.position}"
  data-accent="${cfg.accentColor}"></script>`;

  return (
    <div>
      <Link to={`${basePath}/agents`} className="inline-flex items-center gap-1.5 text-sm text-lime-700 hover:underline">
        <ArrowLeft size={14} /> All agents
      </Link>

      <div className="mt-3">
        <span className="pill" style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}>
          Preview — chat agents aren't live yet, nothing here is saved
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-2)' }}>
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition"
              style={subTab === t.id ? { background: 'var(--primary)', color: '#fff' } : { color: 'var(--ink-2)' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {notice && (
          <span className="pill text-xs" style={{ background: 'var(--ink)', color: '#fff' }}>{notice}</span>
        )}
      </div>

      {subTab === 'configure' && (
        <div
          className="mt-4 grid lg:grid-cols-[1fr_var(--preview-col-w)] gap-6 items-start"
          style={{ '--preview-col-w': cfg.size === 'large' ? '400px' : '320px' }}
        >
          <div className="space-y-6">
            <Section title="Basics">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <Field label="Name">
                    <input className="input" value={cfg.name} onChange={(e) => set({ name: e.target.value })} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium mt-7 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={(e) => set({ enabled: e.target.checked })}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  Enabled
                </label>
              </div>
              <Field label="Welcome message">
                <textarea className="input" rows={3} value={cfg.welcome} onChange={(e) => set({ welcome: e.target.value })} />
              </Field>
            </Section>

            <Section title="Behavior & knowledge">
              <Field label="System prompt">
                <textarea className="input" rows={4} value={cfg.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
              </Field>
              <Field label="Knowledge base">
                <textarea className="input input-mono" rows={6} value={cfg.knowledgeBase} onChange={(e) => set({ knowledgeBase: e.target.value })} />
              </Field>
            </Section>

            <Section title="Widget appearance">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Title">
                  <input className="input" value={cfg.widgetTitle} onChange={(e) => set({ widgetTitle: e.target.value })} />
                </Field>
                <Field label="Accent color">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cfg.accentColor}
                      onChange={(e) => set({ accentColor: e.target.value })}
                      className="w-10 h-10 rounded-lg border cursor-pointer flex-shrink-0"
                      style={{ borderColor: 'var(--line)', padding: 2 }}
                    />
                    <input className="input font-mono text-sm" value={cfg.accentColor} onChange={(e) => set({ accentColor: e.target.value })} />
                  </div>
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Position">
                  <select className="input" value={cfg.position} onChange={(e) => set({ position: e.target.value })}>
                    <option value="bottom-right">bottom-right</option>
                    <option value="bottom-left">bottom-left</option>
                  </select>
                </Field>
                <Field label="Mode">
                  <select className="input" value={cfg.mode} onChange={(e) => set({ mode: e.target.value })}>
                    <option value="popup">popup</option>
                    <option value="inline">inline</option>
                  </select>
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Theme">
                  <select className="input" value={cfg.theme} onChange={(e) => set({ theme: e.target.value })}>
                    <option value="light">light</option>
                    <option value="dark">dark</option>
                  </select>
                </Field>
                <Field label="Size">
                  <select className="input" value={cfg.size} onChange={(e) => set({ size: e.target.value })}>
                    <option value="small">small</option>
                    <option value="large">large</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.showBranding}
                  onChange={(e) => set({ showBranding: e.target.checked })}
                  style={{ accentColor: 'var(--primary)' }}
                />
                Show "powered by" branding
              </label>
            </Section>

            <Section title="Limits & security">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Inactivity timeout (seconds)">
                  <input type="number" className="input" value={cfg.inactivityTimeout} onChange={(e) => set({ inactivityTimeout: e.target.value })} />
                </Field>
                <Field label="Inactivity message">
                  <input className="input" value={cfg.inactivityMessage} onChange={(e) => set({ inactivityMessage: e.target.value })} />
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Max messages / session">
                  <input type="number" className="input" value={cfg.maxMessages} onChange={(e) => set({ maxMessages: e.target.value })} />
                </Field>
                <Field label="Daily session cap">
                  <input type="number" className="input" value={cfg.dailySessionCap} onChange={(e) => set({ dailySessionCap: e.target.value })} />
                </Field>
              </div>
              <Field label="Allowed origins" help="One per line — the sites allowed to embed this widget.">
                <textarea className="input font-mono text-sm" rows={2} value={cfg.allowedOrigins} onChange={(e) => set({ allowedOrigins: e.target.value })} />
              </Field>
            </Section>

            <button
              type="button"
              className="btn-ghost btn-ghost-accent"
              onClick={() => setNotice("Chat agents are a preview — saving isn't wired up yet.")}
            >
              Save changes
            </button>
          </div>

          {/* === Live preview ============================================ */}
          <div className="lg:sticky lg:top-20">
            <div className="text-xs font-mono uppercase tracking-wide font-semibold" style={{ color: 'var(--primary)' }}>Live preview</div>
            <div
              className="mt-3 rounded-2xl border shadow-lg overflow-hidden transition-all duration-200 ease-out"
              style={{ borderColor: 'var(--line)', background: cfg.theme === 'dark' ? '#1a2030' : '#fff', width: '100%' }}
            >
              <div className={cfg.size === 'large' ? 'px-5 py-4' : 'px-4 py-3'} style={{ background: cfg.accentColor }}>
                <div className={`text-white font-semibold ${cfg.size === 'large' ? 'text-base' : 'text-sm'}`}>{cfg.widgetTitle || 'Chat with us'}</div>
                <div className="text-white/80 text-xs flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-lime-300 inline-block" /> Online
                </div>
              </div>
              <div className={`space-y-2 ${cfg.size === 'large' ? 'p-4 min-h-[220px]' : 'p-3 min-h-[160px]'}`} style={{ background: cfg.theme === 'dark' ? '#232a3d' : '#f6f8f1' }}>
                <div
                  className={`max-w-[85%] rounded-xl rounded-tl-sm ${cfg.size === 'large' ? 'px-4 py-2.5 text-[15px]' : 'px-3 py-2 text-sm'}`}
                  style={{ background: cfg.theme === 'dark' ? '#333d57' : '#fff', color: cfg.theme === 'dark' ? '#e5e9f5' : 'var(--ink)' }}
                >
                  {cfg.welcome || 'Hi! How can I help you today?'}
                </div>
                <div
                  className={`max-w-[85%] ml-auto rounded-xl rounded-tr-sm text-white ${cfg.size === 'large' ? 'px-4 py-2.5 text-[15px]' : 'px-3 py-2 text-sm'}`}
                  style={{ background: cfg.accentColor }}
                >
                  Hi, I have a question
                </div>
              </div>
              <div className={`border-t flex items-center gap-2 ${cfg.size === 'large' ? 'p-3' : 'p-2.5'}`} style={{ borderColor: 'var(--line-2)', background: cfg.theme === 'dark' ? '#1a2030' : '#fff' }}>
                <div className={`flex-1 rounded-full ${cfg.size === 'large' ? 'px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs'}`} style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}>
                  Type a message…
                </div>
                <div className={`rounded-full flex items-center justify-center flex-shrink-0 ${cfg.size === 'large' ? 'w-9 h-9' : 'w-8 h-8'}`} style={{ background: cfg.accentColor }}>
                  <Send size={cfg.size === 'large' ? 15 : 13} color="#fff" />
                </div>
              </div>
              {cfg.showBranding && (
                <div className="text-center text-[10px] py-1.5" style={{ color: 'var(--ink-3)', background: cfg.theme === 'dark' ? '#1a2030' : '#fff' }}>
                  Powered by kallus.io
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-mute">
              {cfg.mode === 'popup' ? 'Popup' : 'Inline'} — a bubble in the {cfg.position.replace('-', ' ')} corner ({cfg.size}).
            </p>
          </div>
        </div>
      )}

      {subTab === 'embed' && (
        <div className="mt-4 form-card max-w-2xl">
          <div className="text-xs font-mono uppercase tracking-wide font-semibold" style={{ color: 'var(--primary)' }}>Embed snippet</div>
          <p className="text-sm text-mute mt-1">
            Paste this on any page listed in Allowed origins. Reflects the settings on the Configure tab.
          </p>
          <div className="mt-4 relative">
            <pre className="input font-mono text-xs whitespace-pre-wrap leading-relaxed">{embedSnippet}</pre>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(embedSnippet).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }).catch(() => {});
              }}
              className="absolute top-2 right-2 btn-ghost text-xs py-1 px-2 inline-flex items-center gap-1"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-3 field-help">
            Illustrative only — chat agents are a preview, so this snippet isn't backed by a live widget yet.
          </div>
        </div>
      )}

      {subTab === 'history' && (
        <div className="mt-4 form-card text-center py-12 text-mute">
          No chat sessions yet — chat agents are a preview, so there's no live history to show.
        </div>
      )}
    </div>
  );
}
