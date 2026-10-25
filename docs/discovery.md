# Prospect discovery and enrichment (Phase 2) — built 2026-10-25

Finds B2B companies in bulk, reads their own public websites for contact details, scores every
email address, and hands only well-supported addresses to campaigns. Free sources only; no paid
data providers; nothing from LinkedIn, Facebook or Instagram.

## How it flows

1. **A search** (Discovery tab) = industries × places. Each place is looked up on OpenStreetMap
   (Nominatim), cut into 0.1° squares (~11 km), and every square × industry becomes one queued
   **cell**. A place too large for the grid, or too many cells, fails the job with a plain message
   instead of silently searching a thinned-out grid.
2. **Discovery** works the cells through Overpass (OpenStreetMap), one query every ~6 s with growing
   back-off when it says it is busy. Google Places is an optional second source (needs a working key).
3. **De-duplication** on every insert: same source id → same company domain → same phone (last 9
   digits) → same normalised name within ~300 m. A duplicate fills blank fields on the first record
   and is counted, never created. A company that is already a lead (same email, email domain or
   phone) is marked and not enriched. One prospect per domain per business is also enforced by a
   unique index.
4. **Enrichment** (own, free): reads the home page and up to four contact / about / team pages of the
   company's own site, then
   - extracts addresses (mailto, plain text, `[at]/[dot]` disguises, Cloudflare-protected, JSON-LD),
     people with titles, phones, social-profile links (recorded, never followed), site title and
     description, and the tech stack;
   - infers the company's address pattern from named people with published addresses, and offers
     guesses for other named people **only** along that pattern (or after a real mailbox check);
   - checks the domain accepts mail (MX), flags role inboxes (`info@`), automated mailboxes
     (`noreply@`), disposable and free-mail domains;
   - optionally asks the mail server whether the mailbox exists (SMTP `RCPT`, never sends a message),
     and whether it is a catch-all.
5. **Confidence** 0–100 per address, stored with the reasons (shown in the UI). Published on the
   company's own site on its own domain scores ~85–95; a guess scores below the threshold unless a
   mailbox check confirms it; dead domains, disposable domains, automated mailboxes and rejected
   mailboxes are capped near zero; nothing ever reaches 100 without a real delivery.
6. **Research note**: a factual paragraph per prospect (what they are, what their site says, tech,
   people, the best contact and why). No AI call. It is passed, labelled as untrusted website text, to
   the AI opening-line step of a campaign; the model's line is dropped if it contains a link, an
   address, markup or several lines.
7. **Import**: only an address at or above the business threshold (default **60**, settable per
   business via `settings.minEmailConfidence`, clamped 40–95) is copied onto the lead, with its
   confidence and the research note. A named person is preferred over a role inbox when both
   qualify. Nothing below the threshold can end up on a lead, so it cannot be mailed. Segments can
   require `minEmailConfidence`.

## Politeness and safety (enforced in `src/lib/discovery/web.ts`)

- User-agent `ZeroidBot/1.0 (+https://zeroid.moneyvarsity.net/bot)`; the `/bot` page explains it and
  how to opt out (robots.txt `User-agent: ZeroidBot`).
- **robots.txt is honoured** (our group first, then `*`, longest rule wins, `Crawl-delay` respected up
  to 10 s). A site that disallows us is left alone and recorded as skipped.
- At least 1.5 s between requests to one host; 8 s timeout; 1.5 MB cap; text/HTML only; at most 5
  pages per site.
- **SSRF protection**: the address actually connected to is checked at connect time (loopback,
  private, link-local, carrier-grade NAT and multicast ranges refused, including via DNS rebinding);
  only ports 80/443; no credentials in URLs; redirects re-checked at every hop.
- **Common Crawl fallback** is used only when the live site cannot be reached at all — never when a
  robots.txt said no. Archived addresses are marked and cannot reach the threshold without a mailbox
  check.
- Jobs have caps (max companies, max cells, 3 active searches per business).

## Running it

The worker (`npm run worker`, PM2 `zeroid-worker`) runs discovery on its **own loop** (every 20 s,
time-budgeted) so a slow crawl can never delay email sending. `npm run discovery:once` runs one pass
by hand. Queue rows stuck "running" after a crash are reclaimed after 10–15 minutes.

| var | purpose |
|---|---|
| `DISCOVERY_ENABLED` | `false` switches the loop off (default on; it only does anything when a search exists) |
| `DISCOVERY_TICK_MS` | loop interval, default 20000 |
| `OVERPASS_URL`, `NOMINATIM_URL` | alternative public or self-hosted mirrors |
| `OVERPASS_GAP_MS` | minimum gap between Overpass queries, default 6000 |
| `DISCOVERY_USER_AGENT`, `CRAWLER_USER_AGENT` | override the identifying user-agents |
| `SMTP_PROBE_HELO`, `SMTP_PROBE_FROM` | enable the mailbox check; must be a real hostname and mailbox of the sending domain. **Unset = check off.** |
| `COMMONCRAWL_INDEX`, `COMMONCRAWL_DATA` | alternative endpoints |

## Honest limits

- **OpenStreetMap coverage varies a lot by country.** Many businesses have no website or email tagged.
  In a first live test (accountants, one London district) 3 of 6 had no website; of the 3 with sites
  one yielded 14 real addresses, two had contact forms only. Expect modest yield per search; the
  value is in running many cells.
- The mailbox check (SMTP) is built and tested against a fake mail server only. It is off until a
  real sending domain exists, and port 25 may be blocked or rate-limited by some mail servers.
- "Public registries" is not implemented: the useful ones (Companies House etc.) need API keys. The
  source interface (`Candidate`) is ready for one.
- Google Places is wired but untested: the key still returns 403 for Places.
- The people detector is heuristic (title next to a capitalised name); it misses people shown only in
  images or scripts, and can miss unusual layouts.
- Role/free-mail/disposable lists are short and hand-kept.
- Overpass and Nominatim are shared public services. Heavy use should move to a self-hosted mirror.
- Nothing here checks local law on emailing companies in a given country; that remains the
  operator's responsibility (the unsubscribe, suppression and address rules of the sending engine
  apply to every campaign regardless).
