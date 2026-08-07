// MCP integration — aligned with the dashboard's canonical sidecar tools.
//
// Per the dashboard team's MCP spec we follow these rules:
//   - Use `list_dispatch_routing` to find what agent a phone routes to (NOT
//     manually parsing dispatch_rule.room_config metadata).
//   - Use `assign_agent_to_number({phone_number, agent, auto_record})` to
//     repoint a number's dispatch — idempotent, no cloning, no cascade slugs.
//   - Use `set_agent_language({agent, language})` to switch an agent's
//     language. NEVER call `set_number_language` (it creates cascade clones
//     named <slug>-<lang> which compound into nick-pa-in-pa-in-pa-in).
//   - After updating `system_prompt`, call `apply_default_behavior` so the
//     prompt-version snapshot at livekit:prompt_version:<id>:<vid>.prompt is
//     synced and the next call reads the new prompt immediately (Gotcha #1).
//   - Expect the watcher to overwrite realtime_config + recording disclaimer +
//     LANGUAGE SWITCHING RULE + HANGUP RULE every 60s. Don't fight it.

import { callTool, mcpConfigured } from './mcp.js';

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

const looksLikeError = (out) =>
  !!out && (out.error || out.success === false);

const e164 = (raw) => {
  const d = String(raw || '').replace(/\D+/g, '');
  return d.startsWith('+') ? d : `+${d}`;
};

// Compute the canonical "base" slug for a user. Mirrors provision.js so every
// code path agrees on a single canonical identifier per customer.
const slugify = (s) =>
  String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40);

export function computeBaseSlug(user) {
  const base = slugify(user.company || user.username || user.email?.split('@')[0]);
  return `${base || 'customer'}-agent`.slice(0, 40);
}

// Read the dispatch routing for a phone via the official sidecar tool.
// Returns { id, slug, name, agent_exists, auto_record, dispatch_rule_id } or null.
export async function getActiveAgentForNumber(phoneNumber) {
  if (!mcpConfigured || !phoneNumber) return null;
  const digits = String(phoneNumber).replace(/\D+/g, '');

  const out = unwrap(await callTool('list_dispatch_routing', {}));
  const routes = out?.routes || [];
  const entry = routes.find((r) =>
    String(r.phone_number || '').replace(/\D+/g, '') === digits,
  );
  if (!entry) return null;
  return {
    id: entry.agent_id || null,
    slug: entry.routed_slug || null,
    name: entry.agent_name || null,
    agentExists: entry.agent_exists,
    autoRecord: entry.auto_record,
    dispatchRuleId: entry.dispatch_rule_id,
  };
}

// Switch an agent's language. Two writes:
//   1. set_agent_language — translates greeting + injects prompt directive
//      (this is what the sidecar's translate-via-Grok flow does).
//   2. update_agent_config({realtime_config:{language}}) — locks the Gemini
//      Live model to that language. Without this, realtime stays at ""
//      (auto-detect) and the model may switch to English mid-call.
//
// `agent` may be the agent's id or name. `agentId` (optional) lets the caller
// short-circuit lookup when they already know the id (set_agent_language only
// accepts id or name, not slug).
export async function setAgentLanguage({ agent, agentId, language }) {
  if (!mcpConfigured) throw new Error('MCP not configured');
  if (!agent && !agentId) throw new Error('agent (id or name) required');

  // Step 1 — sidecar translation + directive injection.
  const out = unwrap(await callTool('set_agent_language', { agent: agent || agentId, language }));
  if (looksLikeError(out)) {
    throw new Error(`set_agent_language failed: ${(out.error || JSON.stringify(out)).slice(0, 200)}`);
  }

  // Step 2 — lock realtime model to the chosen language. en-US clears it
  // back to "" (auto-detect); anything else locks it. The watcher explicitly
  // leaves realtime_config.language alone, so this write sticks.
  const realtimeLang = language === 'en-US' ? '' : language;
  const targetId = agentId || out.agent_id;
  if (targetId) {
    try {
      await callTool('update_agent_config', {
        agent_id: targetId,
        realtime_config: { language: realtimeLang },
      });
    } catch (e) {
      console.warn('[setAgentLanguage] realtime_config write failed:', e.message);
    }
  }

  return out;
}

