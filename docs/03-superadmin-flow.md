# 03 — Superadmin Flow

The superadmin is the platform owner. It has global visibility, manages all resellers, owns the DID inventory and the base plan catalog, and controls every system credential.

- **`user_type`:** `superadmin` (also `role = 'admin'`)
- **Lands on:** `/admin`
- **Dashboard shell:** `src/surfaces/admin/Admin.jsx`
- **API namespace:** `/api/admin/*` (guarded by `requireAdmin`)

---

## 1. The Admin dashboard

The admin shell organizes tabs into three groups:

```
OPERATIONS                REPORTS              SETUP
──────────                ───────              ─────
Signups                   Usage Analytics      Plans & Pricing
Customers                 System Health        Settings
Resellers                 MCP Browser
Numbers (inventory)
Payments & Revenue
Bulk Import
Activity Logs
```

| Tab | File | Purpose |
|-----|------|---------|
| Signups | `Signups.jsx` | Pending / recent signups, attribution, status. |
| Customers | `Customers.jsx` | Every customer across every reseller, with their numbers and plans. |
| Resellers | `Resellers.jsx` | All resellers + their sub-resellers and customer counts; create new resellers. |
| Numbers | `Numbers.jsx` | The DID inventory — add/remove numbers available for sale. |
| Payments | `Payments.jsx` | Global revenue and the wallet-transaction ledger. |
| Bulk | (bulk import) | Bulk operations / imports. |
| Logs | `Logs.jsx` | Activity / provisioning logs. |
| Usage | — | Aggregated usage analytics. |
| Health | — | Service health (Twilio, MCP, DB). |
| MCP | — | Browse/inspect MCP (agent runtime) state. |
| Plans | `Plans.jsx` | The base plan catalog that resellers customize. |
| Settings | `Settings.jsx` | All system credentials and tunables. |

---

## 2. Creating a reseller (the core superadmin action)

**Endpoint:** `POST /api/admin/resellers`

**Required fields:**
- `name`, `company`, `email`, `username`, `password`, `phone`
- `resellerPortal` — the white-label domain slug (must be unique; e.g. `acme.io`)
- `kycAddress`, `kycLocation` — KYC details

**What happens server-side:**
1. A new `users` row is created with `user_type = 'reseller'`, `reseller_id = NULL`, and the given `reseller_portal`.
2. The reseller's **branded plan catalog** is auto-seeded — one `reseller_plans` row per base tier (`starter`, `growth`, `scale`), copying the base label/amount/rate/min/agents so the reseller can then customize.
3. Optionally the reseller's MCP endpoint (`mcp_url` / `mcp_token`) is set so their agents provision against their own runtime.

After creation the reseller can sign in at `/reseller` and start onboarding sub-resellers and customers. See [04-reseller-flow.md](04-reseller-flow.md).

### Viewing resellers
- `GET /api/admin/resellers` — lists all resellers with sub-reseller and customer counts.
- `GET /api/admin/resellers/:id/customers` — drills into one reseller's customer base.

---

## 3. Managing customers globally

- `GET /api/admin/users` — every user across the platform, joined with their DIDs and reseller attribution. This is the master customer/user list.
- `DELETE /api/admin/users/:id` — delete a user (and their associated rows).
- `POST /api/admin/provision/:userId` — (re)provision the voice agent for a specific user — used when a signup's automatic provisioning failed and needs a manual retry.

---

## 4. Number (DID) inventory

The superadmin owns the pool of phone numbers customers can buy.

- `GET /api/admin/numbers` — the current DID inventory.
- `POST /api/admin/numbers` — add numbers to inventory (manual DIDs or from a Twilio search).
- `DELETE /api/admin/numbers/:value` — remove a number from inventory.

Numbers can come from two sources: **manual DIDs** (configured directly) and **Twilio API lookups** (`GET /api/twilio/available-numbers` searches by country/region). A configurable **markup multiplier** (default 2.5×) is applied to the underlying Twilio cost before the number is shown for sale, and amounts are converted to INR using the `USD_INR` rate.

---

