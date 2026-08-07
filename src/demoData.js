export const DEMO_USER = {
  id: 'demo-user',
  name: 'Demo User',
  company: 'Demo Company',
  username: 'demo',
  email: 'demo@kallus.io',
  phone: '9876543210',
  role: 'customer',
  userType: 'user',
  resellerPortal: null,
  resellerId: null,
  kyc: { address: '', location: '' },
  plan: {
    label: 'Demo Plan',
    amount: 0,
    min: 1200,
    rate: 0,
    agents: 3,
    cycle: 'monthly',
    activatedAt: null,
    expiresAt: null,
  },
  number: {
    value: '+1 555 0100',
    loc: 'US',
    price: 5,
  },
  voice: 'Kore',
  language: 'en-US',
  agentName: 'Demo Agent',
  greeting: 'Hello, how can I help you today?',
  prompt: 'You are a helpful voice assistant for demos.',
  kbCompany: 'Demo Company',
  kbFaqs: 'Demo FAQs',
  minutesUsed: 320,
  createdAt: '2025-01-01T00:00:00.000Z',
  twilioSid: null,
  walletMinutes: 250,
  walletUsd: 18,
  lowBalanceThreshold: 20,
  autoTopupEnabled: false,
  autoTopupPackMin: 100,
  autoTopupPackUsd: 0,
  paymentMethod: null,
  provisioning: {
    status: 'live',
    error: null,
    livekitTrunkId: null,
    livekitDispatchId: null,
    livekitRoomName: null,
    agentId: null,
    agentSlug: null,
    provisionedAt: null,
  },
};

const demoStats = {
  minutesUsedAllTime: 320,
  minutesUsedThisMonth: 54,
  answeredCalls: 243,
  missedCalls: 7,
  totalBookings: 18,
};

const demoWallet = {
  walletMinutes: 250,
  walletUsd: 18,
  lowBalanceThreshold: 20,
  autoTopupEnabled: false,
  autoTopupPackMin: 100,
  autoTopupPackUsd: 0,
};

const demoNumbers = [
  {
    id: 'num-demo-1',
    agentId: 'a0f48513-1a2b-4c3d-9e8f-7b6c5d4a3f21',
    agentName: 'Demo Agent',
    label: 'Front desk line',
    status: 'ready',
    value: '+1 555 0100',
    loc: 'US',
    price: 5,
    lastActive: '2026-08-06T09:15:00.000Z',
    provisionedAt: '2026-01-05T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    todaysCalls: 12,
    nextRentalAt: '2026-10-01T00:00:00.000Z',
  },
];

const demoChartData = {
  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  values: [8, 11, 9, 13, 10, 14, 12],
};

const demoMcpData = {
  health: 'healthy',
  configured: true,
  demo: true,
};

// No real backend runs in demo mode, so the signup-OTP flow is simulated
// here with a fixed code (nothing is actually emailed) — the frontend shows
// it inline via `devOtp` so the flow is still genuinely testable by hand.
const DEMO_OTP = '123456';
let demoPendingSignup = null;

export function getDemoResponse(path, { method = 'GET', body } = {}) {
  const normalizedPath = path.split('?')[0];

  if (path === '/api/signin') {
    return { token: 'demo-token', user: DEMO_USER };
  }

  if (path === '/api/auth/send-otp') {
    demoPendingSignup = {
      name: body?.name || 'Demo User',
      company: body?.company || '',
      email: body?.email || DEMO_USER.email,
    };
    return { ok: true, email: demoPendingSignup.email, expiresInSeconds: 600, devOtp: DEMO_OTP };
  }

  if (path === '/api/auth/verify-otp') {
    const pending = demoPendingSignup || { name: DEMO_USER.name, company: DEMO_USER.company, email: body?.email || DEMO_USER.email };
    demoPendingSignup = null;
    return {
      token: 'demo-token',
      user: { ...DEMO_USER, name: pending.name, company: pending.company || DEMO_USER.company, email: pending.email },
    };
  }

  if (path === '/api/auth/resend-otp') {
    return { ok: true, expiresInSeconds: 600, devOtp: DEMO_OTP };
  }

  if (path === '/api/signout' || path === '/api/session/ping') {
    return { ok: true, demo: true };
  }

  if (path === '/api/me') {
    return method === 'PATCH'
      ? { user: { ...DEMO_USER, ...body } }
      : { user: DEMO_USER };
  }

  if (normalizedPath === '/api/twilio/stats') {
    return demoStats;
  }

  if (normalizedPath === '/api/wallet') {
    return { wallet: demoWallet };
  }

  if (normalizedPath === '/api/wallet/topup') {
    return {
      charged: {
        minutes: 83,
        amountUsd: 1000,
        descriptor: 'Demo top-up',
      },
    };
  }

  if (normalizedPath === '/api/numbers') {
    return { numbers: demoNumbers };
  }

  if (normalizedPath === '/api/mcp/call-statistics') {
    return { data: demoChartData };
  }

  if (normalizedPath === '/api/mcp/sentiment') {
    return { data: { positive: 82, neutral: 12, negative: 6 } };
  }

  if (normalizedPath === '/api/mcp/call-volume') {
    return { data: demoChartData };
  }

  if (normalizedPath === '/api/mcp/system-health' || normalizedPath === '/api/mcp/status') {
    return { data: demoMcpData, configured: true, demo: true };
  }

  if (normalizedPath === '/api/mcp/service-status') {
    return { data: [{ name: 'Demo MCP', status: 'healthy' }] };
  }

  if (normalizedPath === '/api/mcp/tools') {
    return {
      tools: [
        { name: 'demo.list_agents', description: 'List demo agents' },
        { name: 'demo.get_summary', description: 'Return a demo summary' },
      ],
    };
  }

  if (normalizedPath === '/api/mcp/call') {
    return { ok: true, demo: true, message: 'Demo MCP call succeeded' };
  }

  return {
    ok: true,
    demo: true,
    message: `Demo response for ${path}`,
    data: body || null,
  };
}