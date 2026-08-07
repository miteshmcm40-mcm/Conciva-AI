# 11 — Glossary

Definitions of the terms used throughout the Voice Agent Portal documentation.

| Term | Definition |
|------|-----------|
| **Superadmin** | Top-tier platform owner. `user_type = 'superadmin'`, `role = 'admin'`. Global visibility; creates resellers; manages system credentials and the base plan catalog. |
| **Reseller** | White-label operator created by the superadmin. `user_type = 'reseller'`, owns a `reseller_portal` slug and a branded plan catalog. Creates sub-resellers and acquires customers. |
| **Sub-Reseller** | A reseller's downstream partner. `user_type = 'sub-reseller'`, `reseller_id` points to the parent reseller. Serves its own customers under the parent's pricing. |
| **User / Customer** | End consumer. `user_type = 'user'`. Buys numbers, configures agents, makes/receives calls, manages billing. Sees only its own data. |
| **`user_type`** | Canonical role field on the `users` table: `superadmin` / `reseller` / `sub-reseller` / `user`. |
| **`role`** | Legacy role flag: `admin` / `customer`. Only the superadmin is `admin`. Kept for backward compatibility. |
| **`reseller_id`** | Self-referencing FK on `users` linking a user/sub-reseller to its parent reseller. |
| **`reseller_portal`** | A reseller's/sub-reseller's unique white-label domain slug (e.g. `acme.io`). Used to attribute signups. |
| **Portal slug** | Shorthand for `reseller_portal`; the value that routes a signup to the right reseller. |
| **9278.io** | The canonical built-in reseller. Any signup without a portal slug is auto-attributed to it via the `set_default_reseller_id` trigger. |
| **DID** | Direct Inward Dial — a purchasable phone number that routes inbound calls to an agent. |
| **`did_inventory`** | The pool of DIDs the superadmin makes available for customers to buy. |
| **Voice agent** | The AI that answers inbound calls: greeting + system prompt + knowledge base + voice + language, running on Gemini Live (xAI Grok fallback). |
| **Provisioning** | The pipeline that makes a number live: create SIP trunk → create agent → create dispatch rule → persist runtime ids. See `server/provision.js`. |
| **`provisioning_status`** | State of the provisioning pipeline for a user/number (`ready` on success, error states otherwise). |
| **MCP** | Model Context Protocol. The client/runtime layer (`server/mcp.js`) that creates trunks, agents, dispatch rules, and fetches recordings — routed per-reseller via `mcp_url`/`mcp_token`. |
| **LiveKit** | The agent runtime backend behind MCP; trunk/dispatch/room ids are stored as `livekit_*` columns. |
| **SIP trunk** | The inbound voice path for a DID; allows calls from the configured SIP gateway IP. |
| **Dispatch rule** | The binding that routes inbound calls on a DID to a specific agent. |
| **Greeting** | The opening line the agent speaks when answering. |
| **System prompt** | Instructions that steer the agent's behavior (`prompt`). |
| **Knowledge base (KB)** | `kb_company` (company description) + `kb_faqs` (Q&A) the agent answers from. |
| **Gemini voice** | One of 10 TTS voices: Kore, Puck, Charon, Aoede, Fenrir, Leda, Orus, Zephyr, Algieba, Sulafat. |
| **Language lock** | Per-agent language setting; English auto-detects, other languages are fixed. |
| **TTS** | Text-to-Speech. Google Cloud TTS generates cached voice-preview MP3s in `server/tts-cache/`. |
| **Plan** | A subscription tier (Starter / Growth / Scale) with included minutes, overage rate, agent count, DID count, and concurrency. |
| **`plan_cycle`** | Billing cadence: `monthly` or `yearly` (yearly = 20% off). |
| **Base plan catalog** | The canonical Starter/Growth/Scale tiers defined by the superadmin in `server/plans.js`. |
| **`reseller_plans`** | A reseller's branded copy of the base tiers (own label/price/rate/minutes/agents/currency). |
| **Wallet** | A customer's minutes balance used after plan minutes are exhausted. |
| **Top-up pack** | A purchasable block of wallet minutes (₹500/125, ₹1000/250, ₹2000/500, ₹5000/1250). |
| **Auto-topup** | Automatic wallet recharge when the balance drops below `low_balance_threshold` and a card is saved. |
| **`low_balance_threshold`** | Minutes level (default 20) that triggers auto-topup. |
| **`wallet_transactions`** | The money/minutes ledger. `kind` ∈ {`signup`, `topup`, `number_rental`}. |
| **`external_ref`** | Unique idempotency key on a transaction, preventing double application of a payment. |
| **Razorpay** | The payment gateway (Stripe has been removed). Two-step: create order → verify signature. |
| **`pending_signups`** | Staging table holding the signup payload between order creation and payment verification. |
| **Markup multiplier** | Factor applied to Twilio's number cost (default 2.5×) before display, set in Settings. |
| **`USD_INR`** | USD→INR conversion rate (env, default 95) used for pricing. |
| **Session token** | 64-char hex bearer token in the `sessions` table; 30-day expiry; sent as `Authorization: Bearer`. |
| **`password_changed_at`** | Timestamp that invalidates sessions created before a password change. |
| **`requireAdmin`** | Middleware gating `/api/admin/*` on `role === 'admin'`. |
| **`requireReseller`** | Middleware gating `/api/reseller/*` on `user_type === 'reseller'`. |
| **`set_default_reseller_id`** | DB trigger that attaches reseller-less signups to the `9278.io` reseller. |
