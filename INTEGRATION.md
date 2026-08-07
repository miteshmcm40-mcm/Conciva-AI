# 9278.io Voice Agent Portal — Website Integration Guide

This document explains how to drive **signup, plan-fetch, and payment** from
an external marketing/landing site (any framework, any host) into the
[voice.9278.io](https://voice.9278.io) portal — using only public REST endpoints.

**Base URL:** `https://voice.9278.io`

**CORS:** wide-open (`Access-Control-Allow-Origin: *`). Any origin can fetch.

**Auth:** none required for the public catalog + signup-order endpoints. After
signup completes, the customer receives a 30-day bearer token they use to
manage their account from the portal.

---

## 1 · Fetch live plans

`GET /api/plans` returns the current plan catalog. Render this on your marketing
site so prices stay in sync with what the portal charges — no scraping or hardcoding.

```bash
curl https://voice.9278.io/api/plans
```

**Response:**
```json
{
  "plans": [
    {
      "id": "scale",
      "label": "Scale",
      "amount": 30000,              // monthly price in ₹
      "min": 3000,                  // included minutes per month
      "rate": 10,                   // effective ₹/min
      "overage": 10,                // overage ₹/min
      "dids": 15,                   // included phone numbers (DIDs)
      "concurrent": 40,
      "agents": 999,                // 999 = "Unlimited"
      "voiceStack": "Realtime + premium voices",
      "support": "Dedicated + SLA",
      "tag": null,                  // "MOST POPULAR" on Growth
      "sub": "High-volume call centers.",
      "perks": [ "Unlimited AI voice agents", ... ],
      "yearlyAmount": 288000,       // 12 months at 20% off
      "yearlySavingsInr": 72000
    },
    /* growth, starter ... */
  ],
  "yearlyDiscountPercent": 20,
  "perDidPriceInr": 400,             // cost of each additional DID
  "currency": "INR"
}
```

---

## 2 · Start a signup → create a Razorpay order

`POST /api/razorpay/order/signup` validates the signup payload, stashes it as a
pending signup, and returns a Razorpay order to pay.

```bash
curl -X POST https://voice.9278.io/api/razorpay/order/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name":       "Acme Industries",
    "company":    "Acme",
    "username":   "acme",
    "email":      "ceo@acme.co",
    "phone":      "+919876543210",
    "password":   "MinimumEightChars",

    "planLabel":  "Growth",
    "planAmount": 8800,
    "planMin":    800,
    "planRate":   11,
    "planAgents": 10,
    "planCycle":  "monthly",          // or "yearly"

    "number":      "+918037683048",   // must be in the available pool
    "numberLoc":   "Bangalore",
    "numberPrice": 0,                 // 0 for first number (included in plan)

    "voice":     "Kore",
    "language":  "en-IN",             // BCP-47, see /api/plans below
    "agentName": "Acme Receptionist",
    "greeting":  "Hi, you have reached Acme. How can I help?",
    "prompt":    "You are the AI receptionist for Acme...",
    "kbCompany": "Acme makes industrial widgets...",
    "kbFaqs":    "Q: What are your hours? A: ..."
  }'
```

**Response:**
```json
{
  "orderId":      "order_NxxxxxYY",   // Razorpay order id
  "amount":       880000,             // in paise (₹8,800)
  "currency":     "INR",
  "keyId":        "rzp_live_...",     // safe to embed on frontend
  "pendingToken": "abc123...",        // pass this to /api/razorpay/verify later
  "prefill": { "name": "...", "email": "...", "contact": "+91..." }
}
```

The full payload above mirrors what the SPA's signup flow sends.

### Required fields
| Field | Notes |
|---|---|
| `name`, `company`, `username`, `email`, `password` | Auth — `password` minimum 8 chars |
| `planLabel`, `planAmount`, `planMin` | Pulled from `GET /api/plans` |
| `number`, `numberPrice` | From the available pool (see § 4) |

### Optional but recommended
`planRate`, `planAgents`, `planCycle`, `phone`, `voice`, `language`,
`agentName`, `greeting`, `prompt`, `kbCompany`, `kbFaqs`.

### Available numbers
List the DID pool with `GET /api/twilio/available-numbers?country=IN`.

---

## 3 · Open Razorpay checkout + verify

Once you have the `orderId` + `keyId`, open the Razorpay Checkout modal from
the customer's browser using Razorpay's standard JS SDK:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
const order = /* response from /api/razorpay/order/signup */;
const rzp = new Razorpay({
  key:         order.keyId,
  order_id:    order.orderId,
  amount:      order.amount,
  currency:    order.currency,
  name:        '9278.io',
  description: 'Voice Agent Portal — Growth plan',
  image:       'https://voice.9278.io/favicon.png',
  prefill:     order.prefill,
  theme:       { color: '#0ea5e9' },
  handler: async (rzpResponse) => {
    // Verify the payment on the portal — this creates the user and returns
    // a 30-day auth token.
    const r = await fetch('https://voice.9278.io/api/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pendingToken:        order.pendingToken,
        razorpay_order_id:   rzpResponse.razorpay_order_id,
        razorpay_payment_id: rzpResponse.razorpay_payment_id,
        razorpay_signature:  rzpResponse.razorpay_signature,
      }),
    }).then((res) => res.json());

    if (r.token) {
      // Redirect the customer to the portal already signed-in.
      // The portal reads ?token= from URL and establishes a session.
      window.location = 'https://voice.9278.io/dashboard/overview?token=' + r.token;
    } else {
      alert('Payment verification failed: ' + (r.error || 'unknown'));
    }
  },
});
rzp.open();
</script>
```

`POST /api/razorpay/verify` response:
```json
{
  "token": "30-day-bearer-token-...",
  "user":  { "id": "3", "email": "...", "plan": { ... }, "number": { ... } }
}
```

The portal also runs provisioning (SIP trunk + dispatch rule + voice agent) as
a background task immediately after `/api/razorpay/verify` returns — so by the
time the customer lands on the dashboard their number is live.

---

## 4 · Helpers

### Available numbers
```bash
curl 'https://voice.9278.io/api/twilio/available-numbers?country=IN'
```
Returns the unattached DIDs in the pool with their price (`priceInr`).

### Razorpay public config
```bash
curl https://voice.9278.io/api/razorpay/config
```
Returns `{ configured: true, keyId: "rzp_live_..." }`.

### Webhook
The portal already exposes `POST /api/razorpay/webhook` for Razorpay-side
event delivery. Configure your shared webhook (in Razorpay Dashboard →
Webhooks) to point at `https://voice.9278.io/api/razorpay/webhook` if you
manage payments centrally — events: `payment.captured`, `payment.failed`,
`order.paid`.

