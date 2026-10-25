import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INDUSTRIES, isCustomOsmTag, resolveIndustry } from "../src/lib/discovery/industries";
import { countryFromAddress, domainOf, gridCells, isCompanySite, normalizeName, phoneKey } from "../src/lib/discovery/normalize";
import { buildOverpassQuery, parseOverpass } from "../src/lib/discovery/osm";
import { cleanEmail, decodeCloudflareEmail, extractFacts, extractPeople } from "../src/lib/discovery/extract";
import { applyPattern, inferPattern, scoreEmail, splitName, DEFAULT_SEND_THRESHOLD, type ScoreInput } from "../src/lib/discovery/emails";
import { isPrivateAddress, parseRobots, PoliteCrawler, safeGet, BlockedError } from "../src/lib/discovery/web";
import { _resetProbeCaches, probeMailbox } from "../src/lib/discovery/smtp-probe";
import { enrichProspect } from "../src/lib/discovery/enrich";
import { buildResearchNote } from "../src/lib/discovery/note";

describe("industries", () => {
  it("every catalog entry has tags in strict key=value form", () => {
    for (const i of INDUSTRIES) for (const t of i.osm) expect(isCustomOsmTag(t), `${i.key}: ${t}`).toBe(true);
  });
  it("accepts a custom OSM tag but refuses anything that could inject Overpass QL", () => {
    expect(resolveIndustry("osm:shop=furniture")?.osm).toEqual(["shop=furniture"]);
    expect(resolveIndustry('osm:shop=x"];out;')).toBeNull();
    expect(resolveIndustry("osm:a=b;c=d")).toBeNull();
    expect(resolveIndustry("nonsense")).toBeNull();
  });
});

describe("normalisation", () => {
  it("extracts the company domain and rejects IPs, socials and junk", () => {
    expect(domainOf("https://www.Acme-Freight.com/contact?x=1")).toBe("acme-freight.com");
    expect(domainOf("acmefreight.ng")).toBe("acmefreight.ng");
    expect(domainOf("http://127.0.0.1:3000")).toBeNull();
    expect(domainOf("javascript:alert(1)")).toBeNull();
    expect(domainOf("not a url")).toBeNull();
    expect(isCompanySite("facebook.com")).toBe(false);
    expect(isCompanySite("m.facebook.com")).toBe(false);
    expect(isCompanySite("acme.com")).toBe(true);
  });
  it("matches phones by their last digits and names ignoring company suffixes", () => {
    expect(phoneKey("+234 (707) 296-3805")).toBe(phoneKey("07072963805"));
    expect(phoneKey("123")).toBeNull();
    expect(normalizeName("The Acme Freight Ltd.")).toBe(normalizeName("ACME  Freight"));
  });
  it("cuts a box into a grid and refuses an oversized one instead of thinning it", () => {
    const cells = gridCells({ south: 6.3, north: 6.6, west: 3.2, east: 3.5 }, 0.1, 100)!;
    expect(cells).toHaveLength(9);
    expect(cells[0].south).toBeCloseTo(6.3);
    expect(Math.max(...cells.map((c) => c.north))).toBeCloseTo(6.6);
    expect(gridCells({ south: 6.3, north: 6.5, west: 3.2, east: 3.4 }, 0.1, 100)).toHaveLength(4); // floating-point spans must not add a sliver row
    expect(gridCells({ south: 0, north: 10, west: 0, east: 10 }, 0.1, 100)).toBeNull();
    expect(gridCells({ south: 1, north: 1, west: 0, east: 1 })).toBeNull();
  });
  it("reads the country off the end of an address", () => {
    expect(countryFromAddress("12 Allen Ave, Ikeja, Lagos, Nigeria")).toBe("Nigeria");
    expect(countryFromAddress("12 Allen Ave, 100001")).toBeNull();
  });
});

