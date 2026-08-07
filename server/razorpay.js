// Razorpay integration. Replaces Stripe for the India launch.
// Flow:
//   1. Server creates an Order (amount in paise) → returns order_id.
//   2. Frontend opens Razorpay Checkout modal with that order_id.
//   3. Customer pays (UPI / cards / netbanking / wallets).
//   4. Razorpay returns payment_id + signature to the success handler.
//   5. Server verifies the HMAC signature and finalizes the signup.
import 'dotenv/config';
import crypto from 'crypto';
import Razorpay from 'razorpay';

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

export const razorpayConfigured = !!(KEY_ID && KEY_SECRET);
export const razorpayKeyId = () => KEY_ID || null;

const client = razorpayConfigured
  ? new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET })
  : null;

// amountInr accepts $ (e.g. 3999 for $3,999). Razorpay wants paise (×100).
export async function createOrder({ amountInr, receipt, notes = {} }) {
  if (!client) throw new Error('Razorpay not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  const paise = Math.round(Number(amountInr) * 100);
  if (!paise || paise < 100) throw new Error('Order amount must be at least $1');
  return client.orders.create({
    amount: paise,
    currency: 'USD',
    receipt: String(receipt || '').slice(0, 40),  // Razorpay limit: 40 chars
    notes,
    payment_capture: 1,
  });
}

// HMAC-SHA256 of `<order_id>|<payment_id>` with the key secret.
// Razorpay sends this `signature` back in the success handler — we MUST verify
// it server-side before treating the payment as legitimate.
export function verifyPaymentSignature({ order_id, payment_id, signature }) {
  if (!KEY_SECRET || !order_id || !payment_id || !signature) return false;
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${order_id}|${payment_id}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

// Webhook signature verification — Razorpay posts events to a configured URL
// and signs each event with the webhook secret (different from key secret).
export function verifyWebhookSignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

// Fetch a payment by id — used by the verify endpoint to double-check status
// before crediting the wallet.
export async function fetchPayment(paymentId) {
  if (!client) throw new Error('Razorpay not configured');
  return client.payments.fetch(paymentId);
}

// === Customer + saved-card helpers ===========================================
// Razorpay tokenises a customer's card when Checkout is opened with both a
// customer_id and `save: 1`. The customer_id has to exist beforehand, so we
// create one lazily the first time a portal user wants to save a card.

// Create a Razorpay customer for this user. Idempotent at the call-site:
// the caller checks the local DB first and only invokes this when no
// razorpay_customer_id is stored yet.
export async function createCustomer({ name, email, contact = '', notes = {} }) {
  if (!client) throw new Error('Razorpay not configured');
  return client.customers.create({
    name: String(name || '').slice(0, 50) || 'Customer',
    email: String(email || '').slice(0, 100),
    contact: String(contact || '').slice(0, 15),
    notes,
    fail_existing: '0',   // return existing customer if email+contact already match
  });
}

// Fetch a token (card) by id — Razorpay returns the card brand/last4/expiry
// stripped of the PAN, perfect for displaying "VISA ···· 1111" in the UI.
export async function fetchToken({ customerId, tokenId }) {
  if (!client) throw new Error('Razorpay not configured');
  return client.customers.fetchToken(customerId, tokenId);
}

// Delete a saved token from a Razorpay customer (called when the user clicks
// "Remove card" in the portal).
export async function deleteToken({ customerId, tokenId }) {
  if (!client) throw new Error('Razorpay not configured');
  return client.customers.deleteToken(customerId, tokenId);
}