---

## 5 · Drop-in HTML example

A working, self-contained signup form is hosted at
`https://voice.9278.io/embed/signup.html`. Inspect or iframe it on your
marketing site:

```html
<iframe
  src="https://voice.9278.io/embed/signup.html"
  width="100%"
  height="900"
  frameborder="0"
></iframe>
```

Or copy the source from [`public/embed/signup.html`](public/embed/signup.html)
into your own site and re-style as you wish — the API calls don't need any
secret keys on the frontend.

---

## 6 · Errors

All endpoints return `{ "error": "..." }` with a non-2xx status when something
goes wrong. Common cases:

| Status | Meaning |
|---|---|
| 400 | Missing required field, invalid email, password too short, total ≤ 0 |
| 409 | Email or username already exists |
| 503 | Razorpay not configured (server misconfiguration) |
| 502 | Razorpay or downstream call failed |

---

## 7 · Sandbox vs live

The portal currently uses **live** Razorpay keys (`rzp_live_...`). For testing,
swap `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in the portal's `.env` to your
test keys — `GET /api/razorpay/config` will then return the test key id, and
your marketing site will pick it up automatically.

---

## 8 · Support

- Portal: [voice.9278.io](https://voice.9278.io)
- API docs: this file
- Dashboard (runtime / call data): [dashboard.9278.io](https://dashboard.9278.io)
- Issues: voice@9278.io
