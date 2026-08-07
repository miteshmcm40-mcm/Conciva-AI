import { q } from './db.js';
import { callTool, mcpConfigured } from './mcp.js';
import {
  createDispatchRule as dashCreateDispatchRule,
  dashboardConfigured,
} from './dashboard.js';

const TWILIO_SIP_IPS = [
  '54.172.60.0/30', '54.244.51.0/30', '54.171.127.192/30',
  '54.65.63.192/30', '54.169.127.128/30', '54.252.254.64/30',
  '177.71.206.192/30', '54.232.85.80/30', '35.156.191.128/30',
];
const SIP_GATEWAY_IP = process.env.SIP_GATEWAY_IP || TWILIO_SIP_IPS[0];

const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'customer';

const namesFor = (user) => {
  const base = slugify(user.company || user.username || user.email.split('@')[0]);
  const numSuffix = (user.number_value || '').replace(/\D/g, '').slice(-4);
  const slug = `${base}-agent`.slice(0, 40);
  return {
    base, agentSlug: slug,
    agentName: `${user.company || base} Receptionist`,
    trunkName: `${user.company || base} Trunk ${numSuffix}`,
    ruleName: `${user.company || base} Rule ${numSuffix}`,
    roomName: `${base}-room-${numSuffix}`,
  };
};

const setStatus = async (userId, status, error = null, fields = {}) => {
  const cols = ['provisioning_status = $1', 'provisioning_error = $2'];
  const vals = [status, error];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) { cols.push(`${k} = $${i++}`); vals.push(v); }
  if (status === 'ready') cols.push(`provisioned_at = NOW()`);
  vals.push(userId);
  await q(`UPDATE users SET ${cols.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
};

const unwrap = (r) => {
  if (!r) return null;
  if (r.structuredContent?.result !== undefined) {
    try { return JSON.parse(r.structuredContent.result); } catch { return r.structuredContent.result; }
  }
  if (Array.isArray(r.content)) {
    const txt = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    try { return JSON.parse(txt); } catch { return { text: txt }; }
  }
  return r;
};

const callMcp = async (name, args = {}) => {
  if (!mcpConfigured) throw new Error('MCP not configured');
  const out = unwrap(await callTool(name, args));
  if (out && (out.error || out.success === false))
    throw new Error(`MCP ${name} failed: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
};

const e164 = (raw) => { const d = String(raw || '').replace(/\D+/g, ''); return d.startsWith('+') ? d : `+${d}`; };
const digits = (raw) => String(raw || '').replace(/\D+/g, '');

// Step 1: Inbound trunk via MCP
const ensureTrunk = async (user, names) => {
  const target = digits(user.number_value);
  try {
    const trunks = unwrap(await callMcp('list_sip_trunks', {}));
    const inbound = Array.isArray(trunks?.inbound) ? trunks.inbound : [];
    const found = inbound.find((t) => (t.numbers || []).some((n) => digits(n) === target));
    if (found) return { id: found.sip_trunk_id || found.trunk_id || found.id, name: found.name, created: false };
  } catch {}
  const created = await callMcp('create_inbound_trunk', {
    name: names.trunkName,
    numbers: [e164(user.number_value)],
    allowed_addresses: TWILIO_SIP_IPS,
  });
  const id = created?.sip_trunk_id || created?.trunk_id || created?.id || created?.trunk?.sip_trunk_id;
  if (!id) throw new Error('create_inbound_trunk returned no ID: ' + JSON.stringify(created).slice(0, 200));
  return { id, name: names.trunkName, created: true };
};

// Step 2: Agent via MCP
const ensureAgent = async (user, names) => {
  try {
    const existing = unwrap(await callMcp('get_agent_by_slug', { slug: names.agentSlug }));
    if (existing?.id) return { id: existing.id, slug: names.agentSlug, created: false };
  } catch {}
  const greeting = user.greeting?.trim() || `Hi, thanks for calling ${user.company || 'us'}. How can I help today?`;
  const prompt = user.prompt?.trim() || `You are the AI receptionist for ${user.company || 'this business'}. Be warm, helpful, and concise.`;
  const created = await callMcp('create_agent', {
    name: names.agentName, slug: names.agentSlug,
    instructions: prompt, initial_greeting: greeting,
    llm_provider: 'google', llm_model: 'gemini-2.5-flash',
    stt_provider: 'deepgram', stt_model: 'nova-3-general',
    tts_provider: 'openai', tts_model: 'tts-1',
  });
  const blob = created?.agent || created;
  const id = blob?.id || blob?.agent_id;
  if (!id) throw new Error('create_agent returned no ID: ' + JSON.stringify(created).slice(0, 200));
  try { await callMcp('start_agent', { agent_id: id }); } catch {}
  return { id, slug: names.agentSlug, created: true };
};

// Step 3: Dispatch rule via dashboard form-POST (MCP drops room_config.agents)
const ensureDispatchRule = async (trunkId, agentSlug, names) => {
  if (!dashboardConfigured) throw new Error('Dashboard not configured — cannot create dispatch rule');
  const rule = await dashCreateDispatchRule({
    name: names.ruleName, trunkIds: [trunkId],
    agentSlug, roomName: names.roomName, ruleType: 'direct',
  });
  return { id: rule.id, name: names.ruleName, created: true };
};

// Main entrypoint
export async function provisionInboundForUser(userId) {
  if (!mcpConfigured && !dashboardConfigured) throw new Error('Neither MCP nor dashboard configured');
  const r = await q(
    `SELECT id, name, company, username, email, phone, voice, agent_name,
            greeting, prompt, kb_company, number_value, twilio_sid,
            livekit_trunk_id, livekit_dispatch_id, agent_id, agent_slug, livekit_room_name
     FROM users WHERE id = $1`, [userId]);
  if (!r.rowCount) throw new Error('User not found');
  const user = r.rows[0];
  if (!user.number_value) { await setStatus(userId, 'failed', 'No phone number'); throw new Error('No phone number'); }

  const names = namesFor(user);
  await setStatus(userId, 'in_progress');
  const log = [];
  try {
    const trunk = await ensureTrunk(user, names);
    log.push(`${trunk.created ? '✓ created' : '↻ reused'} trunk ${trunk.id}`);
    await setStatus(userId, 'in_progress', null, { livekit_trunk_id: trunk.id });

    const agent = await ensureAgent(user, names);
    log.push(`${agent.created ? '✓ created' : '↻ reused'} agent ${agent.slug}`);
    await setStatus(userId, 'in_progress', null, { agent_id: agent.id, agent_slug: agent.slug });

    const rule = await ensureDispatchRule(trunk.id, agent.slug, names);
    log.push(`${rule.created ? '✓ created' : '↻ reused'} rule ${rule.id}`);
    await setStatus(userId, 'ready', null, { livekit_dispatch_id: rule.id || null, livekit_room_name: names.roomName });

    return { ok: true, log, trunkId: trunk.id, ruleId: rule.id, agentId: agent.id, agentSlug: agent.slug, roomName: names.roomName };
  } catch (e) {
    const msg = e.message || String(e);
    log.push(`✗ ${msg}`);
    await setStatus(userId, 'failed', msg);
    throw new Error(msg);
  }
}

// Stub for provisionAdditionalNumber — called by multi-number logic
export async function provisionAdditionalNumber(userId, phoneNumber) {
  return provisionInboundForUser(userId);
}
