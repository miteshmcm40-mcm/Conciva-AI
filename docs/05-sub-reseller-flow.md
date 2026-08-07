# 05 — Sub-Reseller Flow

A sub-reseller is a reseller's downstream partner. It is the third tier of the hierarchy: created by a reseller, it brings in and serves its own customers, but operates within the parent reseller's pricing and runtime.

- **`user_type`:** `sub-reseller`
- **`reseller_id`:** the **parent reseller's** `id` (this is what links it upward)
- **`reseller_portal`:** its own domain slug
- **Lands on:** `/reseller` (the same shell as a reseller)
- **API namespace:** `/api/reseller/*`

---

## 1. Same dashboard, narrower scope

A sub-reseller uses the **exact same** `/reseller` dashboard as a reseller — the same four tabs (Customers, Purchases, Plans, Sub-Resellers). The difference is entirely in the **data the backend returns**:

| | Reseller | Sub-Reseller |
|---|---|---|
| Customers tab | Own + sub-resellers' customers | Only its **own** customers |
| Purchases tab | Ledger for all its customers | Ledger for only its own customers |
| Plans tab | Edits its **own** branded catalog | Inherits the **parent** reseller's catalog |
| Sub-Resellers tab | Can create sub-resellers | Cannot create further sub-resellers |

Because every `/api/reseller/*` handler scopes its query to `req.user.id`, a sub-reseller automatically sees only the rows whose `reseller_id` points at it.

---

## 2. Where a sub-reseller sits in the hierarchy

```
Superadmin
   │ creates
   ▼
Reseller (acme.io)
   │ creates
   ▼
Sub-Reseller (partner.acme.io)   ← reseller_id = acme reseller's id
   │ creates
   ▼
User / Customer                  ← reseller_id = sub-reseller's id
```

The chain of `reseller_id` foreign keys records the full lineage: a customer points to its sub-reseller, and the sub-reseller points to its parent reseller.

---

## 3. How a sub-reseller is created

By the parent reseller via `POST /api/reseller/sub-resellers`:

- New `users` row with `user_type = 'sub-reseller'`.
- `reseller_id` = the creating reseller's id.
- Its own `reseller_portal` slug, KYC, and login credentials.

Once created, the sub-reseller signs in and is routed to `/reseller`.

---

## 4. How a sub-reseller gets customers

Identical mechanism to a reseller — through its **portal slug**:

```
Customer signs up on the sub-reseller's portal (partner.acme.io)
      │  payload carries resellerPortal = "partner.acme.io"
      ▼
Backend finds the user WHERE reseller_portal = 'partner.acme.io'
      │
      ▼
New customer created with reseller_id = <sub-reseller's id>
      │
      ▼
Appears in the sub-reseller's Customers tab
(and rolls up into the parent reseller's view)
```

---

## 5. Pricing — inherited, not owned

A sub-reseller does **not** own a separate base plan catalog. Its customers are served under the **parent reseller's** branded plans. This keeps pricing consistent across a reseller's whole network and prevents a sub-reseller from undercutting or repricing independently.

(The parent reseller is the one with editable `reseller_plans` rows; the sub-reseller reads them.)

---

## 6. What a sub-reseller cannot do

- Cannot create further sub-resellers (the reseller tree is two levels deep).
- Cannot see the parent reseller's other customers or sibling sub-resellers.
- Cannot edit the plan catalog (inherits the parent's).
- Cannot touch system credentials or the DID inventory.
- Cannot see any other reseller's data.

---

## 7. Sub-reseller journey (end to end)

```
1. Parent reseller creates the sub-reseller (POST /api/reseller/sub-resellers)
2. Sub-reseller signs in at /signin → lands on /reseller
3. Points its marketing/signup flow at its portal slug
4. Customers sign up there → attributed to the sub-reseller (reseller_id)
5. Customers tab: sees only its own customers
6. Purchases tab: revenue from its own customers
7. Customers are billed under the PARENT reseller's branded plans
```

---

## 8. Quick comparison: Reseller vs Sub-Reseller

| Capability | Reseller | Sub-Reseller |
|------------|----------|--------------|
| Created by | Superadmin | Reseller |
| `reseller_id` | `NULL` | parent reseller id |
| Owns plan catalog | ✅ | ❌ (inherits) |
| Create sub-resellers | ✅ | ❌ |
| Acquire customers via portal slug | ✅ | ✅ |
| Data scope | Own + sub-resellers' | Own only |
| Edit system settings | ❌ | ❌ |
