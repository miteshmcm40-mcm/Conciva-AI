import Stripe from 'stripe';
import 'dotenv/config';
import { q } from './db.js';
const SECRET = process.env.STRIPE_SECRET_KEY || '';
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || '';
export const stripeCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
export const stripeConfigured = !!(SECRET && PUBLISHABLE);
export const stripe = stripeConfigured ? new Stripe(SECRET, { apiVersion: '2024-09-30.acacia' }) : null;
export const stripePublishableKey = PUBLISHABLE;

const usdToCents = (usd) => Math.round(Number(usd) * 100);

// Get-or-create the Stripe Customer for a portal user. We persist the id on
// the users row so we can charge them off-session for renewals.
export async function getOrCreateStripeCustomer(userRow) {
  if (!stripe) throw new Error('Stripe not configured');
  if (userRow.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(userRow.stripe_customer_id);
      if (!existing.deleted) return existing;
    } catch (e) {
      // fall through and recreate
    }
  }
  const created = await stripe.customers.create({
    email: userRow.email,
    name: userRow.name || userRow.username,
    metadata: {
      portal_user_id: String(userRow.id),
      portal_company: userRow.company || '',
    },
  });
  await q(
    `UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`,
    [created.id, userRow.id],
  );
  return created;
}

// Start a SetupIntent so the browser can tokenize a card via Stripe Elements
// without ever touching our server with raw PAN.
export async function startSetupIntent(userRow) {
  if (!stripe) throw new Error('Stripe not configured');
  const customer = await getOrCreateStripeCustomer(userRow);
  const intent = await stripe.setupIntents.create({
    customer: customer.id,
    payment_method_types: ['card'],
    usage: 'off_session',
    metadata: { portal_user_id: String(userRow.id) },
  });
  return {
    clientSecret: intent.client_secret,
    customerId: customer.id,
    setupIntentId: intent.id,
  };
}
// Read a confirmed SetupIntent and persist the payment method to our DB.
// Returns the saved row.
export async function persistSetupIntent(setupIntentId, userRow, makeDefault = false) {
  if (!stripe) throw new Error('Stripe not configured');
  const intent = await stripe.setupIntents.retrieve(setupIntentId);
  if (intent.status !== 'succeeded') {
    throw new Error(`SetupIntent not succeeded yet (status=${intent.status})`);
  }
  const pmId = typeof intent.payment_method === 'string'
    ? intent.payment_method
    : intent.payment_method?.id;
  if (!pmId) throw new Error('SetupIntent has no payment method');

  const pm = await stripe.paymentMethods.retrieve(pmId);
  const card = pm.card || {};

  // Make sure the PM is attached to our customer (it usually already is).
  if (pm.customer !== userRow.stripe_customer_id) {
    try {
      await stripe.paymentMethods.attach(pmId, { customer: userRow.stripe_customer_id });
    } catch { }
  }

  const want = !!makeDefault;
  const existing = await q(
    `SELECT COUNT(*)::int AS c FROM payment_methods WHERE user_id = $1`,
    [userRow.id],
  );
  const isDefault = want || existing.rows[0].c === 0;
  if (isDefault) {
    await q(`UPDATE payment_methods SET is_default = false WHERE user_id = $1`, [userRow.id]);
    // Also tell Stripe so off-session charges use this PM by default.
    try {
      await stripe.customers.update(userRow.stripe_customer_id, {
        invoice_settings: { default_payment_method: pmId },
      });
    } catch { }
  }

  const ins = await q(
    `INSERT INTO payment_methods
       (user_id, brand, last4, exp_month, exp_year, cardholder, is_default, stripe_pm_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, brand, last4, exp_month, exp_year, cardholder, is_default, stripe_pm_id, created_at`,
    [
      userRow.id,
      (card.brand || 'card').replace(/^./, (c) => c.toUpperCase()),
      card.last4 || '',
      card.exp_month || null,
      card.exp_year || null,
      pm.billing_details?.name || null,
      isDefault,
      pmId,
    ],
  );
  return ins.rows[0];
}

