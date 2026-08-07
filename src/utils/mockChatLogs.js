// Placeholder chat-session data — this portal doesn't have a website chat
// widget backend yet, so these are static demo rows shaped like a real
// /api/chat-logs response would be (session id, agent, transcript, duration,
// end reason). Swap buildMockChatSessions() for a real API call once that
// endpoint exists; the row UI (ChatLogRow.jsx) already expects this shape.

// Every chat session on this portal is handled by the customer's single
// configured voice/chat agent, so every row shows the same "My Agent" label
// (matching the reference site — no per-row agent rotation).
const AGENT_NAME = 'My Agent';
const END_REASONS = ['hangup', 'timeout', 'completed'];

const MOCK_TRANSCRIPTS = [
  [{ speaker: 'agent', text: "Are you still there? I'm here whenever you're ready." }],
  [
    { speaker: 'caller', text: 'Hi, I wanted to check my order status.' },
    { speaker: 'agent', text: 'Sure — could you share your order ID?' },
  ],
  [
    { speaker: 'caller', text: 'Do you offer refunds?' },
    { speaker: 'agent', text: 'Yes, within 30 days of purchase with a receipt.' },
  ],
  [
    { speaker: 'caller', text: 'What are your business hours?' },
    { speaker: 'agent', text: "We're available 24/7 through this chat." },
  ],
];

// Deterministic pseudo-random (seeded by index) so the mock list doesn't
// jitter between renders/dev reloads.
const rand = (seed) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const hex = (seed) => Math.floor(rand(seed) * 0xffffffff).toString(16).padStart(8, '0');
const uuidish = (i) =>
  `${hex(i * 7 + 1).slice(0, 8)}-${hex(i * 7 + 2).slice(0, 4)}-${hex(i * 7 + 3).slice(0, 4)}` +
  `-${hex(i * 7 + 4).slice(0, 4)}-${hex(i * 7 + 5)}${hex(i * 7 + 6).slice(0, 4)}`;

export const buildMockChatSessions = (count = 24) => Array.from({ length: count }, (_, i) => {
  const start = new Date(Date.now() - (i * 7 + Math.floor(rand(i) * 5)) * 3600 * 1000);
  const hasTranscript = rand(i * 3) > 0.15;
  return {
    id: `chat-${i}`,
    sessionId: uuidish(i),
    startTime: start.toISOString(),
    agentName: AGENT_NAME,
    hasTranscript,
    duration: 5 + Math.floor(rand(i * 11) * 300),
    endReason: END_REASONS[i % END_REASONS.length],
    transcript: hasTranscript ? MOCK_TRANSCRIPTS[i % MOCK_TRANSCRIPTS.length] : [],
  };
});
