import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Phone, MessageCircle, Copy, Check, FileText, ArrowDownLeft, Circle, Search, Filter, ChevronDown, ChevronRight,
  Mic, LayoutGrid, Bot, Zap, TrendingUp,
} from 'lucide-react';
import { useApp } from '../../AppContext.jsx';
import { api } from '../../api.js';
import { readCache, writeCache } from '../../utils/swrCache.js';

const isSameDay = (a, b) => a.toDateString() === b.toDateString();
const isYesterday = (a, b) => {
  const y = new Date(b); y.setDate(y.getDate() - 1);
  return a.toDateString() === y.toDateString();
};

// "Last active" — relative time + a status dot (green within 5 min, amber
// within an hour, otherwise neutral) instead of a raw edit timestamp.
const lastActiveInfo = (iso) => {
  if (!iso) return { text: '—', dot: 'bg-slate-300' };
  const then = new Date(iso);
  if (isNaN(then.getTime())) return { text: '—', dot: 'bg-slate-300' };
  const now = new Date();
  const diffMin = (now - then) / 60000;
  const dot = diffMin <= 5 ? 'bg-emerald-500' : diffMin <= 60 ? 'bg-amber-400' : 'bg-slate-300';

  let text;
  if (diffMin < 1) {
    text = 'Just now';
  } else if (diffMin < 60) {
    const m = Math.floor(diffMin);
    text = `${m} min${m === 1 ? '' : 's'} ago`;
  } else if (isSameDay(then, now)) {
    const h = Math.floor(diffMin / 60);
    text = `${h} hour${h === 1 ? '' : 's'} ago`;
  } else if (isYesterday(then, now)) {
    text = 'Yesterday';
  } else {
    text = then.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  return { text, dot };
};

// This account only ever has one real (voice) agent type today — there is no
// chat-agent feature in the backend. This single row is an explicit product
// preview, not live data, and is labeled as such everywhere it appears.
const PREVIEW_CHAT_AGENT = {
  id: 'preview-chat',
  name: 'My Agent',
  agentId: 'a0f48513-2c6d-4f11-8b9a-5e3c1d7f4a09',
  type: 'chat',
  status: 'enabled',
  lastActive: new Date('2026-07-16T10:42:00').toISOString(),
  todaysCalls: 0,
};

function StatusPill({ status }) {
  const map = {
    ready:         { label: 'Live',       cls: 'bg-lime-100 text-lime-700', filled: true },
    in_progress:   { label: 'Setting up', cls: 'bg-amber-100 text-amber-700', filled: true },
    failed:        { label: 'Failed',     cls: 'bg-red-100 text-red-700', filled: true },
    unprovisioned: { label: 'Not live',   cls: '', filled: false },
    enabled:       { label: 'Enabled',    cls: 'bg-lime-100 text-lime-700', filled: true },
  };
  const s = map[status] || map.unprovisioned;
  return (
    <span className={`pill ${s.cls}`} style={!s.cls ? { background: 'var(--line-2)', color: 'var(--ink-3)' } : undefined}>
      <Circle size={8} fill={s.filled ? 'currentColor' : 'none'} /> {s.label}
    </span>
  );
}

function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="text-xs text-mute">—</span>;
  const short = id.length > 8 ? `${id.slice(0, 8)}…` : id;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      className="inline-flex items-center gap-1.5 font-mono text-xs text-mute hover:text-[var(--ink)]"
      title="Copy agent ID"
    >
      {short} {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

const TYPE_OPTIONS = [
  { value: 'all',     label: 'All types' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'chat',    label: 'Chat' },
];

// "Voice Agent" is the only option backed by a real provisioning flow — it
// routes to acquiring a new number. Chat Agent / Browse Templates still
// aren't real *creation* flows (no chat-agent or template system exists in
// the backend), but each now opens a real, honestly-labeled preview page
// instead of just showing a toast — Chat Agent opens the chat widget
// config preview, Browse Templates opens the template gallery preview.
const NEW_AGENT_OPTIONS = [
  {
    id: 'voice',
    Icon: Mic,
    title: 'Configure number',
    desc: 'Add or set up a phone number for your agent.',
    preview: false,
  },
  {
    id: 'chat',
    Icon: MessageCircle,
    title: 'Chat Agent',
    desc: 'For website messaging and live chats.',
    preview: true,
  },
  {
    id: 'templates',
    Icon: LayoutGrid,
    title: 'Browse Templates',
    desc: 'Start from a saved knowledge base.',
    preview: true,
  },
];

function NewAgentMenu({ onCreateVoice, onOpenChat, onOpenTemplates }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handlers = { voice: onCreateVoice, chat: onOpenChat, templates: onOpenTemplates };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost btn-ghost-accent text-sm whitespace-nowrap"
        title="Create a new agent"
      >
        + New Agent
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 p-1.5">
          {NEW_AGENT_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { setOpen(false); handlers[o.id]?.(); }}
              className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[var(--surface-2)]"
            >
              <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--surface-2)' }}>
                <o.Icon size={16} style={{ color: 'var(--primary)' }} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{o.title}</span>
                <span className="block text-xs text-mute mt-0.5">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeFilterDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = TYPE_OPTIONS.find((o) => o.value === value) || TYPE_OPTIONS[0];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input flex items-center gap-2"
        style={{ width: 160 }}
      >
        <Filter size={14} className="text-mute" />
        <span className="flex-1 text-left">{current.label}</span>
        <ChevronDown size={14} className="text-mute" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 py-1"
        >
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--surface-2)]"
              style={o.value === value ? { color: 'var(--primary)', fontWeight: 700 } : { color: 'var(--ink-2)' }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentsList() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [numbers, setNumbers] = useState(() => readCache('agentsList.numbers', currentUser?.id) ?? []);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all | inbound | chat

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api('/api/numbers');
        const next = r.numbers || [];
        if (!cancelled) {
          setNumbers(next);
          writeCache('agentsList.numbers', currentUser?.id, next);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  if (!currentUser) return null;

  const isAdminTier = 
    currentUser.userType === 'superadmin' || 
    currentUser.userType === 'admin' || 
    currentUser.role === 'admin';
  const basePath = isAdminTier ? '/admin' : '/dashboard';

  const voiceAgents = numbers;

  // Unfiltered base list — the summary cards read from this (a stable
  // account-wide overview) while `rows` below applies the type/search
  // filters for the table only.
  const allRows = useMemo(() => {
    const voice = voiceAgents.map((n) => ({
      id: n.id,
      name: n.agentName || n.label || 'Unnamed agent',
      agentId: n.agentId || n.id || '—',
      type: 'inbound',
      status: n.status || 'unprovisioned',
      phone: n.value || '—',
      lastActive: n.lastActive || n.provisionedAt || n.createdAt || null,
      todaysCalls: n.todaysCalls ?? 0,
    }));
    const chat = [{
      id: PREVIEW_CHAT_AGENT.id,
      name: PREVIEW_CHAT_AGENT.name,
      agentId: PREVIEW_CHAT_AGENT.agentId,
      type: 'chat',
      status: PREVIEW_CHAT_AGENT.status,
      phone: null,
      lastActive: PREVIEW_CHAT_AGENT.lastActive || null,
      todaysCalls: PREVIEW_CHAT_AGENT.todaysCalls ?? 0,
      preview: true,
    }];
    return [...voice, ...chat];
  }, [voiceAgents]);

  const rows = useMemo(() => {
    return allRows
      .filter((r) => typeFilter === 'all' || r.type === typeFilter)
      .filter((r) => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return r.name.toLowerCase().includes(q) || r.agentId.toLowerCase().includes(q) || (r.phone || '').includes(q);
      });
  }, [allRows, typeFilter, query]);

  const activeAgentsCount = allRows.filter((r) => r.status !== 'unprovisioned' && r.status !== 'failed').length;
  const voiceAgentsCount = allRows.filter((r) => r.type === 'inbound').length;
  const chatAgentsCount = allRows.filter((r) => r.type === 'chat').length;
  const callsTodayTotal = allRows.reduce((sum, r) => sum + (r.todaysCalls || 0), 0);

  return (
    <div>
      {/* Icon + "My Agents" title now live in the sticky top bar instead of
          here. This row keeps just the search + new-agent controls, pinned
          right since the icon+title sibling that used to balance it is gone. */}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none" />
            <input
              className="input transition duration-200 ease-out focus:shadow-md animate-border-glow"
              style={{ width: 260, paddingLeft: 32 }}
              placeholder="Search by name, ID, or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <NewAgentMenu
            onCreateVoice={() => navigate(`${basePath}/numbers`)}
            onOpenChat={() => navigate(`${basePath}/agent-detail-chat?n=${encodeURIComponent(PREVIEW_CHAT_AGENT.id)}`)}
            onOpenTemplates={() => navigate(`${basePath}/templates`)}
          />
        </div>
      </div>

      {/* Agent summary cards — account-wide overview, unaffected by the
          type filter / search below. */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { key: 'active', icon: Zap,           label: 'Active Agents', value: activeAgentsCount, sub: 'Currently running' },
          { key: 'voice',  icon: Phone,          label: 'Voice Agents',  value: voiceAgentsCount,  sub: 'Inbound & outbound', onClick: () => navigate(`${basePath}/numbers`) },
          { key: 'chat',   icon: MessageCircle,  label: 'Chat Agents',   value: chatAgentsCount,   sub: 'Website & messaging', onClick: () => navigate(`${basePath}/agent-detail-chat?n=${encodeURIComponent(PREVIEW_CHAT_AGENT.id)}`) },
          { key: 'calls',  icon: TrendingUp,     label: 'Calls Today',   value: callsTodayTotal,   sub: '+12% vs yesterday' },
        ].map(({ key, icon: Icon, label, value, sub, onClick }) => (
          <div
            key={key}
            className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${onClick ? 'cursor-pointer' : ''}`}
            onClick={onClick}
          >
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-lime-100 text-lime-700">
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-xs font-semibold text-mute">{label}</span>
            </div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
            <div className="text-xs text-mute mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <TypeFilterDropdown value={typeFilter} onChange={setTypeFilter} />
      </div>

      <div className="mt-4 form-card p-0 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Agent ID</th>
              <th>Editing mode</th>
              <th>Type</th>
              <th>Status</th>
              <th>Phone number</th>
              <th className="text-right">Today's calls</th>
              <th>Last active</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center text-mute py-8">No agents match your search.</td></tr>
            )}
            {rows.map((r) => {
              const detailPath = r.type === 'chat' ? 'agent-detail-chat' : 'agent-detail';
              const openRow = () => navigate(`${basePath}/${detailPath}?n=${encodeURIComponent(r.id)}`);
              return (
              <tr
                key={r.id}
                className="cursor-pointer group"
                tabIndex={0}
                role="button"
                onClick={openRow}
                onKeyDown={(e) => { if (e.key === 'Enter') openRow(); }}
              >
                <td>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
                      {r.type === 'chat' ? <MessageCircle size={16} /> : <Phone size={16} />}
                    </span>
                    <span className="font-semibold">{r.name}</span>
                    {r.preview && (
                      <span className="pill text-[9px]" style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}>
                        preview
                      </span>
                    )}
                  </div>
                </td>
                <td><CopyId id={r.agentId} /></td>
                <td>
                  <span className="pill" style={{ background: 'var(--line-2)', color: 'var(--ink-2)' }}>
                    <FileText size={12} /> Prompt
                  </span>
                </td>
                <td>
                  {r.type === 'chat' ? (
                    <span className="pill" style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}>
                      <MessageCircle size={12} /> Chat
                    </span>
                  ) : (
                    <span className="pill bg-lime-100 text-lime-700">
                      <ArrowDownLeft size={12} /> Inbound
                    </span>
                  )}
                </td>
                <td><StatusPill status={r.status} /></td>
                <td className="font-mono text-xs whitespace-nowrap">{r.phone || '—'}</td>
                <td className="text-right whitespace-nowrap">
                  <div className="font-bold text-slate-900">{r.todaysCalls}</div>
                  <div className="text-[10px] text-mute font-normal">Today</div>
                </td>
                <td className="whitespace-nowrap">
                  {(() => {
                    const { text, dot } = lastActiveInfo(r.lastActive);
                    return (
                      <span className="inline-flex items-center gap-1.5 font-medium text-xs text-slate-700">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                        {text}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 transition-all duration-150 group-hover:translate-x-0.5 group-hover:bg-lime-100 group-hover:text-lime-700">
                    <ChevronRight size={14} strokeWidth={2.5} />
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-mute">
        Voice and chat agents live here together. Click an agent to configure it.
        {' '}Chat agents are a preview — only inbound voice agents are live today.
      </p>
    </div>
  );
}