# Zeroid

AI-powered lead generation, qualification, and sales automation SaaS. Owned
by Codes & Bytes. Sibling product to `../closa` (sales training/coaching —
different problem, separate codebase). Working name was "Lead AI" until
2026-08-30 — renamed to Zeroid; domain **zeroid.net** to be registered
later (not yet owned, don't reference it as live anywhere).

**Status: Phase 1 complete except items blocked on `../platform-services`;
Phase 2 started.** No git repo yet — everything below lives only on this
machine's disk right now.

### Built and verified (real browser walkthroughs + automated tests, not just written)

- **Auth & multi-tenancy:** signup/login/logout, Organization →
  OrgMembership(role) → Business, Postgres RLS on every tenant table
  (`FORCE ROW LEVEL SECURITY` + policy), app-level scoping via
  `src/lib/tenant-db.ts` as the primary defense. `tests/rls.test.ts` proves
  the RLS backstop actually blocks unscoped/cross-tenant queries (7 cases,
  including the Invite-token self-lookup mechanism).
- **Team management:** invite-by-link (no email service configured, so the
  owner/admin shares the link themselves — `/team`), role-gated permissions
  (verified: a `sales`-role user is correctly blocked from creating a
  business), multi-org session switching (`/api/auth/switch-org`).
- **Business setup:** Product CRUD, ICP profiles (manual).
- **Lead capture & CRM:** manual entry + CSV import (`src/lib/csv.ts`, no
  library needed at this volume), unified per-lead event timeline, CRM
  pipeline stages, configurable lead scoring (`src/lib/scoring.ts` — weighted
  average over whatever qualification factors are filled in; weights per
  business in `ScoringConfig`, auto-seeded on business creation).
- **Human handoff:** a lead reaching `hot` auto-creates a `Task`
  (`/businesses/[id]/handoff`) — verified end-to-end including "mark done."
- **AI abstraction layer** (`src/lib/ai/`): provider interface, a real
  Claude adapter (`@anthropic-ai/sdk`), task→model routing, and credit
  metering (`AiUsageLog` + `AiCreditWallet` debit) — all verified with a
  fake provider in `tests/ai-metering.test.ts` (7 cases total across both
  test files) so the plumbing is proven without spending real tokens
  (no `ANTHROPIC_API_KEY` is set in this repo — see Known limitations).
- **`ANTHROPIC_API_KEY` is configured and every AI feature is verified with
  real output** (2026-08-30): AI follow-up drafts, the organic content
  studio, and **AI-suggested qualification factors** (paste in what you know
  about a lead, AI proposes the 7 scoring factors + a one-line rationale —
  `src/app/api/businesses/[id]/leads/[leadId]/qualify`) — all "AI Suggest"
  tier (build-spec §37): the AI fills in a form, a human reviews and clicks
  Save/Send, nothing is auto-sent or auto-saved. Follow-up drafts are also
  **situation-aware** now (`src/lib/follow-up-situations.ts` — thinking it
  over / too expensive / needs approval / not ready / comparing
  alternatives / interested but busy / no response, per vision doc §28) —
  verified live: a "too expensive" draft correctly reframed around value
  with zero invented discount; an AI-suggested qualification on a
  logistics-company lead correctly scored ICP fit at 15/100 (this business
  sells coaching) while still flagging high problem severity/urgency,
  landing the lead at a hand-verified score of 58.
- **Referrals & appointments** (Phase 2): logged from a lead's detail page,
  listed at `/businesses/[id]/referrals`; appointments are manual/internal
  only — no Google Calendar sync yet.
- **Analytics:** per-business dashboard (`/businesses/[id]/analytics`) —
  lead/stage/source counts, deals won, AI credits used, wallet balance.
- **Billing:** informational only (`/billing`) — plan, status, credit
  balance. No live Stripe checkout; purchasing is disabled until
  `STRIPE_SECRET_KEY` is configured.

### Known limitations / what's genuinely blocked

- **Train Your AI and WhatsApp are not built at all** — both wait on
  `../platform-services`' extraction from Skynett landing first, per the
  sequencing decision in `docs/build-spec.md` §0/§13.
- **Prospecting and email automation are not built** — both need real
  third-party credentials (licensed data providers; an email
  provider/SMTP key) this account doesn't have configured. Don't build fake
  integrations for these — wire them for real once keys exist.
- **No git repo.** Everything above exists only on disk. Worth `git init` +
  an initial commit before this gets any bigger — deliberately not done
  automatically since committing wasn't asked for.
- Still a single Next.js app, not yet split into the `apps/web` +
  `apps/worker` monorepo layout `docs/build-spec.md` §4 describes —
  deliberate, since no background worker is needed yet. Split when the
  first background job (embeddings, scheduled follow-ups) actually lands.

**Gotchas:**
- After `prisma migrate dev` adds/changes fields while `next dev` is already
  running, the running dev server can keep using a stale `@prisma/client`
  even after `prisma generate` — if you hit "Unknown argument" on a field
  that's definitely in `schema.prisma`, kill and restart `next dev` (find
  the `cmd.exe`/`next dev` process tree and `taskkill /T /F` it on Windows)
  rather than debugging the code.
- If this project's directory ever gets renamed/moved again, `rm -rf .next`
  before the next `next dev` start. Turbopack's dev cache holds absolute
  paths — after this repo was renamed once without clearing it, one route
  silently 404'd (a real Next.js framework 404, not a JSON error from the
  route's own code) even though the file was present and correct on disk.

See [`docs/build-spec.md`](docs/build-spec.md) for the master engineering
document. [`docs/original-vision.md`](docs/original-vision.md) is the
source product brief, kept for feature reference.

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # RLS + AI-metering test suite (no API key needed)
```

Requires a local Postgres with a `zeroid_dev` role/database — see
`.env.example`. `DATABASE_URL` goes in `.env` (Prisma 7's config loader reads
`.env`, not `.env.local`), same split as `../closa`. Add a real
`ANTHROPIC_API_KEY` to `.env.local` to exercise the AI-calling features.