// Public per-number language switch — looks up the dispatched agent and edits
// its language directly. Replaces the obsolete clone-based set_number_language
// flow which created cascading <slug>-<lang>-<lang> chains.
export async function setNumberLanguage({ phoneNumber, language, originalAgent = {} }) {
  if (!mcpConfigured) throw new Error('MCP not configured');
  if (!phoneNumber) throw new Error('phoneNumber required');
  if (!language)    throw new Error('language required');

  const live = await getActiveAgentForNumber(phoneNumber);
  if (!live?.id) {
    throw new Error(`No live agent for ${phoneNumber} — assign one via assign_agent_to_number first`);
  }
  // Pass both `agent` (for the sidecar call) and `agentId` (so the realtime
  // lock write doesn't have to look the id up again).
  await setAgentLanguage({ agent: live.id, agentId: live.id, language });
  return { agent_id: live.id, slug: live.slug, language };
}

// Repoint a phone's dispatch to a specific agent — idempotent, no clones, no
// dispatch creation needed (assign handles it).
export async function assignAgentToNumber({ phoneNumber, agent, autoRecord = true }) {
  if (!mcpConfigured) throw new Error('MCP not configured');
  const out = unwrap(await callTool('assign_agent_to_number', {
    phone_number: e164(phoneNumber),
    agent,
    auto_record: autoRecord,
  }));
  if (looksLikeError(out)) {
    throw new Error(`assign_agent_to_number failed: ${(out.error || JSON.stringify(out)).slice(0, 200)}`);
  }
  return out;
}

// Apply the watcher's canonical template to an agent NOW (instead of waiting
// up to 60s for the next tick). This is what syncs the prompt-version snapshot
// after a system_prompt edit (Gotcha #1) — without this, calls dispatched in
// the next minute will still read the OLD prompt.
export async function applyDefaultBehavior(agentIdOrName) {
  if (!mcpConfigured || !agentIdOrName) return null;
  try {
    return unwrap(await callTool('apply_default_behavior', { agent: agentIdOrName }));
  } catch (e) {
    // Some sidecar versions take `agent_id` instead of `agent` — retry once.
    try {
      return unwrap(await callTool('apply_default_behavior', { agent_id: agentIdOrName }));
    } catch (e2) {
      console.warn('[applyDefaultBehavior] failed:', e2.message);
      return null;
    }
  }
}

