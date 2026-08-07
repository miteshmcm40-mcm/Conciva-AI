# 07 — Data Model

This document describes the PostgreSQL schema: every important table, the columns that matter for the four-tier hierarchy and the agent/billing features, the relationships between tables, and the triggers that enforce invariants.

Reference: `server/schema.sql` (canonical) and the idempotent migrations in `server/index.js` that run on boot.

---

## 1. Entity-relationship overview

```
                         ┌───────────────────────────────────────┐
                         │                users                  │
                         │  (superadmin / reseller / sub-reseller │
                         │   / user all live here)               │
                         └───────────────────────────────────────┘
        reseller_id (self-FK) ▲           │ id (PK)
        ───────────────────────┘           │
                                           ├──────────────┬─────────────┬───────────────┐
                                           ▼              ▼             ▼               ▼
                                  ┌─────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────────┐
                                  │ user_numbers│ │payment_methods│ │ sessions │ │wallet_transactions│
                                  │ (per DID)   │ │ (saved cards) │ │ (tokens) │ │   (ledger)        │
                                  └─────────────┘ └──────────────┘ └──────────┘ └──────────────────┘

   ┌──────────────┐    ┌────────────────┐    ┌───────────┐    ┌───────────────┐
   │reseller_plans│    │ pending_signups│    │ settings  │    │ did_inventory │
   │(per reseller)│    │ (checkout temp)│    │(admin cfg)│    │ (number pool) │
   └──────────────┘    └────────────────┘    └───────────┘    └───────────────┘
        reseller_id → users.id    resulting_user_id → users.id
```

---

## 2. `users` — the core entity

Every account, regardless of tier, is a row here. The most important columns:

### Identity & auth
| Column | Notes |
|--------|-------|
| `id` | Primary key |
| `name`, `company`, `phone` | Profile |
| `username` | Unique |
| `email` | Unique |
| `password_hash` | bcrypt hash (never returned) |
| `password_changed_at` | Bumped on password change → invalidates older sessions |
| `created_at`, `updated_at` | Timestamps |

### Role & hierarchy
| Column | Notes |
|--------|-------|
| `user_type` | **Canonical role**: `superadmin` / `reseller` / `sub-reseller` / `user` (default `user`) |
| `role` | Legacy: `admin` / `customer` (only superadmin = `admin`) |
| `reseller_id` | Self-FK to the parent reseller/sub-reseller (NULL for superadmin & top-level resellers) |
| `reseller_portal` | White-label domain slug, unique per portal (resellers/sub-resellers) |
| `kyc_address`, `kyc_location` | KYC details for resellers |

### Plan
| Column | Notes |
|--------|-------|
| `plan_label`, `plan_amount`, `plan_min`, `plan_rate`, `plan_agents` | Active plan snapshot |
| `plan_cycle` | `monthly` / `yearly` |
| `plan_activated_at`, `plan_expires_at` | Validity window |

### Phone / number
| Column | Notes |
|--------|-------|
| `number_value`, `number_loc`, `number_price` | The user's primary DID |
| `twilio_sid` | Twilio reference |

### Agent
| Column | Notes |
|--------|-------|
| `voice` | Gemini voice name |
| `agent_name`, `greeting`, `prompt` | Agent identity & behavior |
| `kb_company`, `kb_faqs` | Knowledge base |
| `language` | Agent language lock |
| `agent_id`, `agent_slug` | Runtime references |

### Wallet
| Column | Notes |
|--------|-------|
| `minutes_used`, `wallet_minutes`, `wallet_usd` | Usage & balance |
| `low_balance_threshold` | Auto-topup trigger (default 20) |
| `auto_topup_enabled`, `auto_topup_pack_min`, `auto_topup_pack_usd` | Auto-topup config |

### Payments (Razorpay)
| Column | Notes |
|--------|-------|
| `razorpay_customer_id` | Razorpay customer |
| `payment_method_token`, `payment_method_last4`, `payment_method_brand`, `payment_method_network` | Saved card (masked) |
| `stripe_customer_id` | Legacy (Stripe removed) |

### MCP / agent runtime
| Column | Notes |
|--------|-------|
| `mcp_url`, `mcp_token` | Per-reseller agent-runtime endpoint |

### Provisioning
| Column | Notes |
|--------|-------|
| `provisioning_status`, `provisioning_error` | Pipeline state |
| `livekit_trunk_id`, `livekit_dispatch_id`, `livekit_room_name` | LiveKit refs |
| `provisioned_at` | When provisioning completed |

---

## 3. `sessions` — auth tokens

| Column | Notes |
|--------|-------|
| `token` | PK — 64-char hex bearer token |
| `user_id` | FK → users.id (indexed) |
| `expires_at` | 30-day expiry |
| `created_at` | Compared against `users.password_changed_at` to invalidate old sessions |

---