// Off-session charge — used for wallet top-ups and monthly recurring rental.
// Returns { success: true, ref, amountUsd } or { success: false, reason }.
export async function chargeStripeUser({ userRow, amountUsd, description, paymentMethodId, currency }) {
  if (!stripe) return { success: false, reason: 'Stripe not configured' };
  if (!userRow.stripe_customer_id) return { success: false, reason: 'No Stripe customer on user' };
  if (!paymentMethodId) return { success: false, reason: 'No payment method' };
  if (!amountUsd || amountUsd <= 0) return { success: false, reason: 'Invalid amount' };

  try {
    const intent = await stripe.paymentIntents.create({
      amount: usdToCents(amountUsd),
      currency: (currency || stripeCurrency).toLowerCase(),
      customer: userRow.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: description || 'Voice Agent Portal',
      metadata: {
        portal_user_id: String(userRow.id),
        portal_email: userRow.email,
      },
    });
    if (intent.status === 'succeeded') {
      return {
        success: true,
        ref: intent.id,
        amountUsd,
        descriptor: `${(intent.charges?.data?.[0]?.payment_method_details?.card?.brand || 'card')} ····${intent.charges?.data?.[0]?.payment_method_details?.card?.last4 || '????'}`,
      };
    }
    if (intent.status === 'requires_action') {
      // Off-session 3-D Secure needed; we can't complete without redirecting the user.
      return { success: false, reason: 'Card requires 3-D Secure — open Billing to add it on-session' };
    }
    return { success: false, reason: `Stripe status ${intent.status}` };
  } catch (e) {
    return {
      success: false,
      reason: e.code === 'authentication_required'
        ? 'Card requires 3-D Secure — open Billing to add it on-session'
        : (e.raw?.message || e.message || 'Stripe charge failed'),
    };
  }
}

// Detach a saved card both in Stripe and locally.
export async function detachStripeMethod(stripePmId) {
  if (!stripe || !stripePmId) return;
  try { await stripe.paymentMethods.detach(stripePmId); } catch { }
}

// Build a public-facing URL for Stripe to redirect the user back to. Uses
// PUBLIC_BASE_URL from .env or, as a fallback, http://localhost:9278.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:9278').replace(/\/$/, '');

// Create a Stripe Checkout Session in `payment` mode that charges the user
// the total signup amount AND saves the card for future off-session charges.
// Returns { url, sessionId }.
export async function createSignupCheckoutSession({
  userRow, email, name, planLabel, planAmount, planMin, numberPrice, phoneNumber,
  pendingToken,
  successPath = '/signup/success', cancelPath = '/signup/checkout',
}) {
  if (!stripe) throw new Error('Stripe not configured');
  let customerId;
  if (userRow) {
    const customer = await getOrCreateStripeCustomer(userRow);
    customerId = customer.id;
  } else if (email) {
    const customer = await stripe.customers.create({
      email, name: name || email,
      metadata: { source: 'voice-agent-signup' },
    });
    customerId = customer.id;
  }
  const lineItems = [];
  if (planAmount > 0) {
    lineItems.push({
      price_data: {
        currency: stripeCurrency,
        unit_amount: usdToCents(planAmount),
        product_data: {
          name: `${planLabel || 'Plan'} credit`,
          description: `${planMin || 0} voice minutes`,
        },
      },
      quantity: 1,
    });
  }
  if (numberPrice > 0 && phoneNumber) {
    lineItems.push({
      price_data: {
        currency: stripeCurrency,
        unit_amount: usdToCents(numberPrice),
        product_data: {
          name: 'Phone number — first month',
          description: phoneNumber,
        },
      },
      quantity: 1,
    });
  }
  if (!lineItems.length) throw new Error('Empty cart');

  const sessionOpts = {
    mode: 'payment',
    line_items: lineItems,
    payment_intent_data: {
      setup_future_usage: 'off_session',
      description: `Voice Agent Portal · signup for ${email || userRow?.email || ''}`,
      metadata: { kind: 'signup', pending_token: pendingToken || '' },
    },
    success_url: `${PUBLIC_BASE_URL}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_BASE_URL}${cancelPath}?cancelled=1`,
    metadata: {
      kind: 'signup',
      pending_token: pendingToken || '',
      plan_label: planLabel || '',
      plan_amount: String(planAmount || 0),
      plan_min: String(planMin || 0),
    },
  };
  if (customerId) sessionOpts.customer = customerId;
  if (!customerId && email) sessionOpts.customer_email = email;

  const session = await stripe.checkout.sessions.create(sessionOpts);
  return { url: session.url, sessionId: session.id };
}

// `setup` mode — saves a card without charging. Used by Billing's "Add a card".
export async function createSetupCheckoutSession({
  userRow, returnPath = '/dashboard/billing',
}) {
  if (!stripe) throw new Error('Stripe not configured');
  const customer = await getOrCreateStripeCustomer(userRow);
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customer.id,
    payment_method_types: ['card'],
    success_url: `${PUBLIC_BASE_URL}${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_BASE_URL}${returnPath}?cancelled=1`,
    metadata: { portal_user_id: String(userRow.id), kind: 'setup' },
  });
  return { url: session.url, sessionId: session.id };
}