## 5. Payments & revenue

- `GET /api/admin/stats` — aggregated metrics (total users, revenue, etc.).
- The Payments tab reads the global `wallet_transactions` ledger: every signup charge, top-up, and number rental across all resellers, each with `kind`, `amount_usd`, `minutes_delta`, status, and an idempotent `external_ref`.

Because the superadmin sees the **unfiltered** ledger, this is the source of truth for platform-wide revenue; resellers only see the subset belonging to their own customers.

---

## 6. The base plan catalog (Plans tab)

The superadmin defines the **canonical** plan catalog in `server/plans.js`. These three tiers are the template every reseller's branded catalog is seeded from:

| Plan | Monthly | Minutes | Overage rate | Agents | DIDs | Concurrency |
|------|---------|---------|--------------|--------|------|-------------|
| **Starter** | ₹2,999 | 250 | ₹12/min | 2 | 1 | 3 |
| **Growth** *(most popular)* | ₹8,799 | 800 | ₹11/min | 10 | 3 | 12 |
| **Scale** | ₹29,999 | 3,000 | ₹10/min | unlimited | 15 | 40 |

- **Yearly billing** applies a 20% discount (`plan_cycle = 'yearly'`).
- Resellers cannot change the base catalog — they override their own copy. See [09-billing-and-plans.md](09-billing-and-plans.md).

---

## 7. System settings (the Settings tab)

**Endpoints:** `GET /api/admin/settings` (secrets returned **masked**), `PATCH /api/admin/settings`.

Editable settings include:

| Group | What it controls |
|-------|-----------------|
| Twilio | Account SID, auth token, number search/provisioning |
| Razorpay | Key id, key secret, webhook secret |
| MCP / Agent runtime | Default MCP URL + token (per-reseller overrides live on the reseller row) |
| SMTP / Email | Host, port, user, password, from-address |
| Number pricing | Markup multiplier (default 2.5×), USD→INR rate |
| SIP | Gateway IP allowed to send inbound calls |
| Misc | LLM keys, webhook secrets, thresholds |

Settings are persisted to the `settings` table (`key`, `value`, `is_secret`, `updated_by`, `updated_at`). Secret values are masked on read so the auth token / key secret are never echoed back in full.

---

## 8. Superadmin journey (end to end)

```
1. Sign in at /signin  →  lands on /admin
2. Configure system credentials in Settings
   (Twilio, Razorpay, MCP, SMTP, markup, SIP gateway)
3. Seed the DID inventory in Numbers
4. Define / review the base plan catalog in Plans
5. Create resellers in Resellers tab
   → each reseller's branded catalog is auto-seeded
6. Monitor:
   - Signups        (who's joining)
   - Customers      (everyone, across all resellers)
   - Payments       (global revenue ledger)
   - Usage / Health (analytics + service status)
   - Logs           (provisioning + activity)
7. Step in when needed:
   - Re-provision a failed agent  (POST /api/admin/provision/:userId)
   - Delete a user                (DELETE /api/admin/users/:id)
   - Manage inventory             (add/remove DIDs)
```

---

## 9. Admin endpoint summary

| Method & path | Purpose |
|---------------|---------|
| `GET /api/admin/users` | All users + DIDs + attribution |
| `DELETE /api/admin/users/:id` | Delete a user |
| `GET /api/admin/resellers` | All resellers + sub-resellers + counts |
| `POST /api/admin/resellers` | Create a reseller |
| `GET /api/admin/resellers/:id/customers` | Customers under one reseller |
| `GET /api/admin/numbers` | DID inventory |
| `POST /api/admin/numbers` | Add DIDs to inventory |
| `DELETE /api/admin/numbers/:value` | Remove a DID |
| `GET /api/admin/settings` | Read settings (secrets masked) |
| `PATCH /api/admin/settings` | Update settings |
| `GET /api/admin/stats` | Aggregated platform metrics |
| `POST /api/admin/provision/:userId` | (Re)provision a user's agent |

All require a valid session **and** `role === 'admin'` (the `requireAdmin` guard).