describe("OpenStreetMap parsing", () => {
  const ind = resolveIndustry("accountants")!;
  it("builds a bbox query with one clause per tag", () => {
    const q = buildOverpassQuery(ind, { south: 6.4, west: 3.3, north: 6.5, east: 3.4 });
    expect(q).toContain('nwr["office"="accountant"]["name"](6.40000,3.30000,6.50000,3.40000);');
    expect(q).toContain('nwr["office"="tax_advisor"]');
    expect(q).toContain("out center tags");
  });
  it("turns elements into candidates, skipping nameless ones and social 'websites'", () => {
    const out = parseOverpass(
      {
        elements: [
          { type: "node", id: 1, lat: 6.45, lon: 3.35, tags: { name: "Okafor & Co", website: "https://www.okafor.ng", "contact:email": "Info@Okafor.ng; sales@okafor.ng", phone: "+234 1 234", "addr:street": "Allen Ave", "addr:city": "Ikeja", "addr:country": "Nigeria" } },
          { type: "way", id: 2, center: { lat: 6.46, lon: 3.36 }, tags: { name: "Social Only", website: "https://facebook.com/socialonly" } },
          { type: "node", id: 3, tags: { office: "accountant" } },
        ],
      },
      ind
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ externalId: "node/1", name: "Okafor & Co", email: "info@okafor.ng", website: "https://www.okafor.ng", lat: 6.45 });
    expect(out[0].address).toContain("Allen Ave");
    expect(out[1]).toMatchObject({ externalId: "way/2", website: null, lat: 6.46 });
  });
});

