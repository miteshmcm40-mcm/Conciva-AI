# 06 — User (Customer) Flow

The user — or customer — is the end consumer who actually buys a phone number, gets an AI voice agent provisioned, and uses the product day to day. This is the most feature-rich surface in the portal.

- **`user_type`:** `user`
- **`reseller_id`:** the reseller or sub-reseller they signed up under
- **Lands on:** `/dashboard`
- **Dashboard shell:** `src/surfaces/customer/Customer.jsx`
- **API:** auth-only routes scoped to the user's own id (no special role guard)

---

## 1. The signup → live-agent journey

```
1. Visit a portal's marketing/signup page (carries a resellerPortal slug)
2. Choose a plan (Starter / Growth / Scale — branded by the reseller)
3. Razorpay checkout:
     POST /api/razorpay/order/signup   → creates a pending_signup + order
     (browser completes payment)
     POST /api/razorpay/verify         → verifies signature, creates the user,
                                          attributes reseller_id from the slug,
                                          provisions a DID + agent
4. Agent provisioning runs (server/provision.js):
     SIP trunk → agent identity → dispatch rule → status 'ready'
5. User receives credentials, signs in, lands on /dashboard
6. The phone number is live: inbound calls reach the AI agent
```

If signup payment succeeds but provisioning fails, `provisioning_status` records the error and a superadmin can re-run it via `POST /api/admin/provision/:userId`. The user can also trigger provisioning for themselves via `POST /api/provision/me`.

---

## 2. The customer dashboard

Nine tabs (`src/surfaces/customer/Customer.jsx`):

| Tab | File | Purpose |
|-----|------|---------|
| **Overview** | `Overview.jsx` | At-a-glance stats: minutes used/remaining, calls, agent status. |
| **Plan & Numbers** | `Numbers.jsx` | The user's DIDs, each with its plan, and number purchasing/plan changes. |
| **Calls** | `Calls.jsx` | Inbound/outbound call history with filters and pagination. |
| **Recordings** | `Recordings.jsx` | Call recordings (audio URLs). |
| **Reports** | `Reports.jsx` | Transcripts + AI summaries per call (xAI Grok). |
| **Meetings** | `Meetings.jsx` | Scheduled meetings the agent booked (with email confirmations). |
| **Knowledge & Agent** | `KbAgent.jsx` | Configure the agent: greeting, system prompt, knowledge base, voice, language. |
| **Billing & Minutes** | `Billing.jsx` | Wallet balance, top-ups, saved cards, auto-topup settings. |
| **Account** | `Account.jsx` | Profile, password change, delete account. |

---

## 3. Numbers & plans

A customer can own **multiple DIDs**, and each DID has its **own** agent configuration and plan.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/numbers` | List the user's DIDs + their plans |
| `POST /api/numbers` | Add a new DID from inventory |
| `PATCH /api/numbers/:id` | Update a DID's label / language / assigned agent |
| `DELETE /api/numbers/:id` | Release a DID |
| `GET /api/numbers/:id/change-plan-quote` | Price a plan change for a DID |
| `POST /api/razorpay/order/number-plan` | Start payment to change a DID's plan |
| `POST /api/razorpay/verify/number-plan` | Apply the plan change after payment |
| `POST /api/razorpay/order/new-number-plan` | Buy a new DID + plan together |
| `POST /api/razorpay/verify/new-number-plan` | Finalize the new DID + plan purchase |

Each DID's config lives in the `user_numbers` table: `plan_id` (`starter`/`growth`/`scale`), `plan_cycle` (`monthly`/`yearly`), agent fields, provisioning ids, and `is_primary`.

---

## 4. Configuring the AI agent (Knowledge & Agent tab)

This is where the customer shapes how their agent behaves:

- **Greeting** — the opening line the agent speaks.
- **System prompt** — instructions that steer the agent's behavior.
- **Knowledge base** — `kb_company` (company description) + `kb_faqs` (Q&A the agent can answer from).
- **Voice** — one of 10 Gemini voices (Kore, Puck, Charon, Aoede, Fenrir, Leda, Orus, Zephyr, Algieba, Sulafat).
- **Language** — English (auto-detect) or one of ~14 supported languages (fixed lock).

Voice previews are generated on demand via Google Cloud TTS and cached as MP3s. Changing any of these updates the agent through the MCP runtime so the next call uses the new configuration. See [10-voice-agents-and-provisioning.md](10-voice-agents-and-provisioning.md).

---

## 5. Calls, recordings, and reports

- **Calls** — `GET /api/twilio/calls`: paginated inbound/outbound history with filters.
- **Recordings** — `GET /api/recordings`: recorded audio for calls.
- **Reports** — `GET /api/recordings/:callId/summary`: an AI-generated transcript and summary (produced by xAI Grok in JSON mode).
- **Meetings** — meetings the agent scheduled during calls; confirmations are sent via SMTP email and recorded via an HMAC-signed webhook.

---

## 6. Billing & minutes (the wallet)

Every customer has a **wallet** measured in minutes. The plan grants a monthly allotment; usage beyond that draws on wallet minutes bought via top-up packs.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/wallet` | Minutes balance + auto-topup settings |
| `PATCH /api/wallet/preferences` | Set low-balance threshold, toggle auto-topup |
| `GET /api/wallet/packs` | List top-up packs |
| `POST /api/razorpay/order/topup` | Start a top-up payment |
| `POST /api/razorpay/verify/topup` | Complete the top-up |
| `POST /api/razorpay/order/save-card` | Begin saving a card token |
| `POST /api/razorpay/verify/save-card` | Confirm the saved card |
| `DELETE /api/payment-method` | Remove a saved card |

**Top-up packs** (effective ~₹4/min):

| Pack | Minutes |
|------|---------|
| ₹500 | 125 |
| ₹1,000 | 250 |
| ₹2,000 | 500 |
| ₹5,000 | 1,250 |

**Auto-topup:** when enabled and a saved card exists, the wallet auto-charges a chosen pack once the balance drops below the customer's `low_balance_threshold` (default 20 minutes) and plan minutes are exhausted. Every charge is recorded in `wallet_transactions` with an idempotent `external_ref` to prevent double-billing. See [09-billing-and-plans.md](09-billing-and-plans.md).

---

## 7. Account management

| Endpoint | Purpose |
|----------|---------|
| `GET /api/me` | Current profile |
| `PATCH /api/me` | Update profile fields |
| `POST /api/me/password` | Change password (rotates `password_changed_at`, logs out old sessions) |
| `DELETE /api/me` | Delete the account |
| `POST /api/signout` | End the current session |

---

## 8. What a user can and cannot do

**Can:** buy/release numbers, change plans, configure agents, view calls/recordings/reports/meetings, manage wallet and cards, edit profile, delete account.

**Cannot:** see any other user's data, create other accounts, change pricing, touch system settings, or access `/admin` or `/reseller`.

---

## 9. User journey (end to end)

```
Sign up on a reseller's portal  →  pay  →  user + DID + agent provisioned
        │
        ▼
Sign in  →  /dashboard
        │
        ├─ Knowledge & Agent: set greeting, prompt, KB, voice, language
        ├─ Plan & Numbers:    add more DIDs, change plans
        ├─ Calls / Recordings / Reports: monitor what the agent did
        ├─ Meetings:          see what the agent booked
        ├─ Billing & Minutes: top up, enable auto-topup, manage cards
        └─ Account:           profile, password, delete
        │
        ▼
Inbound callers reach the AI agent, which answers, helps, and can book meetings.
Usage burns plan minutes, then wallet minutes; low balance triggers top-up.
```
