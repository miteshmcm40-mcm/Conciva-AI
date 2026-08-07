# 01 — System Architecture

This document describes how the Voice Agent Portal is put together: the services, how a request flows from the browser to the database and back, and how an AI voice agent is provisioned end to end.

---

## 1. High-level architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                            BROWSER (React SPA)                         │
│  src/surfaces/{admin, reseller, customer} + AppContext (auth state)    │
│  Token stored in localStorage, sent as Authorization: Bearer <token>   │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ HTTPS  /api/*
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       EXPRESS BACKEND (server/index.js)                │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ auth       │  │ requireAdmin │  │ requireResel.│  │ route       │  │
│  │ middleware │  │ middleware   │  │ middleware   │  │ handlers    │  │
│  └────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │
└───┬─────────┬──────────┬───────────┬───────────┬──────────┬──────────┘
    │         │          │           │           │          │
    ▼         ▼          ▼           ▼           ▼          ▼
┌────────┐ ┌──────┐ ┌─────────┐ ┌────────┐ ┌─────────┐ ┌────────┐
│Postgres│ │Twilio│ │Razorpay │ │  MCP   │ │Google   │ │ SMTP   │
│ (db.js)│ │      │ │         │ │(LiveKit│ │Cloud TTS│ │(mail.js│
│        │ │      │ │         │ │ agents)│ │         │ │        │
└────────┘ └──────┘ └─────────┘ └────────┘ └─────────┘ └────────┘
```

---

## 2. Backend services (the `server/` directory)

| File | Responsibility |
|------|----------------|
| `index.js` | Main Express app. Holds **all** API routes, the auth/admin/reseller middleware, signup/signin, and the database bootstrap (migrations + triggers run on startup). |
| `db.js` | PostgreSQL connection pool. Exposes `q(sql, params)` for parameterized queries. |
| `schema.sql` | Canonical database schema (reference). The live tables are also created/migrated idempotently from `index.js` on boot. |
| `mcp.js` | Model Context Protocol client. Routes agent operations to the correct per-reseller MCP endpoint (`getMcpFor()`, `callTool()`). |
| `provision.js` | The provisioning pipeline: create/reuse an inbound SIP trunk, create the agent, and create the dispatch rule that binds calls to the agent. |
| `language.js` | Per-agent and per-number language configuration and dispatch routing (`setAgentLanguage`, `assignAgentToNumber`, `getActiveAgentForNumber`). |
| `tts.js` | Google Cloud TTS voice previews. Generates and caches MP3 samples for each voice × language combination. |
| `mail.js` | SMTP transactional email via nodemailer (`sendMail`). |
| `settings.js` | Admin-editable configuration layer — reads/writes overrides for Twilio, Razorpay, MCP, SMTP, etc. Masks secrets when read. |
| `wallet.js` | Wallet/minutes ledger, top-up pack catalog, transaction listing. |
| `plans.js` | Canonical plan catalog (Starter / Growth / Scale), monthly+yearly pricing math. |
| `razorpay.js` | Razorpay gateway: create order, verify payment signature, fetch payment, verify webhook signatures. |
| `twilio.js` | Twilio SDK setup, available-number search, number provisioning, recordings. |

---

## 3. Frontend structure (the `src/` directory)

```
src/
├── App.jsx           # Route table + per-tier route guards (RequireAuth)
├── AppContext.jsx    # Global auth/session state (user, token, userType)
├── api.js            # fetch() wrapper that attaches the bearer token
└── surfaces/
    ├── admin/        # Superadmin dashboard shell + tabs
    ├── reseller/     # Reseller / sub-reseller dashboard shell + tabs
    ├── customer/     # End-user dashboard shell + tabs
    ├── Signin.jsx    # Login
    ├── Public.jsx    # Public landing
    ├── Terms.jsx / Privacy.jsx
```

Each surface (`admin`, `reseller`, `customer`) is a **shell** component with a set of tabs. The shell is mounted behind a `RequireAuth` guard that only admits the allowed `user_type`s.

---

## 4. Request lifecycle (an authenticated API call)

1. **Browser** calls `api.js`, which adds `Authorization: Bearer <token>` from `localStorage`.
2. **`auth` middleware** (`server/index.js`) looks the token up in the `sessions` table, checks it hasn't expired (30-day window), and rejects it if the user's `password_changed_at` is **after** the session was created (password change invalidates old sessions). On success it attaches `req.user`.
3. **Role middleware** (optional, per route):
   - `requireAdmin` → `req.user.role === 'admin'` (superadmin only).
   - `requireReseller` → `req.user.user_type === 'reseller'`.
4. **Route handler** runs the business logic, querying Postgres via `db.q(...)` and/or calling out to Twilio / Razorpay / MCP / TTS.
5. **Response** returns JSON. The frontend updates state in `AppContext` or the relevant tab.

---

## 5. Authentication model

- **Sign-in:** `POST /api/signin` with email + password → bcrypt compare → a 64-char hex token is inserted into `sessions` with a 30-day expiry → returned to the client.
- **Token storage:** client-side `localStorage`, replayed on every request as a bearer token.
- **Session invalidation:** changing a password updates `password_changed_at`; any session created before that timestamp is rejected. `POST /api/signout` deletes the current token.
- **No passwords in responses:** only `password_hash` is stored; it is never returned.

See [02-roles-and-permissions.md](02-roles-and-permissions.md) for the authorization details.

---

## 6. Multi-tenancy / white-labeling

The platform is **single-deployment, multi-tenant**. Tenancy is expressed through three things:

1. **`reseller_portal`** — a domain slug on each reseller/sub-reseller. A customer who signs up on a reseller's marketing site carries that slug, which the backend uses to attach them (`reseller_id`) to the right reseller.
2. **`reseller_plans`** — each reseller has its own row-per-tier catalog so it can show its own branded labels, prices, per-minute rates, agent counts, and currency.
3. **Per-reseller MCP endpoint** — `mcp_url` / `mcp_token` on the reseller row let each reseller's agents be provisioned against their own agent-runtime backend (`getMcpFor()` in `mcp.js`).

Any signup with no portal slug defaults to `9278.io`, the canonical built-in reseller, via the `set_default_reseller_id` trigger.

---

## 7. The provisioning pipeline (how an agent comes alive)

When a customer buys a number + plan (or an admin provisions on their behalf), the following happens in `server/provision.js`:

```
provisionInboundForUser(user, number)
        │
        ▼
1. ensureTrunk()      → create or reuse an inbound SIP trunk for the DID,
                        allowing calls from the SIP gateway IP
        │
        ▼
2. ensureAgent()      → create the agent identity on the MCP/LiveKit backend:
                        slug = "<company-slug>-agent", name, greeting,
                        system prompt, KB (company + FAQs), voice, language
        │
        ▼
3. dispatch rule      → bind incoming calls on this DID to that agent
                        (so a call to the number reaches the right agent)
        │
        ▼
4. persist            → store livekit_trunk_id, livekit_dispatch_id,
                        agent_id, agent_slug, provisioning_status='ready',
                        provisioned_at on users / user_numbers
```

If any step fails, `provisioning_status` becomes an error state and `provisioning_error` records the reason, so the dashboards can surface it and an admin can re-trigger via `POST /api/admin/provision/:userId`.

The runtime agent itself answers calls with **Gemini Live**, falling back to **xAI Grok**, with a per-agent **language lock** (English auto-detects; other languages are fixed). See [10-voice-agents-and-provisioning.md](10-voice-agents-and-provisioning.md).

---

## 8. External dependencies & configuration

| Concern | Provider | Configured via |
|---------|----------|----------------|
| DIDs, call logs, recordings | Twilio | `settings` table + env (`twilio.js`) |
| Payments | Razorpay | `settings` + env (`razorpay.js`) |
| Agent runtime | MCP / LiveKit | per-reseller `mcp_url` + `mcp_token`; global env fallback |
| Voice previews | Google Cloud TTS | env credentials (`tts.js`) |
| Call summaries | xAI Grok | env API key |
| Email | SMTP server | `settings` + env (`mail.js`) |
| Number markup | internal | `settings` (multiplier, default 2.5×) |
| USD→INR rate | internal | env `USD_INR` (default 95) |

Secrets are editable from the **Superadmin → Settings** tab and stored (masked) in the `settings` table; see [03-superadmin-flow.md](03-superadmin-flow.md).
