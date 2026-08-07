import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.MCP_URL;
const MCP_TOKEN = process.env.MCP_TOKEN;

export const mcpConfigured = !!(MCP_URL && MCP_TOKEN);

let client = null;
let connecting = null;
let lastError = null;

const buildClient = async () => {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
  });
  const c = new Client({ name: '9278-portal', version: '0.1.0' }, { capabilities: {} });
  await c.connect(transport);
  return c;
};

export async function getMcp() {
  if (!mcpConfigured) throw new Error('MCP not configured');
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      try {
        client = await buildClient();
        lastError = null;
        console.log('[mcp] connected to', MCP_URL);
      } catch (e) {
        lastError = e;
        console.warn('[mcp] connect failed:', e.message);
        throw e;
      } finally {
        connecting = null;
      }
    })();
  }
  await connecting;
  return client;
}

const reset = () => { client = null; connecting = null; };

// Reconnect on errors that look like dropped sessions.
export async function callTool(name, args = {}) {
  try {
    const c = await getMcp();
    return await c.callTool({ name, arguments: args });
  } catch (e) {
    if (/closed|disconnect|EPIPE|reset|session/i.test(e.message || '')) {
      console.warn('[mcp] reconnecting after:', e.message);
      reset();
      const c = await getMcp();
      return await c.callTool({ name, arguments: args });
    }
    throw e;
  }
}

export async function listTools() {
  const c = await getMcp();
  const r = await c.listTools();
  return r.tools;
}

export async function listResources() {
  const c = await getMcp();
  try { return (await c.listResources()).resources; } catch { return []; }
}

export function mcpLastError() {
  return lastError ? lastError.message : null;
}

export function mcpUrl() {
  return MCP_URL || null;
}

// ===========================================================================
// Per-reseller MCP routing — multi-tenant addition.
//
// Each reseller can run their own `dashboard.<their-domain>/mcp` and the
// portal stores the URL + bearer token on `users.mcp_url` / `users.mcp_token`
// for that reseller row. `getMcpFor({url, token})` returns a cached, lazily-
// connected MCP client for any (url, token) pair so call paths that touch a
// specific customer can route to that customer's reseller's dashboard.
//
// Falls back to the env-level client when either field is empty — keeps the
// canonical `dashboard.9278.ai` flow working unchanged for the 9278.ai
// reseller (and for any reseller that hasn't been provisioned yet).
//
// The cache key is the URL + a hash of the token (so token rotation forces a
// reconnect). Stale clients on transport errors are evicted automatically.
// ===========================================================================
import crypto from 'crypto';
const remoteClients = new Map();        // cacheKey → { client, connecting, lastError }
const cacheKey = (url, token) =>
  `${url}#${crypto.createHash('sha1').update(token || '').digest('hex').slice(0, 8)}`;

const buildRemoteClient = async (url, token) => {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const c = new Client({ name: '9278-portal', version: '0.1.0' }, { capabilities: {} });
  await c.connect(transport);
  return c;
};

// Returns a connected MCP Client for the given (url, token). Reuses the
// env-level singleton when both arguments are empty/null.
//
// NOTE: The slot is created and registered BEFORE the connect IIFE starts —
// otherwise the IIFE's closure captures `slot` while it's still undefined
// (the outer `slot = {...}` literal hasn't returned yet), causing the
// `slot.client = await buildRemoteClient(...)` assignment inside the IIFE
// to silently throw and the cached client to stay null forever.
export async function getMcpFor({ url, token } = {}) {
  if (!url || !token) return getMcp();                  // fall back to env

  const key = cacheKey(url, token);
  let slot = remoteClients.get(key);
  if (slot?.client) return slot.client;

  if (!slot) {
    slot = { client: null, connecting: null, lastError: null };
    remoteClients.set(key, slot);
  }

  if (!slot.connecting) {
    slot.connecting = (async () => {
      try {
        const c = await buildRemoteClient(url, token);
        slot.client    = c;
        slot.lastError = null;
        console.log('[mcp] connected to', url);
      } catch (e) {
        slot.lastError = e;
        console.warn('[mcp] connect failed for', url + ':', e.message);
        remoteClients.delete(key);          // evict poisoned slot
        throw e;
      } finally {
        slot.connecting = null;
      }
    })();
  }

  await slot.connecting;
  return slot.client;
}

// listTools() against a specific (url, token). Falls back to the env-level
// client when either argument is empty so callers can pass a reseller row
// even when mcp_url/mcp_token are NULL on it.
export async function listToolsFor({ url, token } = {}) {
  const c = await getMcpFor({ url, token });
  const r = await c.listTools();
  return r.tools;
}

export async function callToolFor({ url, token } = {}, name, args = {}) {
  try {
    const c = await getMcpFor({ url, token });
    return await c.callTool({ name, arguments: args });
  } catch (e) {
    if (/closed|disconnect|EPIPE|reset|session/i.test(e.message || '')) {
      console.warn('[mcp] reconnecting after:', e.message);
      if (url && token) remoteClients.delete(cacheKey(url, token)); else reset();
      const c = await getMcpFor({ url, token });
      return await c.callTool({ name, arguments: args });
    }
    throw e;
  }
}
