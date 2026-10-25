# B2B email campaigns (Phase 1) — built 2026-10-25

Structure mirrors Skynett: **Business → Campaign → Segment → Sequence → Messages**.

- **Segment** — a saved filter over a business's leads (channel, stage, paid/organic, score band,
  created window, company). Always requires an email address.
- **Campaign** — segment + sending identity + business-hours window + a 1–6 step **Sequence**
  (each step: delay in days, subject, body with `{{firstName}} {{company}} {{senderName}}`,
  optional AI opening line).
- **Message** — one row per lead per step (`CampaignMessage`). The table is also the queue.
- **SendingIdentity** — from-address, **physical postal address (printed in every email)**, daily cap
  (warm-up ramp 20% → 100% over 14 days), per-recipient-domain hourly cap, provider.
- **Suppression** — business-level and platform-wide (`businessId NULL`) lists.
- **EmailEvent** — sent / blocked / opened / clicked / replied / bounced / unsubscribed / complained.

## The safeguard (read this before touching sending)

The shared Brevo account also sends Flux9, Moneyvarsity, Academytest and Lead CRM mail. A spam
wave from it would hurt all of them. So `src/lib/email-campaigns/guard.ts` is enforced **inside every
sender**, immediately before the network call, not just in the campaign engine:

1. A `brevo_shared` identity is **always sandboxed** (no flag changes that).
2. Any identity with `sandboxOnly = true` is sandboxed (the default for every new identity).
3. Live sending also needs `CAMPAIGN_ALLOW_LIVE_SENDING=true` on the server.
4. A sandboxed send is allowed only to an address **exactly** on `CAMPAIGN_SANDBOX_ALLOWLIST`
   (full addresses, comma-separated; no wildcards or domains). An empty list sends nothing.

Proof: `tests/email-guard.test.ts` (11) and the engine tests, including one where a campaign on the
shared Brevo identity is run against a real-prospect address and an allow-listed address — exactly
one network call is made, to the allow-listed address, and the prospect is `skipped` + a `blocked`
event. Mutation-checked: breaking the guard makes 12 tests fail.

## How sending works

`worker/index.ts` (PM2 process `zeroid-worker`) ticks every 30 s (`WORKER_TICK_MS`). Per business it
claims due messages with `FOR UPDATE SKIP LOCKED` (so a second worker is safe) and, per message:
suppression check → stopped-sequence check (reply/unsub/bounce/complaint) → business-hours window
(campaign timezone, or `lead.contact.timezone`) → per-domain hourly cap → render (+ optional AI line)
→ send through the pluggable sender → record events → schedule the next step.
`npm run worker:once` runs a single pass and prints the result.

Launch (`launchCampaign`) expands the segment, de-duplicates by address, drops suppressed and
syntactically/MX-invalid addresses (parallel, one lookup per unique domain, 4 s timeout, timeouts
count as OK), and **refuses to start while any step still contains `[[double bracket]]` template prompts**.

## Senders

| provider | what it is | state |
|---|---|---|
| `brevo_shared` | shared Brevo REST API | sandbox only, forever |
| `smtp` | nodemailer to any SMTP host (own Postfix later, or a relay), DKIM-signed in the app | ready; needs a server + domain |

## Public endpoints (no session)

- `GET /u/<token>` unsubscribes **immediately**; `POST` handles RFC 8058 one-click and the
  "Stop all Zeroid senders" (platform-wide) button. Every email carries `List-Unsubscribe` +
  `List-Unsubscribe-Post`, the postal address and the link.
- `GET /t/o/<token>.gif` open pixel; `GET /t/c/<token>?u=&s=` click redirect (HMAC-signed so it is
  not an open redirect).
- `POST /api/inbound/email` (header `x-inbound-secret: $INBOUND_EMAIL_SECRET`, raw RFC 822 body):
  bounces (hard 5.x.x → platform-wide suppression; soft 4.x.x → recorded only), spam complaints
  (suppression), replies. Matching: `In-Reply-To`/`References` → our Message-ID, `X-Zeroid-Message`
  header (bounces quote it), or the `+token` in the reply address.
- Reply classes: `interested` (creates a Task, lead → engaged), `not_now` (stops sequence),
  `out_of_office` (sequence continues), `unsubscribe` (suppresses), `other` (creates a *review* Task).
  Rules first (free); ambiguous replies get one cheap AI call (Gemini fallback via the credit wallet);
  if the AI is unavailable the reply becomes `other` → a human task, never a wrong automatic decision.

## Environment

| var | purpose |
|---|---|
| `CAMPAIGN_SANDBOX_ALLOWLIST` | full addresses allowed while sandboxed (owner + test inboxes) |
| `CAMPAIGN_ALLOW_LIVE_SENDING` | `true` only when a real identity + domain + server exist |
| `APP_BASE_URL` | public origin used in unsubscribe/tracking links |
| `INBOUND_EMAIL_SECRET` | shared secret for `/api/inbound/email` |
| `EMAIL_LINK_SECRET` | optional; falls back to `SESSION_SECRET` |
| `WORKER_TICK_MS`, `MX_TIMEOUT_MS` | optional tuning |

Run the worker: `npm run worker` (PM2: `tsx --env-file=.env worker/index.ts`).

## Honest limits

- **Not yet sent through real Brevo from here:** Brevo rejects this laptop's IP (401 "unrecognised IP").
  The real-delivery test to the owner's own inbox has to be run from the server.
- No own MTA / DKIM DNS / dedicated sending domain exists yet; the SMTP sender is built and unit-covered
  only against fakes (not a live SMTP server).
- Inbound mail needs a delivery path (Postfix pipe or relay webhook → `/api/inbound/email`). With Brevo
  alone, replies go to the reply-to inbox and are **not** captured automatically.
- SMTP password and DKIM key are stored in the database in plain text (same as WhatsApp tokens);
  encrypt before taking other people's credentials.
- Open tracking is approximate (image blocking, Apple Mail privacy prefetch).
- The unsubscribe link unsubscribes on GET (no confirmation click): a security scanner that prefetches
  links can unsubscribe a real recipient. Chosen so unsubscribes can never silently fail.
- Phase 2 (large-scale discovery, own enrichment, per-address confidence) is not started.