describe("robots.txt", () => {
  const robots = `
User-agent: *
Disallow: /private/
Disallow: /*.pdf$
Allow: /private/public-info
Crawl-delay: 3

User-agent: ZeroidBot
Disallow: /secret
`;
  it("uses our own group when present, ignoring the * group", () => {
    const r = parseRobots(robots);
    expect(r.allows("/secret/x")).toBe(false);
    expect(r.allows("/private/anything")).toBe(true);
    expect(r.crawlDelaySec).toBeNull();
  });
  it("applies * rules with wildcard, end anchor, longest-match and Allow overrides", () => {
    const r = parseRobots(robots.replace("ZeroidBot", "SomeoneElse"));
    expect(r.allows("/private/data")).toBe(false);
    expect(r.allows("/private/public-info/page")).toBe(true);
    expect(r.allows("/files/brochure.pdf")).toBe(false);
    expect(r.allows("/files/brochure.pdf.html")).toBe(true);
    expect(r.crawlDelaySec).toBe(3);
  });
  it("treats an empty Disallow and a missing file as allow-all, and a full block as block-all", () => {
    expect(parseRobots("User-agent: *\nDisallow:\n").allows("/x")).toBe(true);
    expect(parseRobots("").allows("/x")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /\n").allows("/contact")).toBe(false);
  });
});

describe("SSRF protection", () => {
  it("classifies private, loopback, link-local and mapped addresses as unsafe", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("refuses to fetch private IPs, odd ports and credentials before any connection is made", async () => {
    await expect(safeGet("http://127.0.0.1/")).rejects.toBeInstanceOf(BlockedError);
    await expect(safeGet("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(BlockedError);
    await expect(safeGet("https://example.com:8443/")).rejects.toBeInstanceOf(BlockedError);
    await expect(safeGet("https://user:pw@example.com/")).rejects.toBeInstanceOf(BlockedError);
    await expect(safeGet("ftp://example.com/")).rejects.toBeInstanceOf(BlockedError);
  });
  it("blocks a hostname that resolves to loopback (checked at connect time)", async () => {
    await expect(safeGet("http://localhost/")).rejects.toBeInstanceOf(BlockedError);
  });
});

describe("polite crawler against a real local server", () => {
  let server: http.Server;
  let base: string;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/robots.txt") return void res.end("User-agent: *\nDisallow: /private\n");
      if (req.url === "/redir") return void res.writeHead(302, { Location: "/page" }).end();
      if (req.url === "/big") return void res.writeHead(200, { "Content-Type": "text/html" }).end("x".repeat(3_000_000));
      if (req.url === "/img") return void res.writeHead(200, { "Content-Type": "image/png" }).end("PNG");
      res.writeHead(200, { "Content-Type": "text/html" }).end("<html><title>Hi</title></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("reads allowed pages, follows redirects, and never requests a robots-disallowed path", async () => {
    const c = new PoliteCrawler({ allowPrivate: true, minDelayMs: 0 });
    const ok = await c.get(`${base}/redir`);
    expect(ok.ok && ok.html).toContain("<title>Hi</title>");
    const blocked = await c.get(`${base}/private/secret`);
    expect(blocked).toMatchObject({ ok: false, reason: "robots" });
    expect(hits).not.toContain("/private/secret");
    expect(hits.filter((h) => h === "/robots.txt")).toHaveLength(1); // cached per host
  });
  it("caps body size and skips non-text content", async () => {
    const r = await safeGet(`${base}/big`, { allowPrivate: true, maxBytes: 100_000 });
    expect(r.body.length).toBeLessThanOrEqual(110_000);
    const img = await safeGet(`${base}/img`, { allowPrivate: true });
    expect(img.body).toBe("");
  });
  it("spaces requests to the same host by the minimum delay", async () => {
    const c = new PoliteCrawler({ allowPrivate: true, minDelayMs: 250 });
    const t0 = Date.now();
    await c.get(`${base}/a`);
    await c.get(`${base}/b`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(480); // robots + 2 pages = 3 requests, 2 gaps
  });
});

describe("email extraction", () => {
  it("cleans addresses and rejects look-alikes and placeholders", () => {
    expect(cleanEmail("mailto:Sales@Acme.COM?subject=Hi")).toBe("sales@acme.com");
    expect(cleanEmail("logo@2x.png")).toBeNull();
    expect(cleanEmail("you@example.com")).toBeNull();
    expect(cleanEmail("name@yourdomain.com")).toBeNull();
    expect(cleanEmail("a@b")).toBeNull();
    expect(cleanEmail("abc@sentry.io")).toBeNull();
  });
  it("decodes Cloudflare-protected addresses", () => {
    const key = 0x2a;
    const hex = [key, ...Buffer.from("jo@acme.test").map((b) => b ^ key)].map((n) => n.toString(16).padStart(2, "0")).join("");
    expect(decodeCloudflareEmail(hex)).toBe("jo@acme.test");
    expect(decodeCloudflareEmail("zz")).toBeNull();
  });
  const html = `<!doctype html><html lang="en"><head><title>Acme Freight &amp; Logistics</title>
    <meta name="description" content="Road freight across West Africa.">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"Organization","name":"Acme","email":"hello@acme.test","telephone":"+234 1 234 5678","sameAs":["https://www.linkedin.com/company/acme"]},
      {"@type":"Person","name":"Ada Okafor","jobTitle":"Managing Director","email":"ada.okafor@acme.test"}]}</script></head>
    <body><a href="mailto:Sales@acme.test?subject=x">Email sales</a>
    <a href="/contact-us">Contact</a><a href="/about/team">Team</a><a href="/blog/post-1">Blog</a>
    <a href="tel:+2348012345678">Call</a><a href="https://facebook.com/acmefreight">FB</a>
    <p>Write to support [at] acme [dot] test or <a class="__cf_email__" data-cfemail="2a40454f4a6a4b494f4b04535445">[email&#160;protected]</a></p>
    <p>Chidi Eze, Head of Operations</p><p>Contact: info@acme.test.</p>
    <img src="logo@2x.png"></body></html>`;
  it("finds mailto, JSON-LD, Cloudflare, obfuscated and plain-text addresses once each", () => {
    const f = extractFacts(html, "https://acme.test/");
    const byEmail = Object.fromEntries(f.emails.map((e) => [e.email, e.via]));
    expect(byEmail["hello@acme.test"]).toBe("jsonld");
    expect(byEmail["ada.okafor@acme.test"]).toBe("jsonld");
    expect(byEmail["sales@acme.test"]).toBe("mailto");
    expect(byEmail["support@acme.test"]).toBe("obfuscated");
    expect(byEmail["info@acme.test"]).toBe("text");
    expect(f.emails.filter((e) => e.email === "sales@acme.test")).toHaveLength(1);
    expect(f.emails.map((e) => e.email)).not.toContain("logo@2x.png");
  });
  it("collects facts: title, description, language, phones, social links, same-site contact pages", () => {
    const f = extractFacts(html, "https://acme.test/");
    expect(f.title).toBe("Acme Freight & Logistics");
    expect(f.description).toBe("Road freight across West Africa.");
    expect(f.lang).toBe("en");
    expect(f.phones).toEqual(expect.arrayContaining(["+234 1 234 5678", "+2348012345678"]));
    expect(f.socials).toEqual(expect.arrayContaining(["https://www.linkedin.com/company/acme", "https://facebook.com/acmefreight"]));
    expect(f.contactLinks).toEqual(expect.arrayContaining(["https://acme.test/contact-us", "https://acme.test/about/team"]));
    expect(f.contactLinks.some((l) => l.includes("/blog"))).toBe(false);
  });
  it("finds named people with titles, from JSON-LD and from visible text, without matching nav text", () => {
    const f = extractFacts(html, "https://acme.test/");
    expect(f.people).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Ada Okafor", title: "Managing Director" }), expect.objectContaining({ name: "Chidi Eze" })]));
    expect(extractPeople("Contact Us, Director of nothing\nMeet The Team - Manager")).toEqual([]);
  });
});

describe("name patterns", () => {
  it("splits names, ignoring titles and initials", () => {
    expect(splitName("Dr. Ada N. Okafor")).toEqual({ first: "ada", last: "okafor" });
    expect(splitName("Chidi")).toBeNull();
    expect(splitName("José Álvarez")).toEqual({ first: "jose", last: "alvarez" });
  });
  it("infers the pattern only when the evidence is clear", () => {
    const known = [
      { email: "ada.okafor@acme.test", personName: "Ada Okafor" },
      { email: "chidi.eze@acme.test", personName: "Chidi Eze" },
    ];
    expect(inferPattern(known, "acme.test")).toBe("first.last");
    expect(applyPattern("first.last", { first: "ngozi", last: "bello" })).toBe("ngozi.bello");
    expect(inferPattern([{ email: "ada@acme.test", personName: "Ada Okafor" }], "acme.test")).toBe("first");
    expect(inferPattern([{ email: "ada@acme.test", personName: "Ada Okafor" }], "other.test")).toBeNull();
    // "ada@" fits only `first`; "chidi.eze@" only `first.last` -> a tie, so no claim.
    expect(inferPattern([{ email: "ada@acme.test", personName: "Ada Okafor" }, { email: "chidi.eze@acme.test", personName: "Chidi Eze" }], "acme.test")).toBeNull();
  });
});

describe("confidence scoring", () => {
  const base: ScoreInput = { email: "ada.okafor@acme.test", via: "mailto", kind: "found", siteDomain: "acme.test", mxOk: true, smtp: "unchecked", catchAll: null, pagesSeen: 1, hasPersonName: true, patternObserved: false };
  it("scores an address published on its own domain well above the send threshold, but never 100", () => {
    const r = scoreEmail(base);
    expect(r.confidence).toBeGreaterThanOrEqual(85);
    expect(r.confidence).toBeLessThanOrEqual(95);
    expect(r.reasons.length).toBeGreaterThan(2);
  });
  it("caps dead domains, disposable domains, automated inboxes and SMTP rejections near zero", () => {
    expect(scoreEmail({ ...base, mxOk: false }).confidence).toBeLessThanOrEqual(5);
    expect(scoreEmail({ ...base, email: "x@mailinator.com", siteDomain: "mailinator.com" }).confidence).toBeLessThanOrEqual(5);
    expect(scoreEmail({ ...base, email: "noreply@acme.test", hasPersonName: false }).confidence).toBeLessThanOrEqual(5);
    expect(scoreEmail({ ...base, smtp: "rejected" }).confidence).toBeLessThanOrEqual(5);
  });
  it("marks role addresses and lowers free-mail and off-domain addresses", () => {
    const role = scoreEmail({ ...base, email: "info@acme.test", kind: "role", hasPersonName: false });
    expect(role.reasons.join(" ")).toMatch(/role address/i);
    expect(scoreEmail({ ...base, email: "ada@gmail.com" }).confidence).toBeLessThan(scoreEmail(base).confidence);
    expect(scoreEmail({ ...base, email: "ada@parent.test" }).confidence).toBeLessThan(scoreEmail(base).confidence);
  });
  it("never lets a guessed address reach the send threshold without a real SMTP confirmation", () => {
    const guess: ScoreInput = { ...base, via: "pattern", kind: "pattern_guess", pagesSeen: 1, patternObserved: true };
    const unconfirmed = scoreEmail(guess);
    expect(unconfirmed.confidence).toBeLessThan(DEFAULT_SEND_THRESHOLD);
    expect(scoreEmail({ ...guess, smtp: "accepted", catchAll: false }).confidence).toBeGreaterThanOrEqual(DEFAULT_SEND_THRESHOLD);
    // A catch-all server "accepts" everything, so acceptance proves nothing.
    expect(scoreEmail({ ...guess, smtp: "accepted", catchAll: true }).confidence).toBeLessThan(DEFAULT_SEND_THRESHOLD);
    expect(scoreEmail({ ...guess, patternObserved: false, smtp: "unchecked" }).confidence).toBeLessThan(DEFAULT_SEND_THRESHOLD);
  });
});

describe("SMTP mailbox probe against a fake mail server", () => {
  let server: net.Server;
  let port: number;
  const log: string[] = [];
  let mode: "normal" | "catchall" | "greylist" = "normal";
  beforeAll(async () => {
    server = net.createServer((s) => {
      s.on("error", () => {}); // the client hangs up abruptly after RSET
      s.write("220 fake ESMTP\r\n");
      let buf = "";
      s.on("data", (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          log.push(line);
          if (/^EHLO/i.test(line)) s.write("250-fake\r\n250 8BITMIME\r\n");
          else if (/^MAIL FROM/i.test(line)) s.write("250 ok\r\n");
          else if (/^RCPT TO/i.test(line)) {
            const rcpt = line.match(/<(.+)>/)![1];
            if (mode === "greylist") s.write("451 4.7.1 try later\r\n");
            else if (mode === "catchall" || rcpt.startsWith("ada@")) s.write("250 ok\r\n");
            else s.write("550 5.1.1 User unknown\r\n");
          } else if (/^RSET/i.test(line)) s.write("250 ok\r\n");
          else if (/^QUIT/i.test(line)) s.end("221 bye\r\n");
          else s.write("500 what\r\n");
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());
  const deps = () => ({ helo: "mail.sender.test", from: "probe@sender.test", port, gapMs: 0, resolveMx: async () => ["127.0.0.1"] });

  it("is off unless configured", async () => {
    expect((await probeMailbox("ada@acme.test", { resolveMx: async () => ["127.0.0.1"], port })).detail).toMatch(/not configured/);
  });
  it("accepts a real mailbox, rejects a missing one, and detects a non-catch-all server; never sends DATA", async () => {
    _resetProbeCaches();
    log.length = 0;
    expect(await probeMailbox("ada@acme.test", deps())).toEqual({ smtp: "accepted", catchAll: false });
    _resetProbeCaches();
    expect(await probeMailbox("nobody@acme.test", deps())).toMatchObject({ smtp: "rejected", catchAll: false });
    expect(log.some((l) => /^DATA/i.test(l))).toBe(false);
  });
  it("flags a catch-all server, and treats greylisting as unknown rather than as a rejection", async () => {
    _resetProbeCaches();
    mode = "catchall";
    expect(await probeMailbox("ada@catchall.test", deps())).toEqual({ smtp: "accepted", catchAll: true });
    _resetProbeCaches();
    mode = "greylist";
    expect((await probeMailbox("ada@grey.test", deps())).smtp).toBe("unknown");
    mode = "normal";
  });
  it("reports unknown, not a failure, when the server cannot be reached", async () => {
    _resetProbeCaches();
    const r = await probeMailbox("ada@down.test", { ...deps(), port: 1, timeoutMs: 1500 });
    expect(r.smtp).toBe("unknown");
  });
});

describe("enrichment (canned pages, no network)", () => {
  const pages: Record<string, { status: number; body: string }> = {
    "https://acmefreight.test/robots.txt": { status: 404, body: "" },
    "https://acmefreight.test/": {
      status: 200,
      body: `<html lang="en"><head><title>Acme Freight</title><meta name="description" content="Road freight across West Africa."></head><body>
        <a href="/contact">Contact</a><a href="mailto:ada.okafor@acmefreight.test">Ada</a>
        <p>Ada Okafor, Managing Director</p><p>Chidi Eze, Head of Operations</p><p>Ngozi Bello, Finance Director</p></body></html>`,
    },
    "https://acmefreight.test/contact": { status: 200, body: `<html><body><a href="mailto:info@acmefreight.test">info</a> <a href="mailto:ada.okafor@acmefreight.test">Ada</a></body></html>` },
  };
  const fetchPage = async (url: string) => {
    const p = pages[url];
    if (!p) throw new Error("unreachable");
    return { status: p.status, contentType: "text/html", body: p.body, finalUrl: url };
  };
  const crawler = () => new PoliteCrawler({ fetchPage: fetchPage as never, minDelayMs: 0 });
  const input = { name: "Acme Freight", website: "https://acmefreight.test/", category: "Logistics and freight", address: "Ikeja, Lagos, Nigeria" };

  it("finds published addresses, ties them to people, and guesses only along the observed pattern", async () => {
    const r = await enrichProspect(input, { crawler: crawler(), mxCheck: async () => true, probeEnabled: false });
    expect(r.status).toBe("done");
    expect(r.signals.pagesRead).toHaveLength(2);
    const by = Object.fromEntries(r.emails.map((e) => [e.email, e]));
    expect(by["ada.okafor@acmefreight.test"]).toMatchObject({ kind: "found", personName: "Ada Okafor" });
    expect(by["ada.okafor@acmefreight.test"].confidence).toBeGreaterThanOrEqual(DEFAULT_SEND_THRESHOLD);
    expect(by["info@acmefreight.test"].kind).toBe("role");
    // Pattern first.last is observed, so the two other named people get a guess -- but never above the threshold.
    expect(by["chidi.eze@acmefreight.test"]).toMatchObject({ kind: "pattern_guess", smtp: "unchecked" });
    expect(by["chidi.eze@acmefreight.test"].confidence).toBeLessThan(DEFAULT_SEND_THRESHOLD);
    expect(r.emails[0].email).toBe("ada.okafor@acmefreight.test");
  });
  it("confirms a guess only when the mailbox check accepts it on a non catch-all server", async () => {
    const r = await enrichProspect(input, {
      crawler: crawler(), mxCheck: async () => true, probeEnabled: true,
      probe: async (e) => (e === "chidi.eze@acmefreight.test" ? { smtp: "accepted", catchAll: false } : { smtp: "rejected", catchAll: false }),
    });
    const by = Object.fromEntries(r.emails.map((e) => [e.email, e]));
    expect(by["chidi.eze@acmefreight.test"].confidence).toBeGreaterThanOrEqual(DEFAULT_SEND_THRESHOLD);
    expect(by["ngozi.bello@acmefreight.test"].confidence).toBeLessThanOrEqual(5);
  });
  it("does not guess at all when there is no observed pattern and no mailbox check", async () => {
    const noPattern = { ...pages };
    const c = new PoliteCrawler({
      fetchPage: (async (url: string) => (url === "https://acmefreight.test/" ? { status: 200, contentType: "text/html", finalUrl: url, body: `<html><body><p>Ada Okafor, Managing Director</p></body></html>` } : noPattern[url] ? { ...noPattern[url], contentType: "text/html", finalUrl: url } : Promise.reject(new Error("x")))) as never,
      minDelayMs: 0,
    });
    const r = await enrichProspect(input, { crawler: c, mxCheck: async () => true, probeEnabled: false });
    expect(r.emails.filter((e) => e.kind === "pattern_guess")).toHaveLength(0);
  });
  it("leaves a robots-blocked site alone and says why; reports an unreachable one as failed", async () => {
    const blocked = new PoliteCrawler({ fetchPage: (async (u: string) => ({ status: 200, contentType: "text/plain", finalUrl: u, body: "User-agent: *\nDisallow: /\n" })) as never, minDelayMs: 0 });
    const r1 = await enrichProspect(input, { crawler: blocked, mxCheck: async () => true });
    expect(r1).toMatchObject({ status: "skipped" });
    expect(r1.note).toMatch(/robots/i);
    const down = new PoliteCrawler({ fetchPage: (async () => { throw new Error("ECONNREFUSED"); }) as never, minDelayMs: 0 });
    expect((await enrichProspect(input, { crawler: down, mxCheck: async () => true })).status).toBe("failed");
  });
  it("skips prospects without a company site, but keeps an address the source itself listed", async () => {
    expect((await enrichProspect({ name: "No Site", website: null })).status).toBe("skipped");
    const social = await enrichProspect({ name: "Fb Only", website: "https://facebook.com/x", knownEmail: "owner@gmail.com" }, { mxCheck: async () => true });
    expect(social.status).toBe("done");
    expect(social.emails[0]).toMatchObject({ email: "owner@gmail.com", source: "source" });
  });
  it("writes a factual research note that states what it found and nothing more", async () => {
    const r = await enrichProspect(input, { crawler: crawler(), mxCheck: async () => true, probeEnabled: false });
    const note = buildResearchNote(input, r);
    expect(note).toContain("Acme Freight");
    expect(note).toContain("Road freight across West Africa");
    expect(note).toContain("Ada Okafor (Managing Director)");
    expect(note).toMatch(/Best contact: ada\.okafor@acmefreight\.test/);
    expect(note.length).toBeLessThanOrEqual(1200);
    const empty = buildResearchNote({ name: "Ghost Co" }, { domain: "ghost.test", emails: [], signals: { title: null, description: null, siteName: null, lang: null, tech: [], people: [], phones: [], socials: [], pagesRead: [], pagesBlocked: [] } });
    expect(empty).toContain("No email address was found");
  });
});
