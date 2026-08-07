import twilio from 'twilio';
import 'dotenv/config';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const apiKeySid = process.env.TWILIO_API_KEY_SID;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const buildApiKeyClient = () =>
  accountSid && apiKeySid && apiKeySecret
    ? twilio(apiKeySid, apiKeySecret, { accountSid })
    : null;
const buildAuthTokenClient = () =>
  accountSid && authToken ? twilio(accountSid, authToken) : null;

// Pick best client we have right now; the probe below may re-pick.
let active = buildApiKeyClient() || buildAuthTokenClient();
let activeMode = active
  ? buildApiKeyClient() === active ? 'apiKey' : 'authToken'
  : 'none';

// Twilio Restricted API keys only work if policies are attached. Probe once
// at startup; if the API-key call returns 70051, fall back to auth token.
(async () => {
  const apiKeyClient = buildApiKeyClient();
  if (apiKeyClient) {
    try {
      await apiKeyClient.incomingPhoneNumbers.list({ limit: 1 });
      active = apiKeyClient;
      activeMode = 'apiKey';
      console.log('[twilio] using API key auth');
      return;
    } catch (e) {
      console.warn('[twilio] API key auth rejected (' + (e.code || '?') + '): ' + e.message + ' — falling back to auth token');
    }
  }
  const tokenClient = buildAuthTokenClient();
  if (tokenClient) {
    active = tokenClient;
    activeMode = 'authToken';
    console.log('[twilio] using account auth token');
  } else {
    active = null;
    activeMode = 'none';
    console.warn('[twilio] no working credentials');
  }
})();

// Proxy ensures every property access uses the *current* active client, even
// after the async probe swaps it.
export const twilioClient = new Proxy({}, {
  get(_t, prop) {
    if (!active) throw new Error('Twilio not configured');
    return active[prop];
  },
});

export const twilioConfigured = !!(buildApiKeyClient() || buildAuthTokenClient());
export const getTwilioMode = () => activeMode;
export const twilioDefaultNumber = process.env.TWILIO_DEFAULT_NUMBER || '';
export const publicBaseUrl = process.env.PUBLIC_BASE_URL || '';
// SIP trunk that routes inbound PSTN calls to LiveKit's SIP endpoint.
// All customer numbers are attached to this trunk so calls reach the AI agent.
export const sipTrunkSid = process.env.TWILIO_SIP_TRUNK_SID || 'TKeabd20477cbba7c4c2dbb08dcd9c6fa4';

export const requireTwilio = (_req, res, next) => {
  if (!active) return res.status(500).json({ error: 'Twilio not configured' });
  next();
};