// `payment` mode for wallet top-ups. Charges the pack price + saves the card
// for future off-session top-ups.
export async function createTopupCheckoutSession({
  userRow, packId, amountUsd, mins, returnPath = '/dashboard/billing',
}) {
  if (!stripe) throw new Error('Stripe not configured');
  const customer = await getOrCreateStripeCustomer(userRow);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customer.id,
    line_items: [{
      price_data: {
        currency: stripeCurrency,
        unit_amount: usdToCents(amountUsd),
        product_data: {
          name: `${packId} pack`,
          description: `${mins} voice minutes`,
        },
      },
      quantity: 1,
    }],
    payment_intent_data: {
      setup_future_usage: 'off_session',
      description: `Voice Agent Portal · ${packId} top-up for ${userRow.email}`,
      metadata: { portal_user_id: String(userRow.id), kind: 'topup', pack: packId, mins: String(mins) },
    },
    success_url: `${PUBLIC_BASE_URL}${returnPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_BASE_URL}${returnPath}?cancelled=1`,
    metadata: {
      portal_user_id: String(userRow.id),
      kind: 'topup',
      pack: packId,
      mins: String(mins),
      amount: String(amountUsd),
    },
  });
  return { url: session.url, sessionId: session.id };
}


// Verify a Checkout Session after Stripe redirects the user back. Pulls the
// PaymentMethod that Stripe saved on the customer (via setup_future_usage)
// and persists it locally so future off-session charges work.
// Returns: { kind, paid, paymentMethod, charged, metadata }
export async function processCheckoutReturn(sessionId, userRow) {
  if (!stripe) throw new Error('Stripe not configured');
  if (!sessionId) throw new Error('sessionId required');

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent', 'setup_intent'],
  });

  // Reject if this session belongs to someone else.
  const owner = session.metadata?.portal_user_id;
  if (!owner || String(owner) !== String(userRow.id)) {
    throw new Error('Session does not belong to current user');
  }

  const kind = session.metadata?.kind || (session.mode === 'setup' ? 'setup' : 'payment');
  const status = session.status; // 'open' | 'complete' | 'expired'
  const paymentStatus = session.payment_status; // 'paid' | 'unpaid' | 'no_payment_required'

  // Find the PaymentMethod attached during this session.
  let paymentMethodId = null;
  if (session.mode === 'setup') {
    paymentMethodId = session.setup_intent?.payment_method
      || (typeof session.setup_intent === 'string' ? null : null);
  } else {
    paymentMethodId = session.payment_intent?.payment_method
      || null;
  }

  if (status !== 'complete') {
    return { kind, paid: false, status, paymentStatus, paymentMethod: null, metadata: session.metadata };
  }

  let savedPmRow = null;
  if (paymentMethodId) {
    try {
      savedPmRow = await attachPaymentMethodToUser(paymentMethodId, userRow, /* default */ true);
    } catch (e) {
      // Ignore "already attached" type errors — the row may already be saved.
      console.warn('[checkout-return] attach PM warning:', e.message);
    }
  }

  return {
    kind,
    paid: paymentStatus === 'paid' || paymentStatus === 'no_payment_required',
    status,
    paymentStatus,
    paymentMethodId,
    savedPmRow,
    chargedAmount: session.amount_total ? session.amount_total / 100 : 0,
    chargedCurrency: session.currency,
    metadata: session.metadata || {},
    paymentIntentId: typeof session.payment_intent === 'object' ? session.payment_intent?.id : session.payment_intent,
  };
}

// Attach a PaymentMethod (already tokenized in browser via PaymentElement +
// stripe.createPaymentMethod()) to the user's Stripe customer + DB.
// Browser uses Elements deferred mode with paymentMethodCreation:'manual'.
export async function attachPaymentMethodToUser(paymentMethodId, userRow, makeDefault = false) {
  if (!stripe) throw new Error('Stripe not configured');
  if (!paymentMethodId) throw new Error('paymentMethodId required');

  // Make sure the user has a Stripe customer.
  const customer = await getOrCreateStripeCustomer(userRow);

  // Attach (idempotent).
  let pm;
  try {
    pm = await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
  } catch (e) {
    // If it's already attached to this customer, just retrieve it.
    if (e.code === 'resource_already_exists' || /already been attached/i.test(e.message || '')) {
      pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    } else {
      throw e;
    }
  }
  const card = pm.card || {};

  const want = !!makeDefault;
  const existing = await q(
    `SELECT COUNT(*)::int AS c FROM payment_methods WHERE user_id = $1`,
    [userRow.id],
  );
  const isDefault = want || existing.rows[0].c === 0;
  if (isDefault) {
    await q(`UPDATE payment_methods SET is_default = false WHERE user_id = $1`, [userRow.id]);
    try {
      await stripe.customers.update(customer.id, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } catch { }
  }

  const ins = await q(
    `INSERT INTO payment_methods
       (user_id, brand, last4, exp_month, exp_year, cardholder, is_default, stripe_pm_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, brand, last4, exp_month, exp_year, cardholder, is_default, stripe_pm_id, created_at`,
    [
      userRow.id,
      (card.brand || 'card').replace(/^./, (c) => c.toUpperCase()),
      card.last4 || '',
      card.exp_month || null,
      card.exp_year || null,
      pm.billing_details?.name || null,
      isDefault,
      paymentMethodId,
    ],
  );
  return ins.rows[0];
}
