# Replenish Autopilot

[![Live Demo](https://img.shields.io/badge/Live%20Demo-replenish--autopilot.vercel.app-blue?style=flat-square)](https://replenish-autopilot.vercel.app)
[![Event](https://img.shields.io/badge/Hackathon-Grok%20Bot%20Commerce%202026-black?style=flat-square)](https://fleek.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

> **"Autonomous commerce isn't blocked by AI reasoning. It's blocked by consumer trust and enforceable spending authority. We built the trust layer that makes your cart safe to hand over."**

Built at the **Grok Bot Commerce Hackathon** (Fleek HQ, London · 26–27 September 2026).  
**Track:** Agentic Commerce  
**Team:** [Lucas Malik](https://github.com/EXL-1) (Trust Layer, IAM, Supabase RLS, Policy Engine, Shopify) & [Gabriel Moura](https://github.com/gabrielmoura) (Brain, UI, Tavily Agent Loop, Pitch).

---

## 📑 Table of Contents

- [The Thesis in One Line](#the-thesis-in-one-line)
- [How It Works (The 6-Step Loop)](#how-it-works-the-6-step-loop)
- [System Architecture & The Three-Tier Boundary](#system-architecture--the-three-tier-boundary)
- [Where Grok Sits — Advisory Reasoning, Not Authority](#where-grok-sits--advisory-reasoning-not-authority)
- [Privacy & Security Architecture](#privacy--security-architecture)
- [API Reference](#api-reference)
- [Database Schema & Row-Level Security](#database-schema--row-level-security)
- [Commerce Layer & Honest Ledgering](#commerce-layer--honest-ledgering)
- [Sponsor Stack & Load-Bearing Integrations](#sponsor-stack--load-bearing-integrations)
- [Standards Alignment (UCP / AP2)](#standards-alignment-ucp--ap2)
- [Getting Started & Local Development](#getting-started--local-development)
- [Demo Run Sheet & Verification](#demo-run-sheet--verification)
- [Known Trade-offs & Post-Hackathon Remediation](#known-trade-offs--post-hackathon-remediation)
- [Documentation & Handover Artefacts](#documentation--handover-artefacts)
- [License](#license)

---

## The Thesis in One Line

The tech industry is in a race to give autonomous AI agents open credit card access. However, according to research by Visa (2025) and Checkout.com, **79% of consumers report privacy concerns** regarding autonomous agents and **42% fear unexpected charges or losing control of their finances**.

**Replenish Autopilot** rejects the premise that an agent needs your full identity and lifelong purchase history to reorder coffee beans. We built a deterministic **Trust Layer** that decides whether spend authority is valid, enforces strict mathematical boundaries, and immutably audits every decision—without harvesting personal profiles.

---

## How It Works (The 6-Step Loop)

```
[ Signal ] ──> [ Live Compare ] ──> [ Advisory Grok ] ──> [ Policy Check ] ──> [ Scoped Order ] ──> [ Audit Trail ]
  (4 days)       (Tesco/Waitrose/     (1-sentence          (Deterministic       (Shopify Test       (Immutable
                  Ocado via Tavily)    explanation)         Spend Token)         Dev Store)          Postgres Log)
```

1. **Signal:** Calculates consumable depletion from baseline consumption rates (e.g., *"Coffee beans empty in 4 days"*). Zero browsing trackers, zero purchase history profiling.
2. **Compare:** Discovers live, unpersonalised prices across three competing retailers (Tesco, Waitrose, Ocado) using Tavily search. Pack prices are verified and cached to prevent rate-limiting during evaluation.
3. **Explain (xAI Grok):** Evaluates price signals and spending constraints server-side, returning an advisory, human-readable rationale (e.g., *"Waitrose selected at £12.00: lowest verified price within £40 monthly cap"*).
4. **Policy Engine:** Evaluates the spend token deterministically against **Spend Cap (£40)**, **Category Scope (`groceries/coffee`)**, **Allowed Retailer**, **Expiry TTL (24h)**, and **Revocation State**. Returns strictly `allow`, `deny`, or `escalate`.
5. **Scoped Order:** If and only if `allow` is returned, places a real order on a real Shopify store (`test: true`).
6. **Immutable Audit:** Records full decision provenance: caller inputs, options compared, chosen merchant, requested amount, charged amount, and rationale.

---

## System Architecture & The Three-Tier Boundary

Replenish Autopilot physically decouples autonomous agents from spend authority through a three-tier actor boundary:

```
┌────────────────────────────────────────────────────────┐
│              TIER 1: UNTRUSTED CLIENT AGENT             │
│   Grok Bot (X/Twitter DM / Telegram) / User Frontend   │
│   - Expresses intent ("reorder coffee")                │
│   - Possesses NO API keys, NO wallet, NO admin tokens   │
└──────────────────────────┬─────────────────────────────┘
                           │ Authenticated via Supabase JWT Bearer
                           ▼
┌────────────────────────────────────────────────────────┐
│            TIER 2: AUTHORITATIVE TRUST LAYER           │
│         Next.js App Router Backend (eu-west-1)          │
│                                                        │
│  ┌─────────────────────────┐  ┌──────────────────────┐ │
│  │  Deterministic Policy   │  │   Postgres 17.6 DB   │ │
│  │   Engine (TypeScript)   │  │  RLS: auth.uid()=uid │ │
│  │   Cap / Scope / TTL     │  │  8 Relational Tables │ │
│  └────────────┬────────────┘  └──────────────────────┘ │
│               │                                        │
│               ├───────────────┐                        │
│         allow │               │ deny / escalate        │
│               ▼               ▼                        │
│     ┌──────────────────┐  ┌───────────────────────┐    │
│     │ Shopify Dev API  │  │ Transaction Cancelled │    │
│     │ (Real Test Cart) │  │  Logged to Audit Trail│    │
│     └──────────────────┘  └───────────────────────┘    │
└───────────────┬────────────────────────────────────────┘
                │ Advisory Rationale Query (store: false)
                ▼
┌────────────────────────────────────────────────────────┐
│         TIER 3: ADVISORY REASONER (NON-CRITICAL)       │
│             xAI Grok API (grok-4.20-0309)              │
│  - Synthesises explanation from provided options       │
│  - Has NO tools, NO database access, NO spend power    │
│  - Bypassed entirely via fallback if offline or slow   │
└────────────────────────────────────────────────────────┘
```

---

## Where Grok Sits — Advisory Reasoning, Not Authority

> **Core Rule:** An LLM that can be prompt-injected or hallucinate cannot be in the critical spend path.

- **Server-Side Execution:** Grok executes purely on the backend after the caller's JWT is cryptographically validated.
- **Strict Data Isolation:** Grok receives only the current price triplet, the consumable name, and the budget constraint. It never receives user IDs, billing details, database keys, or browsing histories.
- **Ephemeral Processing (`store: false`):** We pass `store: false` to the xAI Responses API to ensure zero data retention or behavioral profiling.
- **Deterministic Fallback:** If the xAI API times out, errors, or returns malformed JSON, the system defaults immediately to deterministic rule-based rationales. The spend path never blocks or fails insecurely.

---

## Privacy & Security Architecture

| Principle | Technical Enforcement |
|---|---|
| **Data Minimisation** | Single row per consumable. No tracking cookies, no device fingerprinting, no third-party telemetry. |
| **User-Owned Isolation** | PostgreSQL Row-Level Security (RLS) enabled across all 8 tables with `auth.uid() = user_id`. |
| **Bounded Spend Authority** | Tokens define max spend (£40), permitted MCC/category, approved merchant, and expiry TTL. |
| **Instant Kill-Switch** | One-tap revocation marks tokens invalid server-side immediately. Irreversible by design. |
| **Anti-Enumeration Protection** | Requests for resources belonging to other tenants return HTTP `404 Not Found` rather than `403 Forbidden`. |

### RLS Isolation Demonstrated Live
The client frontend connects using the authenticated user's scoped JWT and public anon key. Switching to a secondary test account in the navigation menu instantly yields 0 rows across all tables—demonstrating real database-level tenant isolation live on screen.

---

## API Reference

All endpoints require `Authorization: Bearer <SUPABASE_JWT>` and return `application/json`.

### 1. `GET /api/signal`
Retrieves replenishment urgency for all registered household consumables.

```json
// Response: 200 OK
[
  {
    "id": "c1a2b3c4-0000-0000-0000-000000000001",
    "name": "Assembly Coffee Whole Beans (200g)",
    "days_remaining": 4,
    "urgency": "high",
    "recommended_reorder_date": "2026-09-30T09:00:00Z"
  }
]
```

### 2. `POST /api/compare`
Queries live multi-retailer pricing via Tavily and requests Grok explanation.

```json
// Request Body
{
  "consumable_id": "c1a2b3c4-0000-0000-0000-000000000001",
  "search_term": "Assembly Coffee Whole Beans 200g"
}

// Response: 200 OK
{
  "findings": [
    { "shop": "Waitrose", "price": 12.00, "url": "https://waitrose.com/...", "in_stock": true },
    { "shop": "Ocado", "price": 13.50, "url": "https://ocado.com/...", "in_stock": true },
    { "shop": "Tesco", "price": 14.00, "url": "https://tesco.com/...", "in_stock": false }
  ],
  "best_option": { "shop": "Waitrose", "price": 12.00 },
  "reason": "Waitrose selected: lowest verified price at £12.00 within £40 monthly cap.",
  "explained_by": "grok"
}
```

### 3. `POST /api/order`
Evaluates spend authority via the deterministic policy engine and submits test order.

```json
// Request Body
{
  "consumable_id": "c1a2b3c4-0000-0000-0000-000000000001",
  "shop_id": "s1a2b3c4-0000-0000-0000-000000000001",
  "token_id": "t1a2b3c4-0000-0000-0000-000000000001",
  "requested_amount": 13.50
}

// Response: 200 OK (Allowed & Executed)
{
  "status": "allowed",
  "order_id": "ord_882910394",
  "shopify_order_number": "#1018",
  "charged_amount": 12.00,
  "requested_amount": 13.50,
  "currency": "GBP",
  "audit_logged": true
}
```

---

## Database Schema & Row-Level Security

Implemented on **PostgreSQL 17.6 (Supabase eu-west-1)** across 8 core relational tables:

```
  ┌──────────────┐       ┌────────────────┐       ┌──────────────┐
  │    users     │◀──────│  consumables   │──────▶│    shops     │
  └──────┬───────┘       └───────┬────────┘       └──────┬───────┘
         │                       │                       │
         ▼                       ▼                       ▼
  ┌──────────────┐       ┌────────────────┐       ┌──────────────┐
  │   consent    │       │  spend_tokens  │       │price_findings│
  └──────────────┘       └───────┬────────┘       └──────────────┘
                                 │
                                 ▼
                         ┌────────────────┐       ┌──────────────┐
                         │     orders     │──────▶│  audit_log   │
                         └────────────────┘       └──────────────┘
```

1. **`users`** — Root identities tied to Supabase Auth (`id`, `email`, `created_at`).
2. **`consumables`** — Monitored household inventory items and replenishment velocity.
3. **`shops`** — Supported and verified retailer catalogues.
4. **`spend_tokens`** — Cryptographically bounded spending mandates (`cap`, `category`, `ttl`, `revoked`).
5. **`price_findings`** — Ephemeral price discovery cache with evidence URLs.
6. **`orders`** — Executed transactions (`charged_amount`, `requested_amount`, `shopify_id`).
7. **`audit_log`** — Append-only verification ledger detailing every policy evaluation.
8. **`consent`** — User opt-in and policy parameters per category.

---

## Commerce Layer & Honest Ledgering

During live testing (PR #4 & #5), our system detected a real-world edge case: the live retailer quote (£13.50 via Tavily) differed from the test Shopify catalogue price (£12.00).

Rather than papering over the delta, Replenish Autopilot implements **Dual-Price Ledgering**:
- **`requested_amount`:** Preserves the quote on which the agent based its decision (£13.50).
- **`charged_amount`:** Verbatim record of what was invoiced by the Shopify REST API (£12.00).

This guarantees the audit trail remains self-evidencing, auditable by financial regulators, and impervious to reconciliation discrepancies.

---

## Sponsor Stack & Load-Bearing Integrations

Every integrated service in Replenish Autopilot is load-bearing:

| Sponsor / Tool | Exact Production Role |
|---|---|
| **Cursor** | AI-assisted development of the TypeScript policy engine and UI. |
| **Grok Bots** | Client agent interface handling natural language inbound requests. |
| **xAI Grok API** | Explains decisions using `grok-4.20-0309-non-reasoning` (~1s latency). |
| **Shopify** | Real merchant integration via Shopify REST API (`test: true` orders). |
| **Supabase** | Managed PostgreSQL 17.6 + Row-Level Security + Auth JWT issuance. |
| **Tavily** | Live, unpersonalised web price search across UK grocers. |
| **Fleek / Vercel** | Edge deployment and serverless route execution. |

---

## Standards Alignment (UCP / AP2)

Replenish Autopilot is designed around emerging open agentic commerce standards:
- **Universal Commerce Protocol (UCP):** Open protocol framework co-championed by Google, Shopify, Walmart, and major card networks.
- **Agent Payment Protocol (AP2):** Verifiable payment mandates allowing autonomous delegation without bearer credential exposure.

---

## Getting Started & Local Development

### Prerequisites
- Node.js 20+
- Supabase CLI
- Shopify Partner / Dev Store credentials

### Installation

```bash
# Clone the repository
git clone https://github.com/EXL-1/replenish-autopilot.git
cd replenish-autopilot

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env.local
```

### Environment Configuration (`.env.local`)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://inpoajxknyuuoyddeoqo.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsIn...
SUPABASE_SERVICE_ROLE_KEY=[REDACTED]

# xAI Grok
XAI_API_KEY=[REDACTED]

# Tavily Search
TAVILY_API_KEY=[REDACTED]

# Shopify Dev Store
SHOPIFY_STORE_DOMAIN=2026-9088.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=[REDACTED]
```

### Database Migration

```bash
# Link project and apply schema migrations
supabase link --project-ref inpoajxknyuuoyddeoqo
supabase db push
```

### Run Locally

```bash
npm run dev
# App will launch on http://localhost:3000
```

---

## Demo Run Sheet & Verification

```bash
# Reset demo state to clean baseline
npm run reset:demo

# Run automated policy engine verification suite (7/7 tests)
npm run check:policy
```

### Verification Suite Results

| Test Case | Expected Behavior | Result |
|---|---|---|
| Valid Token + Within Cap | Order permitted and placed | ✅ PASS |
| Exceeded Spend Cap (£45 on £40 cap) | Immediate rejection (`deny`) | ✅ PASS |
| Invalid Category (`electronics`) | Immediate rejection (`deny`) | ✅ PASS |
| Expired Token TTL | Immediate rejection (`deny`) | ✅ PASS |
| Revoked Spend Token | Immediate rejection (`deny`) | ✅ PASS |
| Unapproved Retailer | Immediate rejection (`deny`) | ✅ PASS |
| Missing / Tampered JWT | HTTP 401 Unauthorized | ✅ PASS |

---

## Known Trade-offs & Post-Hackathon Remediation

### Known Hackathon Trade-offs
1. **Demo Credentials in Client Bundle:** `app/page.tsx` contains test credentials so judges can test RLS with zero friction.
2. **Temporary JWT Expiration:** `jwt_exp` was set to 86,400s (24h) to avoid session expiry mid-presentation.

### Post-Hackathon Security Remediation Checklist
- [ ] **Rotate API Credentials:** Invalidate and rotate Shopify tokens, Supabase keys, Tavily, and xAI keys.
- [ ] **Restore Production JWT Expiration:** Lower Supabase `jwt_exp` back to standard 3,600s.
- [ ] **Remove Client Demo Passwords:** Transition to standard OAuth2 / Magic Link authentication.
- [ ] **Fix Cascade Deletion Bug:** Alter foreign key constraints in `audit_log` from `ON DELETE CASCADE` to `ON DELETE RESTRICT` so demo resets never wipe audit history.
- [ ] **Transactional Audit Inserts:** Wrap bare `audit_log` inserts in `order/route.ts` within transactional database functions.

---

## Documentation & Handover Artefacts

Comprehensive project documentation is maintained under `/docs`:
- [`docs/RUNSHEET.md`](./docs/RUNSHEET.md) — 120-second live demonstration beat sheet.
- [`CONTRACT.md`](./CONTRACT.md) — Frozen API and data interface specification (10:30 BST milestone).
- [`docs/Replenish_Autopilot_Consolidated_Summary.docx`](./docs/Replenish_Autopilot_Consolidated_Summary.docx) — Master executive Word document synthesizing all hackathon plans, architecture audits, and handover logs.

---

## License

This project is licensed under the [MIT License](./LICENSE).  
Copyright © 2026 Lucas Malik & Gabriel Moura.
