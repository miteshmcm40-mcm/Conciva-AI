# 02 — Roles & Permissions

The portal has a strict four-tier hierarchy. This document defines each tier, what it can and cannot do, and exactly how access is enforced on both the backend and the frontend.

---

## 1. The four tiers

| Tier | `user_type` | `role` | `reseller_id` | `reseller_portal` |
|------|------------|--------|---------------|-------------------|
| **Superadmin** | `superadmin` | `admin` | `NULL` | `NULL` |
| **Reseller** | `reseller` | `customer` | `NULL` | their portal slug (unique) |
| **Sub-Reseller** | `sub-reseller` | `customer` | parent reseller's `id` | a portal slug |
| **User (Customer)** | `user` | `customer` | their reseller/sub-reseller's `id` | `NULL` |

`user_type` is the **canonical** role field. `role` (`admin`/`customer`) is a legacy field kept for backward compatibility — only the superadmin has `role = 'admin'`.

---

## 2. What each tier can do

### Superadmin
- Global owner of the platform. Sees **every** user, reseller, sub-reseller, customer, number, and payment.
- Creates **resellers** (`POST /api/admin/resellers`).
- Manages the DID inventory (add/remove numbers).
- Edits all **system credentials and settings** (Twilio, Razorpay, MCP, SMTP, markup, etc.).
- Defines the **base plan catalog** (Starter / Growth / Scale) that resellers customize.
- Can provision an agent for any user, delete any user, view all stats and logs.

### Reseller
- White-label operator with their own portal slug and branded plan catalog.
- Creates **sub-resellers** (`POST /api/reseller/sub-resellers`).
- Acquires **customers** — anyone who signs up through their portal slug is attributed to them.
- Edits their **own branded plans** (label, price, per-minute rate, minutes, agent count, currency) per base tier.
- Views their customers, the purchases/transactions of those customers, and their sub-resellers.
- **Cannot** see other resellers' data, cannot touch system credentials, cannot define base plans.

### Sub-Reseller
- A reseller's downstream partner. Uses the **same dashboard shell** as a reseller but with **narrower data scope** — sees only its own customers.
- Creates **customers**.
- Inherits the parent reseller's plan catalog (does not own a separate base catalog).
- Cannot create further sub-resellers (the hierarchy is two levels of reseller deep).
- Cannot see the parent's other customers or other sub-resellers.

### User (Customer)
- The end customer who actually buys numbers and uses voice agents.
- Manages **their own** numbers, agents, knowledge base, calls, recordings, billing, and account.
- Sees only their own data. Cannot create any other accounts.

---

## 3. Backend enforcement (middleware)

All authenticated routes pass through the `auth` middleware first (validates the session token, attaches `req.user`). Role-restricted routes then add one of:

```js
// Superadmin only — checks the legacy role flag
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Reseller — checks the canonical user_type
const requireReseller = (req, res, next) => {
  if (!req.user || req.user.user_type !== 'reseller') {
    return res.status(403).json({ error: 'Reseller access required' });
  }
  next();
};
```

- `/api/admin/*` routes are guarded by **`requireAdmin`**.
- `/api/reseller/*` routes are guarded by **`requireReseller`**.
- Customer routes (`/api/numbers`, `/api/wallet`, `/api/twilio/calls`, etc.) require only `auth` — they are implicitly scoped to `req.user.id`, so a user can only ever read or mutate their own rows.

### Data scoping inside reseller routes
Reseller endpoints additionally filter by the caller's id, e.g. customers are fetched with `WHERE c.reseller_id = $1` where `$1 = req.user.id`. This is what keeps a reseller (or sub-reseller) from seeing anyone else's customers even though they share the same route.

---

## 4. Frontend enforcement (route guards)

`src/App.jsx` maps each tier to a landing page and wraps route groups in a `RequireAuth` guard that only admits certain `userType`s:

```js
const homeFor = (user) => {
  if (!user) return '/signin';
  if (user.userType === 'superadmin' || user.role === 'admin') return '/admin';
  if (user.userType === 'reseller') return '/reseller';
  return '/dashboard';
};

// Route groups:
<RequireAuth allow={new Set(['user', 'superadmin'])}>      → /dashboard/*
<RequireAuth allow={new Set(['reseller', 'superadmin'])}>  → /reseller/*
<RequireAuth allow={new Set(['superadmin'])}>              → /admin/*
```

Notes:
- The **superadmin** is allowed into every route group (it appears in all `allow` sets), so it can inspect any surface.
- A **sub-reseller** reaches `/reseller/*` the same way a reseller does; the difference is purely in the data the backend returns to it.
- These guards are a UX convenience. The **authoritative** check is always the backend middleware — the frontend never receives data the backend wouldn't hand it.

---

## 5. Who creates whom

```
Superadmin  ──creates──▶  Reseller
Reseller    ──creates──▶  Sub-Reseller
Reseller    ──acquires─▶  User (direct signups on the reseller's portal)
Sub-Reseller──creates──▶  User
(no portal) ──auto──────▶  attached to the 9278.io reseller as a User
```

- **Superadmin → Reseller:** `POST /api/admin/resellers`. Requires name, company, email, username, password, phone, `resellerPortal` slug, and KYC address/location. On creation the reseller's branded plan catalog is auto-seeded from the base plans.
- **Reseller → Sub-Reseller:** `POST /api/reseller/sub-resellers`. Sets the new account's `reseller_id` to the calling reseller's id and `user_type = 'sub-reseller'`.
- **Reseller / Sub-Reseller → User:** users are created when they complete signup + payment on the reseller's marketing portal; they are attributed via the `resellerPortal` slug.
- **Default attribution:** any signup without a portal slug is routed to the canonical `9278.io` reseller by the `set_default_reseller_id` database trigger.

---

## 6. Visibility matrix

| Viewer ↓ / Data → | All resellers | Own sub-resellers | Own customers | Other resellers' customers | System settings |
|---|---|---|---|---|---|
| Superadmin | ✅ | ✅ (all) | ✅ (all) | ✅ | ✅ |
| Reseller | ❌ | ✅ | ✅ | ❌ | ❌ |
| Sub-Reseller | ❌ | ❌ | ✅ | ❌ | ❌ |
| User | ❌ | ❌ | own data only | ❌ | ❌ |

---

## 7. Session & password security

- Sessions live in the `sessions` table keyed by a 64-char hex `token`, with `user_id`, `created_at`, and a 30-day `expires_at`.
- The `auth` middleware rejects a token if it is expired **or** if the user's `password_changed_at` is later than the session's `created_at`. So changing a password silently logs out every older session.
- `POST /api/signout` deletes the presented token; `POST /api/me/password` rotates `password_changed_at`.

See [07-data-model.md](07-data-model.md) for the exact session schema and triggers.
