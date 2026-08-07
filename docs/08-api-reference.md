# 08 — API Reference

Every HTTP endpoint, grouped by access level. All paths are prefixed with the server origin and live under `/api`.

**Auth column legend:**
- **Public** — no token required.
- **Auth** — requires a valid session token (`Authorization: Bearer <token>`); implicitly scoped to the caller's own id.
- **Admin** — requires `auth` + `role === 'admin'` (`requireAdmin`).
- **Reseller** — requires `auth` + `user_type === 'reseller'` (`requireReseller`).

---

## 1. Authentication & session

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `POST /api/signin` | Public | Email + password → session token + user object |
| `POST /api/signout` | Auth | Invalidate the current session token |
| `GET /api/me` | Auth | Current user profile |
| `PATCH /api/me` | Auth | Update profile fields |
| `POST /api/me/password` | Auth | Change password (rotates `password_changed_at`) |
| `DELETE /api/me` | Auth | Delete own account |

---

## 2. Public / status

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/health` | Public | Server health check |
| `GET /api/plans` | Public | Public pricing tiers |
| `GET /api/twilio/status` | Public | Twilio client readiness |
| `GET /api/twilio/available-numbers` | Public | Search available DIDs (country/region) |

---

## 3. Signup & signup payment

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `POST /api/razorpay/order/signup` | Public | Start checkout for a new signup (captures `resellerPortal`) |
| `POST /api/razorpay/verify` | Public | Verify payment signature → create user + provision DID/agent |
| `POST /api/razorpay/webhook` | Public* | Razorpay event webhook (signature-verified) |

\* The webhook is unauthenticated by token but validates the Razorpay webhook signature.

---

## 4. Wallet & billing (customer)

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/wallet` | Auth | Minutes balance + auto-topup settings |
| `PATCH /api/wallet/preferences` | Auth | Low-balance threshold, auto-topup toggles |
| `GET /api/wallet/packs` | Auth | List top-up packs |
| `POST /api/razorpay/order/topup` | Auth | Start a wallet top-up payment |
| `POST /api/razorpay/verify/topup` | Auth | Complete a top-up |
| `POST /api/razorpay/order/save-card` | Auth | Begin saving a card token |
| `POST /api/razorpay/verify/save-card` | Auth | Confirm saved card |
| `DELETE /api/payment-method` | Auth | Remove a saved card |

---

## 5. Numbers & plans (customer)

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/numbers` | Auth | List the user's DIDs + plans |
| `POST /api/numbers` | Auth | Add a DID from inventory |
| `PATCH /api/numbers/:id` | Auth | Update DID label / language / agent |
| `DELETE /api/numbers/:id` | Auth | Release a DID |
| `GET /api/numbers/:id/change-plan-quote` | Auth | Price a plan change |
| `POST /api/razorpay/order/number-plan` | Auth | Start payment to change a DID's plan |
| `POST /api/razorpay/verify/number-plan` | Auth | Apply the plan change |
| `POST /api/razorpay/order/new-number-plan` | Auth | Buy a new DID + plan |
| `POST /api/razorpay/verify/new-number-plan` | Auth | Finalize new DID + plan |

---

## 6. Calls, recordings, agent (customer)

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/twilio/calls` | Auth | Call history (paginated, filterable) |
| `GET /api/recordings` | Auth | Call recordings (paginated) |
| `GET /api/recordings/:callId/summary` | Auth | AI transcript + summary (xAI Grok) |
| `POST /api/provision/me` | Auth | Trigger agent provisioning for self |

---

## 7. Admin (superadmin only)

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/admin/users` | Admin | All users + DIDs + attribution |
| `DELETE /api/admin/users/:id` | Admin | Delete a user |
| `GET /api/admin/resellers` | Admin | All resellers + sub-resellers + counts |
| `POST /api/admin/resellers` | Admin | Create a reseller |
| `GET /api/admin/resellers/:id/customers` | Admin | Customers under a reseller |
| `GET /api/admin/numbers` | Admin | DID inventory |
| `POST /api/admin/numbers` | Admin | Add DIDs to inventory |
| `DELETE /api/admin/numbers/:value` | Admin | Remove a DID |
| `GET /api/admin/settings` | Admin | Read settings (secrets masked) |
| `PATCH /api/admin/settings` | Admin | Update settings |
| `GET /api/admin/stats` | Admin | Aggregated platform metrics |
| `POST /api/admin/provision/:userId` | Admin | (Re)provision a user's agent |

---

## 8. Reseller (reseller / sub-reseller)

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/reseller/customers` | Reseller | List the reseller's customers |
| `GET /api/reseller/purchases` | Reseller | Transaction/plan ledger for those customers |
| `GET /api/reseller/plans` | Reseller | The reseller's branded plan catalog |
| `PATCH /api/reseller/plans/:basePlanId` | Reseller | Edit a branded plan tier |
| `GET /api/reseller/sub-resellers` | Reseller | List sub-resellers |
| `POST /api/reseller/sub-resellers` | Reseller | Create a sub-reseller |

All reseller routes are internally scoped to the caller's id, so a sub-reseller sees only its own data.

---

## 9. Common request/response patterns

- **Auth header:** `Authorization: Bearer <64-char-hex-token>` on every Auth/Admin/Reseller route.
- **Errors:** JSON `{ error: "<message>" }` with appropriate HTTP status (`401` no/invalid token, `403` wrong role, `400` bad input, `404` not found).
- **Razorpay two-step:** every payment is `order/*` (create order) → browser checkout → `verify/*` (validate signature, then perform the side effect: create user, top up wallet, change plan, etc.). The `external_ref` idempotency key guards against double application.
- **Pagination:** list endpoints (calls, recordings) accept page/limit and filter query params.
