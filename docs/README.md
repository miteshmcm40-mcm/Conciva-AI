# Voice Agent Portal — Documentation

A multi-tenant, white-label platform for selling and managing AI voice agents over the phone. The portal supports a four-tier hierarchy — **Superadmin → Reseller → Sub-Reseller → User (Customer)** — where each tier provisions, prices, and serves the tier below it.

This documentation describes every role, every flow, the data model, billing, agent provisioning, and the APIs that tie it all together.

---

## What the platform does

Customers buy a phone number (DID) and a plan. The platform automatically provisions an **AI voice agent** behind that number: an inbound SIP trunk, an agent identity (greeting, system prompt, knowledge base, voice, language), and a dispatch rule that routes incoming calls to the agent. The agent answers calls in real time (Gemini Live with an xAI Grok fallback), can be configured per number, and every call is logged, recorded, transcribed, and summarized.

Resellers white-label the whole thing: they get their own portal slug, their own branded plan catalog and pricing, and their own customer base. Sub-resellers extend a reseller's reach one level further. The superadmin sits on top with global visibility and control of system credentials.

---

## Tech stack at a glance

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router 6, Vite, Tailwind CSS |
| Backend | Node.js, Express 4 |
| Database | PostgreSQL 13+ |
| Auth | Token sessions (64-char hex), bcryptjs password hashing, 30-day expiry |
| Telephony | Twilio (DIDs, call logs, recordings) + SIP trunk gateway |
| Agent runtime | MCP (Model Context Protocol) client → LiveKit trunks/dispatch; Gemini Live + xAI Grok |
| Voice previews | Google Cloud Text-to-Speech (cached MP3s) |
| Payments | Razorpay (orders, webhooks, saved-card tokens) |
| Email | SMTP via nodemailer |
| LLM | xAI Grok (call summaries, transcripts) |

---

## The four roles in one picture

```
                         ┌──────────────────────────┐
                         │        SUPERADMIN         │  user_type = 'superadmin'
                         │  Global owner of platform │  role        = 'admin'
                         └────────────┬─────────────┘
                                      │ creates resellers
                          ┌───────────┴────────────┐
                          ▼                         ▼
                 ┌─────────────────┐       ┌─────────────────┐
                 │    RESELLER     │       │    RESELLER     │  user_type = 'reseller'
                 │ portal: acme.io │       │ portal: 9278.io │  has reseller_portal slug
                 └───────┬─────────┘       └────────┬────────┘  has own plan catalog
                         │                          │
          ┌──────────────┼─────────┐                │ direct + auto-attributed
          ▼              ▼         ▼                ▼
   ┌────────────┐  ┌──────────┐  ┌──────┐      ┌──────┐
   │SUB-RESELLER│  │  USER    │  │ USER │      │ USER │   user_type = 'sub-reseller' | 'user'
   │            │  │(customer)│  │      │      │      │   reseller_id → parent
   └─────┬──────┘  └──────────┘  └──────┘      └──────┘
         │ creates customers
         ▼
   ┌──────────┐
   │   USER   │
   │(customer)│
   └──────────┘
```

**Key fields that encode the hierarchy (on the `users` table):**

- `user_type` — the canonical role: `'superadmin'`, `'reseller'`, `'sub-reseller'`, `'user'`.
- `role` — legacy flag (`'admin'` | `'customer'`) kept for backward compatibility; superadmin = `'admin'`.
- `reseller_id` — foreign key to the parent user (the reseller or sub-reseller a user belongs to).
- `reseller_portal` — the white-label domain slug for resellers/sub-resellers (e.g. `acme.io`). Unique per portal.

Any user who signs up without an explicit reseller is **auto-attributed** to the canonical `9278.io` reseller via a database trigger.

---

## Documentation map

| Document | What's inside |
|----------|--------------|
| [01-architecture.md](01-architecture.md) | System architecture, services, request lifecycle, provisioning pipeline |
| [02-roles-and-permissions.md](02-roles-and-permissions.md) | The four tiers, what each can do, middleware guards, route guards |
| [03-superadmin-flow.md](03-superadmin-flow.md) | Superadmin dashboard, every tab, creating resellers, system settings |
| [04-reseller-flow.md](04-reseller-flow.md) | Reseller dashboard, branded plans, creating sub-resellers, customer management |
| [05-sub-reseller-flow.md](05-sub-reseller-flow.md) | Sub-reseller scope, how it differs from reseller, customer creation |
| [06-user-flow.md](06-user-flow.md) | Customer journey: signup → payment → provisioning → using the agent |
| [07-data-model.md](07-data-model.md) | Every table, every important column, relationships, triggers |
| [08-api-reference.md](08-api-reference.md) | Every endpoint grouped by role with auth requirements |
| [09-billing-and-plans.md](09-billing-and-plans.md) | Plans, wallet/minutes, top-up packs, Razorpay, auto-topup |
| [10-voice-agents-and-provisioning.md](10-voice-agents-and-provisioning.md) | Agents, TTS voices, languages, MCP, the provisioning pipeline |
| [11-glossary.md](11-glossary.md) | Definitions of every term used across the docs |

---

## Quick role cheat sheet

| | Superadmin | Reseller | Sub-Reseller | User |
|---|---|---|---|---|
| `user_type` | `superadmin` | `reseller` | `sub-reseller` | `user` |
| Lands on | `/admin` | `/reseller` | `/reseller` | `/dashboard` |
| Creates | Resellers | Sub-resellers, customers | Customers | — |
| Sees | Everyone | Own sub-resellers + customers | Own customers | Own data only |
| Sets pricing | Base plans (global) | Own branded catalog | Inherits reseller catalog | — |
| Manages credentials | Yes (Twilio, Razorpay, MCP, SMTP) | No | No | No |
| Buys numbers/agents | — | — | — | Yes |

> **Note on accuracy:** This documentation is reconstructed from the live codebase (`server/index.js`, `server/*.js`, `src/surfaces/**`). Endpoint paths, field names, role strings, and pricing reflect the implementation at the time of writing. Where exact line numbers are cited they point to `server/index.js` unless otherwise noted.
