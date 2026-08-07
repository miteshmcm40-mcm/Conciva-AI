import { q } from './db.js';

export const YEARLY_DISCOUNT = 0.20;
export const yearlyPriceUsd = (monthly) => Math.round(monthly * 12 * (1 - YEARLY_DISCOUNT));

// Hardcoded defaults — the seed source for the `base_plans` table on first
// migration, and the fallback used whenever that table can't be reached
// (no DB configured, transient outage, or the very first request before the
// initial cache load completes). Once base_plans has rows, those rows are
// authoritative; this array is never read again in a healthy deployment.
export const PLANS = [
  { id: 'scale', label: 'Scale', amount: 316, yearlyAmount: 3034, min: 3000, rate: 0.11, overage: 0.11, dids: 15, concurrent: 40, agents: 999, voiceStack: 'Realtime + premium voices', support: 'Dedicated + SLA', tag: null, sub: 'High-volume call centers.', perks: ['Unlimited AI voice agents', '3,000 included minutes', '$0.11/min effective rate', 'Inbound calling', 'Per-second billing', 'Realtime + premium voices', 'Call recording', 'Real-time transcription', 'Dedicated success manager + SLA'] },
  { id: 'growth', label: 'Growth', amount: 93, yearlyAmount: 893, min: 800, rate: 0.12, overage: 0.12, dids: 3, concurrent: 12, agents: 10, voiceStack: 'Standard + premium voices', support: 'Priority', tag: 'MOST POPULAR', sub: 'Most teams start here.', perks: ['10 AI voice agents', '800 included minutes', '$0.12/min effective rate', 'Inbound calling', 'Per-second billing', 'Standard + premium voices', 'Call recording', 'Real-time transcription', 'Priority support'] },
  { id: 'starter', label: 'Starter', amount: 31, yearlyAmount: 298, min: 250, rate: 0.13, overage: 0.13, dids: 1, concurrent: 3, agents: 2, voiceStack: 'Standard', support: 'Email', tag: null, sub: 'Pilot a single agent.', perks: ['2 AI voice agents', '250 included minutes', '$0.13/min effective rate', 'Inbound calling', 'Per-second billing', 'Standard voice stack', 'Call recording', 'Real-time transcription', 'Email support'] },
];

export const withYearly = (plans) => plans.map((p) => {
  const yearly = typeof p.yearlyAmount === 'number' ? p.yearlyAmount : yearlyPriceUsd(p.amount);
  return { ...p, yearlyAmount: yearly, yearlySavingsUsd: p.amount * 12 - yearly };
});

// Fields an admin is allowed to edit on a base plan. Anything else on the row
// (id, sort_order, timestamps) is server-managed.
export const EDITABLE_PLAN_FIELDS = [
  'label', 'sub', 'amount', 'yearlyAmount', 'min', 'rate', 'overage',
  'dids', 'concurrent', 'agents', 'voiceStack', 'support', 'tag', 'perks',
];

const rowToPlan = (row) => ({
  id: row.id,
  label: row.label,
  amount: Number(row.amount),
  // NULL yearly_amount means "auto-derive" — withYearly() fills it in from
  // amount, same as a plan that never had an override.
  yearlyAmount: row.yearly_amount != null ? Number(row.yearly_amount) : undefined,
  min: row.min,
  rate: Number(row.rate),
  overage: Number(row.overage),
  dids: row.dids,
  concurrent: row.concurrent,
  agents: row.agents,
  voiceStack: row.voice_stack,
  support: row.support,
  tag: row.tag,
  sub: row.sub,
  perks: row.perks || [],
});

// ---- In-memory cache -------------------------------------------------------
// Synchronous reads (getBasePlansSync) back dozens of call sites across
// index.js — checkout, quotes, plan lookups — that were written as plain
// `PUBLIC_PLANS.find(...)` against a static array. Turning every one of those
// into an async DB call would mean threading await through code that
// processes real payments; a background-refreshed cache (same shape as
// settings.js's overrideCache) avoids that entirely. The cost is up to
// BASE_PLANS_TTL_MS of staleness between an admin's save and it showing up
// on someone else's in-flight request — refreshBasePlans() is awaited
// directly after every admin PATCH, so the admin's own next read is instant;
// the TTL only matters for concurrent requests from other users.
const BASE_PLANS_TTL_MS = 5_000;
let basePlansCache = null;      // array | null — null until the first load
let basePlansCacheAt = 0;
let basePlansRefreshing = null; // in-flight promise, so concurrent staleness checks don't fire duplicate queries

export async function refreshBasePlans() {
  if (basePlansRefreshing) return basePlansRefreshing;
  basePlansRefreshing = (async () => {
    try {
      const r = await q(`SELECT * FROM base_plans ORDER BY sort_order ASC`);
      basePlansCache = r.rowCount ? r.rows.map(rowToPlan) : PLANS;
    } catch (e) {
      // DB unreachable — keep serving the last good cache; fall back to the
      // static defaults only if nothing has ever loaded successfully.
      if (!basePlansCache) basePlansCache = PLANS;
    } finally {
      basePlansCacheAt = Date.now();
      basePlansRefreshing = null;
    }
  })();
  return basePlansRefreshing;
}

// Fire-and-forget refresh when the cache is stale — call this from hot paths
// right before reading getBasePlansSync() so data drifts back toward fresh
// without ever blocking the request on a DB round trip.
export function maybeRefreshBasePlans() {
  if (Date.now() - basePlansCacheAt > BASE_PLANS_TTL_MS) {
    refreshBasePlans().catch(() => {});
  }
}

export function getBasePlansSync() {
  maybeRefreshBasePlans();
  return basePlansCache || PLANS;
}

// Raw (un-yearly-derived) rows for the admin editor — every field, including
// ones withYearly()/perks-rewriting would otherwise touch.
export async function getBasePlansForAdmin() {
  await refreshBasePlans();
  return basePlansCache || PLANS;
}

export async function updateBasePlan(id, patch) {
  const sets = [];
  const vals = [id];
  let i = 2;
  const colFor = {
    label: 'label', sub: 'sub', amount: 'amount', yearlyAmount: 'yearly_amount',
    min: 'min', rate: 'rate', overage: 'overage', dids: 'dids', concurrent: 'concurrent',
    agents: 'agents', voiceStack: 'voice_stack', support: 'support', tag: 'tag',
  };
  for (const [key, col] of Object.entries(colFor)) {
    if (!(key in patch)) continue;
    sets.push(`${col} = $${i++}`);
    vals.push(patch[key]);
  }
  if ('perks' in patch) {
    sets.push(`perks = $${i++}::jsonb`);
    vals.push(JSON.stringify(patch.perks));
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  const r = await q(
    `UPDATE base_plans SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    vals,
  );
  if (!r.rowCount) return null;
  await refreshBasePlans();
  return rowToPlan(r.rows[0]);
}
