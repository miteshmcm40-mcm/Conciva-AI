# 09 — Billing & Plans

How money and minutes work across the platform: the plan catalog, the per-minute wallet, top-up packs, auto-topup, Razorpay payment flows, and how revenue rolls up the reseller hierarchy.

References: `server/plans.js`, `server/wallet.js`, `server/razorpay.js`, `server/index.js`.

---

## 1. The plan catalog

The superadmin defines the canonical catalog (`server/plans.js`). Three tiers:

| Plan | Monthly | Included min | Overage | Agents | DIDs | Concurrency |
|------|---------|--------------|---------|--------|------|-------------|
| **Starter** | ₹2,999 | 250 | ₹12/min | 2 | 1 | 3 |
| **Growth** *(most popular)* | ₹8,799 | 800 | ₹11/min | 10 | 3 | 12 |
| **Scale** | ₹29,999 | 3,000 | ₹10/min | unlimited | 15 | 40 |

- **Billing cycles:** `monthly` or `yearly`. Yearly applies a **20% discount**.
- **Plan ids:** `starter`, `growth`, `scale` (used as `plan_id` on `user_numbers` and `base_plan_id` on `reseller_plans`).

### Reseller branding
Each reseller owns a `reseller_plans` row per tier and can override `label`, `amount`, `rate`, `min`, `agents`, `currency`, and `is_active`. **Customers always see their reseller's branded prices**, not the base prices. The base catalog is the template; resellers resell at their own markup.

---

## 2. The wallet (minutes model)

Usage is metered in **minutes**. The flow:

```
Call minutes consumed
        │
        ▼
1. Draw from the plan's monthly included minutes (plan_min)
        │  exhausted?
        ▼
2. Draw from wallet minutes (bought via top-up packs)
        │  below low_balance_threshold?
        ▼
3. Auto-topup (if enabled + saved card) recharges a pack
```

Wallet state lives on the `users` row: `minutes_used`, `wallet_minutes`, `wallet_usd`, `low_balance_threshold` (default 20), `auto_topup_enabled`, `auto_topup_pack_min`, `auto_topup_pack_usd`.

---

## 3. Top-up packs

Defined in `server/wallet.js`. Effective rate ~₹4/min:

| Pack | Minutes | Effective rate |
|------|---------|----------------|
| ₹500 | 125 | ₹4/min |
| ₹1,000 | 250 | ₹4/min |
| ₹2,000 | 500 | ₹4/min |
| ₹5,000 | 1,250 | ₹4/min |

Fetched via `GET /api/wallet/packs`; purchased via the Razorpay top-up flow.

---

## 4. Auto-topup

When a customer enables auto-topup and has a saved card:
- The system watches the wallet balance.
- When it drops below `low_balance_threshold` **and** plan minutes are spent, it charges the chosen pack (`auto_topup_pack_min` / `auto_topup_pack_usd`) automatically.
- The charge uses the saved Razorpay card token (`payment_method_token`) and is logged in `wallet_transactions`.

Configured via `PATCH /api/wallet/preferences`. The saved card is set up with `POST /api/razorpay/order/save-card` → `POST /api/razorpay/verify/save-card`, and removed with `DELETE /api/payment-method`.

---

## 5. Razorpay payment flows

Every payment is **two-step**: create an order, let the browser complete the Razorpay checkout, then verify the signature server-side and apply the effect. Razorpay (not Stripe — Stripe has been removed) is the gateway; `server/razorpay.js` handles order creation, signature verification, and webhook validation.

| Flow | Order endpoint | Verify endpoint | Effect |
|------|----------------|-----------------|--------|
| **Signup** | `POST /api/razorpay/order/signup` | `POST /api/razorpay/verify` | Create user, attribute reseller, provision DID + agent |
| **Top-up** | `POST /api/razorpay/order/topup` | `POST /api/razorpay/verify/topup` | Add pack minutes to wallet |
| **Save card** | `POST /api/razorpay/order/save-card` | `POST /api/razorpay/verify/save-card` | Store card token (masked) |
| **Change plan** | `POST /api/razorpay/order/number-plan` | `POST /api/razorpay/verify/number-plan` | Change a DID's plan |
| **New number + plan** | `POST /api/razorpay/order/new-number-plan` | `POST /api/razorpay/verify/new-number-plan` | Buy a new DID + plan |

A **webhook** (`POST /api/razorpay/webhook`) also receives async events (`payment.captured`, `payment.failed`, etc.), signature-verified before processing.

### Idempotency
Each finalize writes a `wallet_transactions` row with a **unique `external_ref`**. If the same payment is verified twice (retry, duplicate webhook), the unique constraint prevents the side effect from being applied a second time — no double-charging, no double-crediting.

---

## 6. Number pricing

DIDs carry their own cost on top of plans:
- Underlying Twilio cost × a configurable **markup multiplier** (default **2.5×**, set in Settings).
- Converted to INR using the `USD_INR` rate (env, default 95).
- Numbers come from the `did_inventory` pool (manual DIDs) and/or live Twilio search (`GET /api/twilio/available-numbers`).

---

## 7. Revenue visibility up the hierarchy

The `wallet_transactions` ledger is the single source of truth. Visibility is scoped by role:

| Role | Sees |
|------|------|
| Superadmin | **All** transactions, platform-wide (Payments tab) |
| Reseller | Transactions of its own customers (`WHERE reseller_id = caller`) |
| Sub-Reseller | Transactions of its own customers only |
| User | Its own transactions (Billing tab) |

Each transaction's `kind` (`signup` / `topup` / `number_rental`), `amount_usd`, `minutes_delta`, and `status` let every tier reconstruct its book of business at the right scope.

---

## 8. Lifecycle summary

```
Signup payment      → user created + DID/agent provisioned + signup txn logged
Monthly usage       → plan minutes consumed first
Overage             → wallet minutes consumed at the plan's per-minute rate
Low balance         → auto-topup pack charged (if enabled) → topup txn logged
Add/upgrade number  → number_plan payment → DID provisioned → number_rental txn
All charges         → wallet_transactions with unique external_ref (idempotent)
Revenue rollup      → user → reseller → superadmin views, each scoped by reseller_id
```
