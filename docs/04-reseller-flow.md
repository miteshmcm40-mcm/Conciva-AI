# 04 — Reseller Flow

A reseller is a white-label operator. The superadmin creates it; it then runs its own branded portal, sets its own prices, builds a sub-reseller network, and serves its own customer base.

- **`user_type`:** `reseller`
- **`reseller_portal`:** the reseller's unique domain slug (e.g. `acme.io`)
- **`reseller_id`:** `NULL` (a reseller has no parent)
- **Lands on:** `/reseller`
- **Dashboard shell:** `src/surfaces/reseller/Reseller.jsx`
- **API namespace:** `/api/reseller/*` (guarded by `requireReseller`)

---

## 1. The Reseller dashboard

Four tabs:

| Tab | File | Purpose |
|-----|------|---------|
| **Customers** | `Customers.jsx` | Every customer attributed to this reseller (and its sub-resellers). |
| **Purchases** | `Purchases.jsx` | The transaction/plan-purchase ledger for those customers. |
| **Plans** | `Plans.jsx` | The reseller's own **branded** plan catalog — edit label, price, rate, minutes, agents. |
| **Sub-Resellers** | `SubResellers.jsx` | Create and manage sub-resellers under this reseller. |

---

## 2. How a reseller gets customers

A reseller doesn't manually create customers one by one. Customers arrive through the reseller's **portal slug**:

```
Customer visits acme.io marketing site
      │
      ▼
Completes signup + payment (Razorpay checkout)
      │  payload carries resellerPortal = "acme.io"
      ▼
Backend looks up the reseller WHERE reseller_portal = 'acme.io'
      │
      ▼
New user created with reseller_id = <acme reseller's id>, user_type = 'user'
      │
      ▼
Appears in the reseller's Customers tab
```

- `GET /api/reseller/customers` — lists all users with `reseller_id` = the calling reseller's id. This includes customers acquired directly **and** customers created by the reseller's sub-resellers, depending on how the query attributes them.
- The reseller sees each customer's plan, numbers, and wallet status.

---

## 3. Branded plans — the reseller's pricing power

Each reseller owns a copy of the three base tiers (auto-seeded when the superadmin created the reseller). The reseller can re-price and re-label each one.

- `GET /api/reseller/plans` — the reseller's branded catalog (one entry per base tier: `starter`, `growth`, `scale`).
- `PATCH /api/reseller/plans/:basePlanId` — edit a tier's `label`, `amount`, `rate` (per-minute), `min` (included minutes), `agents`, `currency`, and `is_active`.

```
Base plan (superadmin)        Reseller override (acme.io)
─────────────────────         ───────────────────────────
Growth  ₹8,799  800min        "Acme Pro"  ₹9,999  900min
                              rate ₹13/min  10 agents  active
```

**Customers of a reseller see the reseller's branded prices, never the base prices.** This is the heart of the white-label model: the reseller buys capacity at the platform's cost structure and resells at its own markup.

The catalog is stored in the `reseller_plans` table, unique per `(reseller_id, base_plan_id)`.

---

## 4. Creating sub-resellers

A reseller can extend its reach by creating sub-resellers — downstream partners who in turn bring in customers.

- `GET /api/reseller/sub-resellers` — list the sub-resellers this reseller created.
- `POST /api/reseller/sub-resellers` — create one.

**What happens server-side:**
- A new `users` row is created with `user_type = 'sub-reseller'`.
- `reseller_id` is set to the **calling reseller's** id (so the parent link is recorded).
- The sub-reseller gets its own `reseller_portal` slug and signs in to the same `/reseller` dashboard, but with data scoped to itself.

Sub-resellers inherit the parent reseller's plan catalog rather than owning a separate base catalog. See [05-sub-reseller-flow.md](05-sub-reseller-flow.md).

---

## 5. Purchases & revenue visibility

- `GET /api/reseller/purchases` — wallet transactions and plan history **filtered to this reseller's customers** (`WHERE c.reseller_id = $1`).
- The reseller sees signups, top-ups, and number rentals from its customer base — but **not** other resellers' transactions and **not** the global platform ledger.

This gives a reseller a clear view of its own book of business without exposing platform-wide data.

---

## 6. What a reseller cannot do

- Cannot see or touch other resellers' customers, sub-resellers, or revenue.
- Cannot edit system credentials (Twilio, Razorpay, MCP, SMTP) — those are superadmin-only.
- Cannot change the **base** plan catalog (only its own branded copy).
- Cannot manage the global DID inventory.
- Cannot create other resellers (only sub-resellers).

---

## 7. Reseller journey (end to end)

```
1. Superadmin creates the reseller → reseller receives credentials + portal slug
2. Reseller signs in at /signin → lands on /reseller
3. Plans tab: customize the branded catalog
   (rename tiers, set prices, per-minute rates, included minutes, agent counts)
4. Sub-Resellers tab (optional): create sub-resellers to expand the network
5. Point the reseller's marketing site / signup flow at the portal slug
   → customers signing up there are auto-attributed to the reseller
6. Customers tab: watch customers arrive, see their plans + numbers
7. Purchases tab: track revenue from the customer base
8. Ongoing: customers self-serve numbers, agents, and billing in /dashboard
```

---

## 8. Reseller endpoint summary

| Method & path | Purpose |
|---------------|---------|
| `GET /api/reseller/customers` | List the reseller's customers |
| `GET /api/reseller/purchases` | Transaction/plan ledger for those customers |
| `GET /api/reseller/plans` | The reseller's branded plan catalog |
| `PATCH /api/reseller/plans/:basePlanId` | Edit a branded plan tier |
| `GET /api/reseller/sub-resellers` | List sub-resellers |
| `POST /api/reseller/sub-resellers` | Create a sub-reseller |

All require a valid session **and** `user_type === 'reseller'` (the `requireReseller` guard), and are internally scoped to the calling reseller's id.
