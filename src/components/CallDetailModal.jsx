import { useEffect, useState } from 'react';
import { api, getToken } from '../api.js';

// Strip "sip:+1234@host;..." → "+1234".
const fmtNumber = (s) => {
  if (!s) return '—';
  const m = String(s).match(/sip:([^@;]+)/);
  return m ? m[1] : s;
};

const fmtDuration = (s) => {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
};

const fmtTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  return isNaN(d.getTime()) ? String(t) : d.toLocaleString('en-US');
};

const fmtDirection = (dir) => {
  if (!dir) return '—';
  if (dir === 'trunking-originating' || dir === 'inbound') return 'Inbound';
  if (dir === 'outbound-api' || dir === 'outbound-dial') return 'Outbound';
  return String(dir).replace(/-/g, ' ');
};

const inr = (n) => '$' + Number(n || 0).toLocaleString('en-US');

// =============================================================================
// CallDetailModal — unified floating card showing recording + AI summary +
// transcript for a single call. Opens from any call-list row (Call history,
// Recordings, etc.). Audio + transcript + summary load lazily.
// =============================================================================
export default function CallDetailModal({ call, onClose }) {
  const [summary, setSummary]       = useState(null);
  const [summaryErr, setSummaryErr] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [transcript, setTranscript]       = useState(null);
  const [transcriptErr, setTranscriptErr] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(true);

  // Meeting info — from MCP get_call_meeting. May be a confirmed booking
  // (source: "booking") or a verbal mention extracted from the summary
  // (source: "summary"). null means no meeting was discussed.
  const [meeting, setMeeting]               = useState(null);
  const [meetingLoading, setMeetingLoading] = useState(true);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Fetch summary + transcript in parallel when the modal opens.
  useEffect(() => {
    if (!call?.callId) return;
    let cancelled = false;

    (async () => {
      try {
        const r = await api(`/api/recordings/${encodeURIComponent(call.callId)}/summary`);
        if (!cancelled) setSummary(r);
      } catch (e) {
        if (!cancelled) setSummaryErr(e.message || 'Failed to load summary');
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();

    (async () => {
      try {
        const r = await api(`/api/recordings/${encodeURIComponent(call.callId)}/transcript`);
        if (!cancelled) setTranscript(r);
      } catch (e) {
        if (!cancelled) setTranscriptErr(e.message || 'Failed to load transcript');
      } finally {
        if (!cancelled) setTranscriptLoading(false);
      }
    })();

    (async () => {
      try {
        const r = await api(`/api/recordings/${encodeURIComponent(call.callId)}/meeting`);
        if (!cancelled) setMeeting(r);
      } catch {
        // Soft-fail — a missing meeting is the common case, not an error worth surfacing.
        if (!cancelled) setMeeting(null);
      } finally {
        if (!cancelled) setMeetingLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [call?.callId]);

  if (!call) return null;
  const ai = summary?.aiSummary;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal card uses fixed max-height + internal scroll so the header
          stays anchored without being sticky. Native <audio> creates its own
          stacking context which clips through a sticky header — the
          flex-column + overflow-y-auto pattern avoids that entirely. */}
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* === HEADER (no longer sticky — flex-shrink-0 keeps it pinned naturally) === */}
        <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="pill bg-slate-100 text-slate-700 text-xs">
                  {fmtDirection(call.direction)}
                </span>
                {call.hasTranscript && (
                  <span className="pill bg-lime-100 text-lime-700 text-xs">📝 transcript</span>
                )}
                <span className="text-mute">{fmtTime(call.startTime)}</span>
              </div>
              <div className="mt-2 font-mono text-sm text-slate-900 dark:text-slate-100 truncate">
                {fmtNumber(call.from)} <span className="text-mute">→</span> {fmtNumber(call.to)}
              </div>
              <div className="mt-1 text-xs text-mute">
                {fmtDuration(call.duration)}
                {call.price ? ` · ${inr(call.price)}` : ''}
                {call.agentName ? ` · ${call.agentName}` : ''}
                {call.status ? ` · ${call.status}` : ''}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* === SCROLLABLE CONTENT ============================================
            Everything inside this wrapper scrolls; the header above stays put. */}
        <div className="flex-1 overflow-y-auto">

        {/* === RECORDING (audio player) ===================================== */}
        {call.audioUrl ? (
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">🎙 Recording</div>
            <div className="flex items-center gap-3 flex-wrap">
              <audio
                controls
                preload="metadata"
                className="w-full max-w-xl h-9"
                src={`${call.audioUrl}?token=${encodeURIComponent(getToken())}`}
              >
                Your browser can&apos;t play this recording.
              </audio>
              <div className="flex items-center gap-3 text-xs text-mute">
                {call.audioSize && <span>{(call.audioSize / 1024 / 1024).toFixed(2)} MB</span>}
                <a
                  href={`${call.audioUrl}?token=${encodeURIComponent(getToken())}&download=1`}
                  download={call.audioFilename || `recording-${call.callId}.mp4`}
                  className="text-lime-600 hover:underline"
                >
                  ⬇ Download
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 text-xs text-mute">
            No recording available for this call.
          </div>
        )}

        {/* === AI SUMMARY =================================================== */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider">✨ AI summary</div>
            {ai?.sentiment && (
              <span className={`pill text-xs ${
                ai.sentiment === 'positive' ? 'bg-lime-100 text-lime-700'
                : ai.sentiment === 'negative' ? 'bg-red-100 text-red-700'
                : 'bg-slate-100 text-slate-700'
              }`}>
                {ai.sentiment}
              </span>
            )}
          </div>

          {summaryLoading && (
            <div className="text-xs text-mute">Generating summary…</div>
          )}
          {summaryErr && (
            <div className="text-xs text-red-500">⚠ {summaryErr}</div>
          )}
          {!summaryLoading && !summaryErr && !ai && (
            <div className="text-xs text-mute">Summary not available for this call.</div>
          )}
          {ai?.error && (
            <div className="text-xs text-amber-600">⚠ {ai.error}</div>
          )}

          {ai && !ai.error && (
            <div className="space-y-3 text-sm">
              {ai.gist && (
                <p className="text-slate-900 dark:text-slate-100 font-medium leading-relaxed">
                  {ai.gist}
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                {ai.intent && (
                  <div>
                    <div className="text-mute font-semibold uppercase tracking-wider mb-0.5">Caller intent</div>
                    <div className="text-slate-700 dark:text-slate-300">{ai.intent}</div>
                  </div>
                )}
                {ai.outcome && (
                  <div>
                    <div className="text-mute font-semibold uppercase tracking-wider mb-0.5">Outcome</div>
                    <div className="text-slate-700 dark:text-slate-300">{ai.outcome}</div>
                  </div>
                )}
              </div>
              {Array.isArray(ai.topics) && ai.topics.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ai.topics.map((t, i) => (
                    <span key={i} className="pill bg-lime-100 text-lime-700 text-xs">{t}</span>
                  ))}
                </div>
              )}
              {Array.isArray(ai.actionItems) && ai.actionItems.length > 0 && (
                <div>
                  <div className="text-xs text-mute font-semibold uppercase tracking-wider mb-1">Follow-ups</div>
                  <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
                    {ai.actionItems.map((a, i) => (
                      <li key={i} className="flex gap-2"><span className="text-amber-500 shrink-0">→</span><span>{a}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* === MEETING ======================================================
            Two sources collapse into one card:
              - source: "booking" → real calendar event (schedule_meeting fired)
              - source: "summary" → verbal mention extracted by AI from the summary
            We only render when there's actually something to show, so calls
            with no meeting discussion stay clean. */}
        {!meetingLoading && meeting?.hasMeeting && meeting?.meeting && (() => {
          const m = meeting.meeting;
          const isBooking = meeting.source === 'booking';
          return (
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-mute uppercase tracking-wider">📅 Meeting</div>
                <span className={`pill text-xs ${
                  isBooking
                    ? 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                }`}>
                  {isBooking ? '✓ Booked' : '~ Mentioned'}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                {m.name && (
                  <div className="font-medium text-slate-900 dark:text-slate-100">{m.name}</div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
                  {m.email && <span>✉ <a href={`mailto:${m.email}`} className="text-lime-600 dark:text-lime-400 hover:underline">{m.email}</a></span>}
                  {m.phone && <span>📞 <a href={`tel:${m.phone}`} className="text-lime-600 dark:text-lime-400 hover:underline font-mono">{m.phone}</a></span>}
                </div>

                {/* Booking-specific (ISO time, calendar link, status) */}
                {isBooking && (
                  <>
                    {(m.start || m.end) && (
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        <span className="text-mute">Time: </span>
                        {m.start ? new Date(m.start).toLocaleString('en-US') : '—'}
                        {m.end ? ` → ${new Date(m.end).toLocaleString('en-US')}` : ''}
                        {m.duration_minutes ? ` · ${m.duration_minutes}m` : ''}
                      </div>
                    )}
                    {m.calendar_link && (
                      <a href={m.calendar_link} target="_blank" rel="noreferrer" className="inline-block text-xs text-lime-600 dark:text-lime-400 hover:underline">
                        Open in Google Calendar ↗
                      </a>
                    )}
                  </>
                )}

                {/* Summary-derived (natural-language date, service, free-form note) */}
                {!isBooking && (
                  <>
                    {m.appointment_date && (
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        <span className="text-mute">When: </span>{m.appointment_date}
                      </div>
                    )}
                    {m.service_needed && (
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        <span className="text-mute">For: </span>{m.service_needed}
                      </div>
                    )}
                    {m.note && (
                      <div className="text-[11px] text-mute italic mt-1">{m.note}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* === TRANSCRIPT =================================================== */}
        <div className="px-5 py-4">
          <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">📝 Transcript</div>
          {transcriptLoading && (
            <div className="text-xs text-mute">Loading transcript…</div>
          )}
          {transcriptErr && (
            <div className="text-xs text-red-500">⚠ {transcriptErr}</div>
          )}
          {!transcriptLoading && !transcriptErr && (!transcript?.messages || transcript.messages.length === 0) && (
            <div className="text-xs text-mute">No transcript for this call.</div>
          )}
          {transcript?.messages?.length > 0 && (
            <ol className="space-y-2 text-sm max-h-[400px] overflow-y-auto pr-2">
              {transcript.messages.map((m, i) => {
                const speaker = m.speaker || m.role || 'speaker';
                const isAgent = /agent|assistant|ai|bot/i.test(speaker);
                return (
                  <li key={i} className="flex gap-3">
                    <span className={`shrink-0 text-[10px] uppercase tracking-wider font-semibold mt-1 w-12 ${
                      isAgent ? 'text-lime-600' : 'text-lime-600'
                    }`}>
                      {isAgent ? 'Agent' : 'Caller'}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">{m.text || m.content || ''}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        </div> {/* end scrollable content wrapper */}
      </div>
    </div>
  );
}