## 4. `user_numbers` — per-DID configuration

One row per phone number a user owns. Lets each DID have its own agent and plan.

| Column | Notes |
|--------|-------|
| `id` | PK |
| `user_id` | FK → users.id |
| `number_value` | Unique DID |
| `label` | Friendly name |
| `is_primary` | One primary per user |
| `agent_id`, `agent_slug`, `agent_name`, `greeting`, `prompt`, `kb_company`, `kb_faqs`, `voice`, `language` | Per-DID agent config |
| `plan_id` | `starter` / `growth` / `scale` |
| `plan_cycle` | `monthly` / `yearly` |
| `auto_recharge_enabled` | Per-DID auto-recharge |
| `livekit_trunk_id`, `livekit_dispatch_id` | Runtime refs |
| `provisioning_status`, `provisioning_error`, `provisioning_ref`, `provisioned_at` | Pipeline state (`provisioning_ref` ties to the Razorpay payment) |
| `created_at`, `updated_at` | Timestamps |

---

## 5. `reseller_plans` — branded catalogs

Each reseller's customized copy of the base tiers. Unique per `(reseller_id, base_plan_id)`.

| Column | Notes |
|--------|-------|
| `id` | PK |
| `reseller_id` | FK → users.id (the reseller) |
| `base_plan_id` | `starter` / `growth` / `scale` |
| `label` | Branded name |
| `amount`, `rate`, `min`, `agents` | Branded pricing & limits |
| `currency` | `INR` / `USD` |
| `is_active` | Whether the tier is offered |

---

## 6. `wallet_transactions` — the money/minutes ledger

| Column | Notes |
|--------|-------|
| `id` | PK |
| `user_id` | FK → users.id |
| `kind` | `signup` / `topup` / `number_rental` |
| `minutes_delta` | Minutes added/removed |
| `amount_usd` | Charged amount |
| `description` | Human description |
| `payment_method_id` | FK → payment_methods.id |
| `status` | `success` / `failed` |
| `failure_reason` | If failed |
| `external_ref` | **Unique** — idempotency key (prevents double-charge) |
| `created_at` | Timestamp |

This ledger powers the superadmin Payments tab (global) and the reseller Purchases tab (filtered to `reseller_id`).

---

## 7. `payment_methods` — saved cards

| Column | Notes |
|--------|-------|
| `id` | PK |
| `user_id` | FK → users.id |
| `brand`, `last4`, `exp_month`, `exp_year`, `cardholder` | Masked card detail |
| `is_default` | Default card flag |
| `stripe_pm_id` | Legacy |
| `created_at` | Timestamp |

---

## 8. `pending_signups` — checkout staging

Holds the signup payload between starting a Razorpay order and verifying payment.

| Column | Notes |
|--------|-------|
| `id` | PK |
| `token` | Unique reference |
| `payload` | JSONB — the full signup data incl. `resellerPortal` |
| `consumed`, `consumed_at` | Whether it was finalized |
| `resulting_user_id` | FK → users.id (set after the user is created) |
| `stripe_session_id` | Legacy |
| `expires_at` | 1-day expiry |

---

## 9. `settings` — admin configuration

| Column | Notes |
|--------|-------|
| `key` | PK |
| `value` | Stored value |
| `is_secret` | Masked on read if true |
| `updated_by` | FK → users.id (the superadmin) |
| `updated_at` | Timestamp |

---

## 10. `did_inventory` — the number pool

DIDs added via the admin Numbers tab, available for customers to buy. Keyed by a unique `number_value` plus provisioning metadata and `created_at`.

---

## 11. Triggers & invariants

### Auto-attribution to the default reseller
```sql
CREATE TRIGGER trg_set_default_reseller_id
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION set_default_reseller_id();
```
If a new user is inserted **without** a `reseller_id`, the function looks up the reseller `WHERE user_type = 'reseller' AND LOWER(reseller_portal) = '9278.io'` and assigns it. This guarantees every customer belongs to some reseller.

### Password-change session invalidation
A trigger bumps `password_changed_at` whenever `password_hash` changes. The `auth` middleware then rejects any session whose `created_at` predates it — so a password change logs out all older sessions.

---

## 12. Relationship summary

| Relationship | Mechanism |
|--------------|-----------|
| Reseller → sub-reseller → user | `users.reseller_id` self-FK chain |
| Reseller → branded plans | `reseller_plans.reseller_id` |
| User → numbers | `user_numbers.user_id` (1:N) |
| User → saved cards | `payment_methods.user_id` (1:N) |
| User → ledger | `wallet_transactions.user_id` (1:N) |
| User → sessions | `sessions.user_id` (1:N) |
| Signup → user | `pending_signups.resulting_user_id` |
| Number ↔ Razorpay payment | `user_numbers.provisioning_ref` / `wallet_transactions.external_ref` |
