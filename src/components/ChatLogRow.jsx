import { MessagesSquare } from 'lucide-react';

const fmtDuration = (s) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
};

const fmtTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  return isNaN(d.getTime()) ? String(t) : d.toLocaleString();
};

// One row in the Chat Logs list — mirrors the Call Logs row layout (time,
// badges, right-aligned meta) but for a text chat session: session id
// instead of a from/to number pair, and no recording/audio player since
// chat sessions are text-only. Only the chevron toggles the row — the rest
// of the row is not a click target.
// Matches the reference site's rounder heading font (already loaded in
// index.css for h1-h6) rather than the app body's default Inter.
const REF_FONT = { fontFamily: "'Outfit', 'Manrope', sans-serif" };

export default function ChatLogRow({ session, open, onToggle }) {
  const s = session;
  return (
    <div className="form-card !p-4" style={REF_FONT}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex items-start gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="shrink-0 mt-0.5 text-mute hover:text-slate-900 transition leading-none"
          >
            {open ? '⌄' : '›'}
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-mute">{fmtTime(s.startTime)}</span>
              <span className="pill bg-white text-[#32CD32] border border-black text-xs font-semibold">
                <MessagesSquare className="w-3.5 h-3.5 shrink-0" />
                {s.agentName}
              </span>
              {s.hasTranscript && (
                <span className="pill bg-[#3a5a0c] text-white text-xs font-semibold">Transcript available</span>
              )}
            </div>
            <div className="mt-2 font-mono text-xs text-mute break-all">{s.sessionId}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-slate-900 font-medium">{fmtDuration(s.duration)}</span>
          <span className="px-2.5 py-1 rounded-md border border-red-200 bg-red-50 text-xs font-medium text-red-700">
            hang up
          </span>
        </div>
      </div>

      {open && (
        <div className="mt-4 rounded-[28px] border border-white/30 bg-gradient-to-br from-[#ffb773] via-[#ff8fb3] to-[#ff5f9d] p-4 shadow-[0_30px_90px_-50px_rgba(255,95,157,0.65)]">
          <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">Transcript</div>
          {s.transcript.length === 0 ? (
            <div className="text-xs text-mute">Transcript is empty.</div>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {s.transcript.map((m, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold mt-1 text-teal-600">
                    {m.speaker === 'agent' ? 'Agent' : 'Caller'}
                  </span>
                  <span className="text-slate-700">{m.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}