// =============================================================================
// syncAgentForUser — idempotent upsert for a customer's voice agent.
//
//   1. Find which agent the dispatch routes to (via list_dispatch_routing).
//   2. If the dispatched slug has no agent, create one + assign it to the
//      number. (Calls the sidecar's assign_agent_to_number, not manual
//      dispatch_rule mutation.)
//   3. Push the user's edits (name / greeting / system_prompt / kb).
//   4. If system_prompt or initial_greeting changed, call apply_default_behavior
//      to sync the prompt-version snapshot + re-enforce the watcher template
//      immediately (Gotcha #1).
//   5. Delete duplicate agents matching the customer's base slug to keep the
//      dashboard at one-agent-per-number.
//   6. Sync DB pointers.
// =============================================================================
export async function syncAgentForUser({ phoneNumber, updates = {}, originalAgent = {}, userId = null, db = null, baseSlug = null }) {
  if (!mcpConfigured || !phoneNumber) return null;

  // 1) Where does the dispatch route right now?
  let live = await getActiveAgentForNumber(phoneNumber);

  // 2) If there's no live agent (or agent_exists=false), create one and assign.
  if (!live?.id || live.agentExists === false) {
    const slug = baseSlug || `${slugify(originalAgent.company || 'customer')}-agent`;
    console.warn(`[syncAgent] no live agent for ${phoneNumber} — creating '${slug}'`);
    try {
      const created = unwrap(await callTool('create_agent', {
        name: originalAgent.agentName || originalAgent.company || 'Receptionist',
        slug,
        instructions: originalAgent.prompt
          || `You are the AI receptionist for ${originalAgent.company || 'this business'}.`,
        initial_greeting: originalAgent.greeting
          || `Hi, thanks for calling ${originalAgent.company || 'us'}. How can I help today?`,
        llm_provider: 'xai', llm_model: 'grok-4-fast-non-reasoning',
      }));
      const id = (created?.agent || created)?.id || (created?.agent || created)?.agent_id;
      if (id) {
        try { await callTool('start_agent', { agent_id: id }); } catch {}
        await assignAgentToNumber({ phoneNumber, agent: slug, autoRecord: true });
        await applyDefaultBehavior(id);
        live = await getActiveAgentForNumber(phoneNumber);
      }
    } catch (e) {
      console.warn('[syncAgent] create+assign failed:', e.message);
    }
  }

  if (!live?.id) {
    console.warn(`[syncAgent] gave up — could not establish a live agent for ${phoneNumber}`);
    return null;
  }

  // 3) Push the customer's edits to the live agent.
  if (Object.keys(updates).length) {
    try {
      await callTool('update_agent_config', { agent_id: live.id, ...updates });
    } catch (e) {
      console.warn('[syncAgent] update_agent_config failed:', e.message);
    }
  }

  // 4) Sync prompt-version snapshot + re-enforce watcher template if system
  // content changed. Without this, calls in the next ~60s read the OLD prompt.
  if (updates.system_prompt !== undefined || updates.initial_greeting !== undefined) {
    await applyDefaultBehavior(live.id);
  }

  // 5) DEDUPE — every other agent whose slug starts with the customer's base
  // is an orphan from earlier cascade work. Delete them. NEVER delete `live`.
  if (baseSlug) {
    try {
      const out = unwrap(await callTool('list_agents', {}));
      const all = Array.isArray(out) ? out : (out?.agents || []);
      const owned = all.filter((a) => {
        const s = a.slug || '';
        return s === baseSlug || s.startsWith(baseSlug + '-');
      });
      for (const o of owned) {
        if (o.id === live.id) continue;
        console.log(`[syncAgent] deleting duplicate '${o.slug}' (id ${o.id}) — keeping '${live.slug}'`);
        try { await callTool('delete_agent', { agent_id: o.id }); }
        catch (e) { console.warn(`[syncAgent] delete '${o.slug}' failed:`, e.message); }
      }
    } catch (e) {
      console.warn('[syncAgent] dedupe scan failed:', e.message);
    }
  }

  // 6) Keep DB pointers in lock-step with the live agent.
  if (userId && db) {
    try {
      await db.q(
        `UPDATE users
           SET agent_id = $1, agent_slug = $2, updated_at = NOW()
         WHERE id = $3 AND (agent_id IS DISTINCT FROM $1 OR agent_slug IS DISTINCT FROM $2)`,
        [live.id, live.slug, userId],
      );
    } catch (e) { console.warn('[syncAgent] DB sync failed:', e.message); }
  }

  return live;
}

// Backward-compat thin wrapper. New callers should use syncAgentForUser.
export async function ensureLiveAgent({ phoneNumber, originalAgent = {}, userId = null, db = null }) {
  return syncAgentForUser({ phoneNumber, originalAgent, userId, db });
}

// Startup sweep — runs syncAgentForUser for every customer with a phone
// number, on backend boot (and every 30 min thereafter). Heals any drift the
// dashboard or the watcher accumulated while we were down.
export async function startupAgentSweep(db) {
  if (!mcpConfigured || !db) return;
  let users;
  try {
    const r = await db.q(
      `SELECT id, name, company, username, email, voice, agent_name, greeting, prompt, number_value
         FROM users
        WHERE number_value IS NOT NULL AND number_value <> ''
        ORDER BY id`,
    );
    users = r.rows;
  } catch (e) {
    console.warn('[startupSweep] db query failed:', e.message);
    return;
  }
  console.log(`[startupSweep] checking ${users.length} number(s) for live-agent health + dedupe`);
  let healed = 0;
  for (const u of users) {
    try {
      const before = await getActiveAgentForNumber(u.number_value);
      const live = await syncAgentForUser({
        phoneNumber: u.number_value,
        userId: u.id,
        db,
        baseSlug: computeBaseSlug(u),
        originalAgent: {
          prompt: u.prompt, greeting: u.greeting, voice: u.voice,
          agentName: u.agent_name, company: u.company,
        },
      });
      if (live?.id && (!before?.id || before.id !== live.id)) {
        healed++;
        console.log(`[startupSweep] ${u.number_value} → ${live.slug} (id ${live.id})`);
      }
    } catch (e) {
      console.warn(`[startupSweep] ${u.number_value} failed:`, e.message);
    }
  }
  console.log(`[startupSweep] done — ${healed} number(s) healed, ${users.length - healed} already healthy`);
}
