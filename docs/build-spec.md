# Zeroid — Build Specification

Status: **Phase 1 built (except platform-services-gated items) + Phase 2
started — see §11/§12 build-status addendums and `../README.md`.** This is
the master engineering document — read this before writing anything. It
supersedes the original vision doc
(`docs/original-vision.md`) wherever the two disagree; the vision doc stays as
product/feature reference, this doc is what gets built.

Owned by Codes & Bytes. Sibling product to **Closa** (sales training/coaching —
`../closa`) — different problem (Zeroid = acquisition + qualification + CRM;
Closa = training reps). Keep them as separate codebases; do not merge.

Also closely related to **Skynett** (`../skynett-local`), an existing live AI
sales-agent product with heavy conceptual overlap (multi-business accounts,
per-business AI training, multi-provider LLM routing, WhatsApp Cloud API).
Decision: do not merge the two *products* — different customer promise and
pricing model (Skynett = BYOK conversational agent; Zeroid = platform-billed
acquisition+CRM platform). Instead, share the two pieces of infra that are
genuinely identical needs: WhatsApp Cloud API messaging and per-tenant
knowledge/RAG, extracted into `../platform-services` (unbranded working name,
no domain yet — see that repo's `docs/build-spec.md`). Zeroid's Phase 1
items 4 and 7 (§11 below) consume that service instead of building bespoke
WhatsApp/knowledge infrastructure from scratch.

---

## 1. Product, in one sentence

A multi-tenant SaaS where a business trains an AI on itself, and that AI runs a
closed loop — attract → find → engage → qualify → score → nurture → book →
handoff → learn — across organic content, paid ads, and direct messaging
channels, feeding one CRM and one attribution timeline per lead.

North star metric: **revenue per 1,000 leads**, not lead count.

---

## 2. What changed from the original vision doc, and why

The original doc (68 sections) is a strong product brief. As a *build* spec it
has a few things I'm deliberately altering:

1. **Prospecting via scraping (§20) is a legal-risk trap.** Scraping LinkedIn,
   Instagram, etc. against their ToS is a lawsuit and account-ban vector, and
   "confidence/fit score on scraped prospects" is exactly the kind of feature
   that gets a SaaS company sued or its IP banned at scale. **Alteration:**
   Phase 2 prospecting ships against licensed data providers with real APIs
   (Apollo.io, Clearbit/Breeze, People Data Labs) and inbound/owned data
   (customer's own CRM import, site visitors, ad engagers) only. No scraping
   of platforms whose ToS forbids it. This is a hard constraint, not a
   preference.

2. **12 "AI agents" (§53) is over-architected for an MVP.** An agent-per-noun
   design multiplies prompts, memory scopes, and failure surfaces before
   there's a single paying tenant. **Alteration:** build one AI abstraction
   layer with *task functions* (`generate`, `classify`, `score`, `qualify`,
   `summarize`, `research`) as in §8, and compose "agents" as prompt configs +
   tool bindings on top of that layer, not as separate services. Split into
   real separate services only when a task's latency/cost/reliability profile
   actually demands isolation (background research vs. inline chat reply).

3. **Tenant isolation must be enforced at the database, not just in
   application code.** App-level `WHERE business_id = ?` scoping is easy to
   miss on one query and never notice until it leaks. **Alteration:** Postgres
   Row-Level Security (RLS) on every tenant-scoped table, with the app setting
   a session variable (`app.business_id`) per request. App-level scoping stays
   as the primary defense (better error messages, better query plans); RLS is
   the backstop that makes a missed `WHERE` clause fail closed instead of
   leaking. This is the single highest-priority non-functional requirement in
   this document — build it in step 1, not bolted on later.

4. **Lead scoring weights (§25) must be per-business config, not a global
   constant.** A ₦150k coaching offer and a $50k enterprise contract have
   different budget/urgency curves. Store weights in a `scoring_config` table
   keyed by business, seed sane defaults, let admins edit.

5. **AI credit costs (§7) need a floor tied to actual provider cost**, updated
   automatically, not hand-set once. Store `credit_to_usd_rate` and a
   per-model `usd_cost_per_1k_tokens` table; compute credits consumed from
   actual token usage returned by the provider, not a flat "5 credits per
   qualification call" — flat rates only work until someone sends a 40-message
   qualification conversation through a 1-credit action.

6. **Payment abstraction (§57):** given prior work on this account (Flutterwave
   live on Mongozutu and Flux9, Paystack retired on Flux9), default to
   **Stripe** for USD/global subscriptions + Stripe Billing metered usage
   (it's the only one of the three with first-class usage-based billing), and
   **Flutterwave** for NGN/Africa — same payment-abstraction-layer pattern
   already proven on Flux9. Paystack: skip initially, add only if a customer
   needs it.

7. **WhatsApp via official Cloud API only**, never an unofficial bridge
   (Evolution-style). This account has already hit the failure mode of an
   unofficial WhatsApp bridge silently going dark in production (Skynett) —
   don't repeat it here.

8. Everything else in the vision doc (multi-business accounts, Train Your AI,
   ICP engine, qualification framework, human-control tiers, integration
   framework) is sound and carried forward as written, just made concrete
   below.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui | Fast to ship, matches Closa's stack, one hiring/context profile |
| API | Next.js Route Handlers for CRUD; dedicated Node worker service for AI/background/integration work | Keeps request path fast; long AI calls never block HTTP workers |
| DB | PostgreSQL 16+ with `pgvector` | One database for relational + embeddings; RLS gives real tenant isolation; avoids running a separate vector DB in MVP |
| ORM | Prisma | Matches Closa; RLS requires raw session-variable SQL per request (Prisma middleware handles this, see §5) |
| Queue | Redis + BullMQ | Standard, battle-tested, good retry/backoff primitives |
| Object storage | Cloudflare R2 | Already in use elsewhere on this account (Mongozutu); S3-compatible, cheap egress |
| Auth | Auth.js (NextAuth) credentials + session table in Postgres | JWT carries `user_id` only — org/business membership is looked up from DB per request, never trusted from a stale claim |
| AI providers | Claude (default/premium), OpenAI (fallback), Kimi (cheap tier) behind one abstraction | See §7 |
| Payments | Stripe (global) + Flutterwave (NGN/Africa) behind one abstraction | See §2.6 |
| Messaging | WhatsApp Cloud API (official), Postmark or SES for email | No unofficial bridges |
| Monorepo | Turborepo, `apps/web`, `apps/worker`, `packages/db`, `packages/ai`, `packages/integrations`, `packages/shared` | Matches "swap providers without rewriting core" requirement from §66 |

---

## 4. Repo layout

```text
zeroid/
  apps/
    web/                 # Next.js app — UI + CRUD route handlers
    worker/               # BullMQ workers: AI calls, integrations, embeddings, analytics
  packages/
    db/                   # Prisma schema, migrations, RLS policies, seed scripts
    ai/                   # Provider adapters + routing + credit metering (packages/ai/src/providers/*)
    integrations/         # Integration adapter interface + per-platform adapters
    payments/             # Payment provider abstraction (stripe.ts, flutterwave.ts)
    shared/                # Types, zod schemas, constants shared across apps
  docs/
    build-spec.md          # this file
    original-vision.md     # the source doc, unmodified, kept for feature reference
```

---

## 5. Multi-tenancy & data isolation (build this first)

Hierarchy: `Organization` → `Business` → everything else (leads, campaigns,
knowledge, conversations).

**Two layers, both mandatory:**

1. **App-level scoping.** Every Prisma query for a tenant-owned model goes
   through a query-builder wrapper that injects `business_id` (or
   `organization_id` for org-level models) from the authenticated request
   context. No route handler calls `prisma.lead.findMany()` directly — it
   calls `db.forBusiness(businessId).lead.findMany()`.

2. **Postgres RLS.** Every tenant-scoped table gets:

```sql
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leads
  USING (business_id = current_setting('app.business_id')::uuid);
```

   A Prisma middleware (or a `$transaction` wrapper) runs
   `SET LOCAL app.business_id = '<id>'` at the start of every request
   transaction, sourced from the verified session → membership lookup, never
   from a client-supplied header or JWT claim.

**Why both:** app-level scoping gives good error messages and correct query
plans; RLS means that if a developer (or an AI code-gen pass) ever forgets a
`WHERE`, the database returns zero rows instead of another tenant's data. Test
this explicitly: the test suite must include a test that queries as Tenant A
with a deliberately unscoped query and asserts Tenant B's rows never come
back.

AI-specific isolation: every embedding row and every knowledge chunk carries
`business_id`; vector search queries are always
`WHERE business_id = $1 ORDER BY embedding <-> $2`, never global similarity
search. RLS applies to the embeddings table too.

---

## 6. Data model (MVP entities)

Condensed — full field lists live in `packages/db/schema.prisma` once code
starts. Relationships only, with tenant-scope column noted.

```text
User                (id, email, password_hash, name)
Organization         (id, name, owner_user_id)
OrgMembership         (org_id, user_id, role: owner|admin|manager|sales|marketing|viewer)
Business              (id, org_id*, name, industry, settings jsonb)
Product               (id, business_id*, name, price, description)
KnowledgeSource        (id, business_id*, type: text|pdf|url|doc, status)
KnowledgeChunk          (id, business_id*, source_id, content, embedding vector(1536))
AiInstruction            (id, business_id*, content, priority, status)
IcpProfile                (id, business_id*, attributes jsonb, source: manual|ai_discovered)
ScoringConfig               (id, business_id*, weights jsonb)  -- §2.4
LeadSource                    (id, business_id*, channel, integration_id)
Lead                            (id, business_id*, source_id, contact jsonb, icp_score, status)
LeadEvent                        (id, lead_id, type, payload jsonb, created_at)  -- unified timeline, §35
Conversation                      (id, lead_id, channel, ai_mode: suggest|assist|automate|autopilot)
Message                            (id, conversation_id, role, content, tokens_used)
Appointment                          (id, lead_id, calendar_integration_id, start_at, status)
Deal                                  (id, lead_id, business_id*, stage, value, won_at)
FollowUpSequence                       (id, business_id*, trigger_situation, steps jsonb)
Campaign                                (id, business_id*, channel, type: organic|paid, status)
CampaignVariant                          (id, campaign_id, creative jsonb, performance jsonb)
Integration                               (id, business_id*, provider, credentials_encrypted, capabilities jsonb)
Subscription                               (id, org_id*, plan, status, stripe/flutterwave ref)
UsageRecord                                 (id, org_id*, business_id, metric, quantity, period)
AiUsageLog                                   (id, business_id*, task, model, tokens_in, tokens_out, credits_charged)
AuditLog                                      (id, org_id*, actor_id, action, target, created_at)
```

`*` = RLS-protected column. `Organization`-level tables use `org_id`; everything
under a business uses `business_id`.

---

## 7. AI abstraction layer (`packages/ai`)

```ts
interface AiProvider {
  name: string;
  generate(input: GenerateInput): Promise<AiResult>;
  classify(input: ClassifyInput): Promise<AiResult>;
  embed(input: EmbedInput): Promise<number[]>;
  // ...score, summarize, extract, research — same shape
}
```

- One adapter per provider (`providers/claude.ts`, `providers/openai.ts`,
  `providers/kimi.ts`, `providers/voyage.ts` for embeddings), each
  implementing the same interface and declaring cost per 1k tokens.
- A `router.ts` picks provider+model per task, driven by a DB-backed config
  (`task -> {default_model, fallback_model, low_cost_model}`), editable by
  platform admins without a deploy. Default seed values:

  | Task | Default | Fallback | Low-cost tier |
  |---|---|---|---|
  | Qualification conversation (real-time chat) | Claude Sonnet 5 | GPT-5-class | Kimi K2 |
  | Deep research / sales-intelligence / campaign strategy | Claude Opus 5 | GPT-5-class | — (never downgraded, low volume) |
  | Lead classification / scoring / tagging | Haiku 4.5 | GPT-5-mini-class | Kimi K2 |
  | Content generation (bulk, organic engine) | Haiku 4.5 | GPT-5-mini-class | Kimi K2 |
  | Embeddings | Voyage AI (Anthropic's recommended partner — Claude itself has no embeddings endpoint) | OpenAI `text-embedding-3-small` | same |

  Rationale: qualification chat and cheap classification have opposite
  cost/latency/quality needs — running the premium model on every scoring
  call would break the credit economics in §9; running the cheap model on
  live qualification chat would visibly degrade prospect handling. The
  low-cost tier exists specifically so trial/free-plan tenants don't burn
  AI margin (this account already hit that failure mode on Skynett: trial
  tenants defaulting to a weak free model because no tier was defined).
- Every call goes through `withMetering()`: runs the call, records
  `AiUsageLog` with actual token counts, converts to credits via the live
  `usd_cost_per_1k_tokens` rate, decrements the business's credit balance.
  If the call fails, log the failure, don't charge credits, retry via BullMQ
  with backoff for retryable errors (rate limit, timeout).
- Prompts are assembled from layered context (system rules + business context
  + product + ICP + conversation + lead + task + compliance + output format)
  exactly as in the original doc's §54 — implement this as a
  `buildPrompt(layers[])` composer, not string concatenation scattered across
  call sites.

---

## 8. Integration framework (`packages/integrations`)

```ts
interface IntegrationAdapter {
  provider: string;
  capabilities: Capability[];   // e.g. ['send_message','webhooks','campaigns']
  connect(orgId, authCode): Promise<Credentials>;
  refreshToken(credentials): Promise<Credentials>;
  handleWebhook(payload): Promise<NormalizedEvent[]>;
  // capability-gated methods below — only called if declared
  sendMessage?(to, content): Promise<void>;
  createCampaign?(spec): Promise<CampaignRef>;
  getAnalytics?(ref): Promise<AnalyticsSnapshot>;
}
```

- Credentials encrypted at rest (libsodium sealed box or KMS-wrapped AES),
  never logged, never returned to the frontend beyond "connected/expires_at".
- Webhooks land on a single `/api/webhooks/:provider` route, get verified
  (signature check per provider), pushed onto a BullMQ queue, and normalized
  into `LeadEvent`/`Message` rows by a worker — the rest of the app never
  talks to a provider's raw payload shape.
- Token refresh is a scheduled worker job per integration, not on-demand-only,
  so a token doesn't silently expire mid-conversation.
- Failed webhook processing retries with exponential backoff; after N
  failures it raises an `Integration` health flag surfaced in the UI
  (Integrations Centre, §39) rather than failing silently.

Build order inside this framework: WhatsApp and email first (MVP requires
them); everything else in §39's list is a second adapter written against the
same interface once the first two prove it out — do not design custom logic
per provider outside the adapter boundary.

**WhatsApp specifically is a thin adapter over `../platform-services`'
Channels service, not a from-scratch integration.** That service already
solved the Meta Cloud API gotchas (WABA app-subscription per number, webhook
verify handshake, 24h free-form-reply window vs. templates) against a real
number in production via Skynett. Zeroid's adapter registers each business
as a tenant on that service and implements `sendMessage`/`handleWebhook`
against its API (see `platform-services/docs/build-spec.md` §3.1) rather than
talking to Meta's Graph API directly.

---

## 9. Billing & AI credits

- `Subscription` tracks plan + status, mirrored from Stripe (global) or
  Flutterwave (NGN) via webhook, same dual-provider pattern already live on
  Flux9/Mongozutu.
- Lead volume limits are soft (notify at 80%/100%, never hard-cut an active
  conversation) — per §6 of the vision doc, unchanged.
- AI credits are a separate wallet per organization (shared across that org's
  businesses, unless the plan says otherwise). Purchasable top-ups via the
  same payment abstraction.
- Every credit-consuming action must go through `withMetering()` (§7) — there
  must be no code path that calls an AI provider directly.

---

## 10. Security checklist (non-negotiable for MVP)

- [ ] RLS enabled on every tenant table, tested with an explicit
      cross-tenant-leak test in CI
- [ ] Passwords hashed with argon2id
- [ ] All integration credentials encrypted at rest
- [ ] Session/JWT carries only `user_id`; role/membership resolved from DB per
      request
- [ ] Rate limiting on auth endpoints and public webhook endpoints
- [ ] Audit log on: role changes, integration connect/disconnect, credential
      access, deal/lead deletion, subscription changes
- [ ] Webhook signature verification per provider before any processing
- [ ] No autonomous action in the "risk" list (§56 of vision doc — launching
      ads, discounts, mass sends, deletions) executes without the business
      being in `autopilot` mode for that specific action category, and even
      then, logged with a one-click undo window where the provider supports it

---

## 11. MVP (Phase 1) — concrete scope

Ship these, nothing else, before onboarding a first real business:

1. Auth + Organization + Business creation, RLS wired end-to-end
2. Role-based membership (owner/admin/manager/sales/viewer — marketing role
   deferred to Phase 2 since organic/paid engines aren't built yet)
3. Product/service CRUD per business
4. Train Your AI: text + PDF/doc upload + URL ingestion, delegated to
   `../platform-services`' Knowledge service (§8 above) — `KnowledgeSource`
   rows in Zeroid's own DB track status/metadata, but chunking/embedding/
   retrieval happens in the shared service, not reimplemented here
5. AI abstraction layer live with Claude as default provider (OpenAI adapter
   stubbed, not required to be wired to a live key yet)
6. ICP builder (manual only — AI-discovered ICP is Phase 2, needs conversion
   history data this account won't have yet)
7. Lead capture: manual entry, CSV import, webhook endpoint (generic + one
   real provider: WhatsApp inbound via the shared Channels service, §8 above)
8. Universal lead profile + unified `LeadEvent` timeline
9. AI qualification conversation over WhatsApp (Conversation Agent + Qualification
   Agent as prompt configs, per §2.2 above)
10. Lead scoring with per-business configurable weights
11. CRM pipeline (fixed default stages + ability to rename, custom stages
    deferred)
12. Human handoff: when AI marks a lead ready, create a task + summary for the
    assigned salesperson
13. Basic AI follow-up (one default sequence type: "no response"), full
    situation-based sequence library is Phase 2
14. Basic analytics: leads, qualified, hot, appointments, conversion rate —
    the dashboard in §34, trimmed to what Phase 1 data actually supports
15. Subscription (Stripe only for Phase 1 — Flutterwave adapter can wait until
    a Phase 1 customer actually needs NGN billing) + AI credit metering live
    from day one (§9) — do not let this be an afterthought, it's load-bearing
    for margins from the very first paying customer

Explicitly **not** in Phase 1: organic content engine, prospecting, paid
advertising, referral engine, appointment self-serve booking UI (manual entry
only), team management beyond basic roles, AI Autopilot mode (Suggest/Assist
only — see §37 of vision doc), white-labelling.

### Build status (2026-08-30)

Items 1–3, 5, 6, 7 (manual/CSV; WhatsApp inbound still blocked), 8, 10–14 are
built and verified — real browser walkthroughs plus an automated test suite
(`tests/rls.test.ts`, `tests/ai-metering.test.ts`). Item 15 is partial:
credit metering is fully live (every AI call debits `AiCreditWallet` and
logs `AiUsageLog`), but there's no live Stripe checkout — `/billing` is
informational-only, purchasing disabled until `STRIPE_SECRET_KEY` exists.
Item 9 (WhatsApp qualification) is correctly still blocked on
`../platform-services`. Team management (originally scoped as "beyond basic
roles" → Phase 2) got pulled forward and built in Phase 1 instead, once it
became clear owner/admin-only accounts made Phase 1 hard to actually use —
see `../README.md` for the full built/not-built breakdown and honest
limitations (no `ANTHROPIC_API_KEY` configured, no git repo yet).

The AI abstraction layer (item 5) shipped with `task_generation`/
`content_generation`/`follow_up_draft` wired to real features (follow-up
drafts, an organic content studio pulled forward from Phase 2 — see §12
below), not just the interface. Both are "AI Suggest" tier (§37): draft
only, a human sends/posts.

---

## 12. Phase roadmap (unchanged in spirit from vision doc §50–52)

- **Phase 2:** organic content engine, licensed-data prospecting (§2.1),
  appointment self-serve booking + calendar integrations, referral engine,
  email automation, full follow-up sequence library, team management,
  AI-discovered ICP (needs Phase 1 conversion data to exist first).

  **Started 2026-08-30:** organic content engine (`/businesses/[id]/content`
  — AI drafts, human posts, no platform auto-posting integration), referral
  engine (logged manually from a lead, no automated post-purchase trigger
  yet since there's no billing/purchase event to hook), appointments
  (manual/internal booking only, `Appointment.externalCalendarEventId`
  reserved for when real Google Calendar OAuth exists — don't build that
  integration without real credentials). Team management already landed in
  Phase 1 (see §11 build status). **Not started, and don't build without
  real credentials first:** licensed-data prospecting (needs an actual
  Apollo/Clearbit/PDL account) and email automation (needs a real
  provider key) — building either against fake/placeholder credentials
  would violate the cost-discipline and honesty principles in §14.
- **Phase 3:** paid advertising (Meta/Google Ads adapters), campaign creative
  generation + testing, multi-touch attribution, AI sales intelligence
  (pattern-mining across campaigns/sources/reps), predictive lead scoring.
- **Phase 4:** AI Autopilot for approved action categories, advanced
  autonomous prospecting, white-labelling, custom AI agents, enterprise
  controls (custom roles, SSO).

---

## 13. Decisions (owner delegated to Claude's recommendation, 2026-08-30)

- **Billing rail: Stripe first, confirmed.** Stripe is the only one of the
  three candidates with first-class metered usage-billing, which the AI
  credit system (§9) needs from day one — Flutterwave doesn't model
  metered/overage billing as natively. The vision doc's target users (§3:
  coaches, consultants, agencies, SMEs) also skew global, not NG-exclusive,
  unlike this account's other products. Flutterwave gets added in Phase 2 as
  a second rail once a real NGN customer needs it, same dual-provider
  pattern already proven on Flux9/Mongozutu — just not first.
- **First messaging channel: WhatsApp, confirmed.** Matches the vision doc's
  §40 emphasis, and is now lower-risk than originally scoped: it's a thin
  adapter over `../platform-services`' Channels service (§8), which is
  already a verified-clean extraction of Skynett's production-proven Meta
  Cloud API gateway (see `platform-services/docs/build-spec.md` §8) rather
  than a from-scratch Meta integration.
- **Hosting: start on the existing shared Contabo box, move off it before
  real usage, confirmed.** Zeroid is pre-revenue and spec-only — spinning up
  a dedicated VPS before there's a paying tenant is cost with no offsetting
  need yet. Develop and stage Zeroid (and `platform-services`, initially) on
  the existing shared box, each as its own isolated process/port range, same
  as how Closa and other spec-stage products on this account started. Move
  Zeroid's worker (background AI/embedding load) to a dedicated box before
  the first paying tenant onboards, or sooner if embedding/AI job volume on
  the shared box visibly affects the other six products already on it.
- **Sequencing vs. `../platform-services`, confirmed:** that repo's
  extraction happens first, fully, before Zeroid Phase 1 items 4 and 7
  (Train Your AI, WhatsApp) start — see its §0 for the full reasoning. Every
  *other* Phase 1 item (auth, multi-tenancy/RLS, product CRUD, ICP builder,
  lead capture/CRM skeleton, lead scoring, the AI abstraction layer itself)
  has no dependency on that repo and starts immediately, in parallel.

---

## 14. Cost discipline (standing constraint, set 2026-08-30)

Owner directive: keep this at zero or near-zero cost until real usage or a
paying tenant justifies spend. This shapes every infra choice above, made
explicit here so it doesn't get re-argued piecemeal later:

- **No managed cloud services where self-hosting on the existing shared
  Contabo box works** — Postgres (with pgvector), Redis, and both apps
  (`web`, `worker`) run there via PM2, not on a new VPS, not on Vercel, not
  on a managed DB provider. This is already the pattern for every other
  product on this account.
- **R2 for storage** (free tier, no egress fees, already proven on
  Mongozutu), not S3.
- **Brevo for email** (already integrated for Flux9, free tier), not a new
  provider.
- **AI/embedding spend stays usage-based, not a standing bill** — the credit
  system (§9) exists specifically so token cost is passed to the customer,
  not eaten by the platform. Zero usage genuinely means zero AI spend.
- **During development**, prefer the Ollama instance already running on the
  shared box (used by Skynett) for testing the AI abstraction layer's
  routing/metering logic itself; reserve real Claude/OpenAI API calls for
  final verification, not every iteration — keeps build-phase token spend
  near zero.
- **Explicitly deferred, not built into Phase 1 cost:** a dedicated VPS
  (only once the shared box is visibly strained or a paying tenant needs
  isolation), licensed prospecting data providers like Apollo/Clearbit/PDL
  (Phase 2, only once a paying customer needs prospecting), and Zeroid's
  own domain purchase (trivial cost, but no reason to buy it before there's
  something to point it at). **The intended domain is `zeroid.net`**
  (decided 2026-08-30, not yet registered) — register it when there's
  actually something to deploy to it, not before.
- The only costs that scale before revenue does: small real-token spend
  during final AI verification passes, and Meta's WhatsApp conversation
  pricing beyond its free monthly allowance if test volume is unusually
  high — both negligible at pilot scale.
