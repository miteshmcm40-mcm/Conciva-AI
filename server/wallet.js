import { q } from './db.js';

// Wallet top-up packs ($). All sold at a flat $4/min effective wallet rate
// — used as the pay-per-minute backup when plan minutes run out.
//   $500 → 125 min
//   $1,000 → 250 min   ← default-featured "Best value"
//   $2,000 → 500 min
//   $5,000 → 1,250 min
export const PACKS = [
  { id: 'pack-5', amount: 5, mins: 125, rate: 0.04, currency: 'USD' },
  { id: 'pack-11', amount: 11, mins: 250, rate: 0.04, currency: 'USD' },  // default
  { id: 'pack-21', amount: 21, mins: 500, rate: 0.04, currency: 'USD' },
  { id: 'pack-53', amount: 53, mins: 1250, rate: 0.04, currency: 'USD' },
];

export const findPack = (id) => PACKS.find((p) => p.id === id);

// Detect card brand from PAN (BIN ranges).
export function detectBrand(num) {
  const n = String(num).replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^6(?:011|5)/.test(n)) return 'Discover';
  if (/^35(2[89]|[3-8])/.test(n)) return 'JCB';
  if (/^3(?:0[0-5]|[68])/.test(n)) return 'Diners';
  return 'Card';
}

// Luhn check.
export function luhnValid(num) {
  const n = String(num).replace(/\D/g, '');
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Off-session card-charge stub. Razorpay supports recurring via Tokens + Subscriptions
// which is a separate flow we'll wire later; for now top-ups always go through the
// Razorpay Checkout modal so the user authorizes each charge.
export async function chargeCard(_args) {
  return {
    success: false,
    reason: 'Off-session charging is disabled — top-ups go through the Razorpay modal.',
  };
}

export async function getWallet(userId) {
  const u = await q(
    `SELECT wallet_minutes, wallet_usd, low_balance_threshold,
            auto_topup_enabled, auto_topup_pack_min, auto_topup_pack_usd,
            plan_min, minutes_used,
            payment_method_token, payment_method_last4,
            payment_method_network, payment_method_brand
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!u.rowCount) throw new Error('User not found');
  const row = u.rows[0];
  const planMin = row.plan_min || 0;
  const used = Number(row.minutes_used) || 0;
  const planLeft = Math.max(0, planMin - used);
  const wallet = Number(row.wallet_minutes) || 0;
  const totalMinutesAvailable = planLeft + wallet;

  return {
    walletMinutes: wallet,
    walletUsd: Number(row.wallet_usd) || 0,
    planMinutesLeft: planLeft,
    totalMinutesAvailable,
    lowBalanceThreshold: row.low_balance_threshold,
    autoTopupEnabled: row.auto_topup_enabled,
    autoTopupPackMin: row.auto_topup_pack_min,
    autoTopupPackUsd: Number(row.auto_topup_pack_usd) || 0,
    isLow: totalMinutesAvailable <= row.low_balance_threshold,
    paymentMethod: row.payment_method_token ? {
      last4:   row.payment_method_last4 || '',
      network: row.payment_method_network || '',
      brand:   row.payment_method_brand || '',
    } : null,
  };
}

export async function listMethods(userId) {
  const r = await q(
    `SELECT id, brand, last4, exp_month, exp_year, cardholder, is_default, created_at
     FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
    [userId],
  );
  return r.rows.map((m) => ({
    id: String(m.id),
    brand: m.brand,
    last4: m.last4,
    expMonth: m.exp_month,
    expYear: m.exp_year,
    cardholder: m.cardholder,
    isDefault: m.is_default,
    createdAt: m.created_at,
  }));
}

export async function getDefaultMethod(userId) {
  const r = await q(
    `SELECT id, brand, last4 FROM payment_methods
     WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [userId],
  );
  return r.rowCount ? r.rows[0] : null;
}

export async function listTransactions(userId, limit = 50) {
  const r = await q(
    `SELECT id, kind, minutes_delta, amount_usd, description,
            payment_method_id, status, failure_reason, external_ref, created_at
     FROM wallet_transactions WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((t) => ({
    id: String(t.id),
    kind: t.kind,
    minutesDelta: Number(t.minutes_delta),
    amountUsd: Number(t.amount_usd),
    description: t.description,
    paymentMethodId: t.payment_method_id ? String(t.payment_method_id) : null,
    status: t.status,
    failureReason: t.failure_reason,
    externalRef: t.external_ref,
    createdAt: t.created_at,
  }));
}
