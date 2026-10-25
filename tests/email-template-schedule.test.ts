import { beforeAll, describe, expect, it } from "vitest";
import { effectiveDailyCap, isInsideWindow, nextAllowedTime } from "../src/lib/email-campaigns/schedule";
import {
  buildMessage,
  decodeUrl,
  encodeUrl,
  firstNameOf,
  plusAddress,
  renderTemplate,
  signLink,
  verifyLink,
} from "../src/lib/email-campaigns/template";

beforeAll(() => {
  process.env.EMAIL_LINK_SECRET = "test-secret-for-link-signing";
});

describe("send window", () => {
  const lagos = { timezone: "Africa/Lagos", startHour: 9, endHour: 17, weekdaysOnly: true }; // UTC+1, no DST

  it("is inside on a weekday morning local time and outside at night", () => {
    // Mon 2026-10-26 10:00 Lagos = 09:00 UTC
    expect(isInsideWindow(new Date("2026-10-26T09:00:00Z"), lagos)).toBe(true);
    // Mon 2026-10-26 22:00 Lagos = 21:00 UTC
    expect(isInsideWindow(new Date("2026-10-26T21:00:00Z"), lagos)).toBe(false);
  });

  it("is closed on weekends when weekdaysOnly", () => {
    expect(isInsideWindow(new Date("2026-10-24T10:00:00Z"), lagos)).toBe(false); // Saturday
    expect(isInsideWindow(new Date("2026-10-24T10:00:00Z"), { ...lagos, weekdaysOnly: false })).toBe(true);
  });

  it("moves a Friday-evening time to Monday 09:00 local", () => {
    const fridayNight = new Date("2026-10-23T20:30:00Z"); // Fri 21:30 Lagos
    const next = nextAllowedTime(fridayNight, lagos);
    expect(next.toISOString()).toBe("2026-10-26T08:00:00.000Z"); // Mon 09:00 Lagos
  });

  it("leaves a time that is already inside the window untouched", () => {
    const t = new Date("2026-10-27T11:07:00Z");
    expect(nextAllowedTime(t, lagos).getTime()).toBe(t.getTime());
  });

  it("falls back to UTC for an invalid timezone instead of throwing", () => {
    expect(isInsideWindow(new Date("2026-10-26T10:00:00Z"), { ...lagos, timezone: "Not/AZone" })).toBe(true);
  });

  it("does not loop forever on a window that can never open", () => {
    const t = new Date("2026-10-26T10:00:00Z");
    const next = nextAllowedTime(t, { timezone: "UTC", startHour: 17, endHour: 9, weekdaysOnly: false });
    expect(next.getTime()).toBeGreaterThan(t.getTime());
  });
});

describe("warm-up ramp", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  it("is the full cap when there is no warm-up", () => expect(effectiveDailyCap(100, null, now)).toBe(100));
  it("starts at 20% and reaches the full cap after 14 days", () => {
    expect(effectiveDailyCap(100, new Date("2026-10-26T08:00:00Z"), now)).toBe(20);
    expect(effectiveDailyCap(100, new Date("2026-10-12T10:00:00Z"), now)).toBe(100);
    const mid = effectiveDailyCap(100, new Date("2026-10-19T10:00:00Z"), now);
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(100);
  });
});

describe("templates", () => {
  it("fills placeholders case-insensitively and blanks unknown ones", () => {
    expect(renderTemplate("Hi {{ firstName }} at {{COMPANY}} {{nope}}!", { firstname: "Ada", company: "Acme" })).toBe("Hi Ada at Acme !");
  });

  it("builds a sentence-case first name and falls back to there", () => {
    expect(firstNameOf("ADA OBI")).toBe("Ada");
    expect(firstNameOf("  chidi  okafor")).toBe("Chidi");
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf("info@acme.com")).toBe("there");
  });

  const build = (over: Partial<Parameters<typeof buildMessage>[0]> = {}) =>
    buildMessage({
      subjectTemplate: "Quick question, {{firstName}}",
      bodyTemplate: "Hi {{firstName}},\n\nSee https://acme.example/pricing for details.\n\nRegards",
      vars: { firstName: "Ada", company: "Acme" },
      token: "tok123",
      baseUrl: "https://zeroid.example",
      fromName: "Kelechi at Deep Projects",
      fromEmail: "kelechi@deep.example",
      physicalAddress: "12 Marina Road, Lagos, Nigeria",
      ...over,
    });

  it("always includes the physical address and a working unsubscribe link, in both parts", () => {
    const m = build();
    for (const part of [m.text, m.html]) {
      expect(part).toContain("12 Marina Road, Lagos, Nigeria");
      expect(part).toContain("https://zeroid.example/u/tok123");
    }
    expect(m.headers["List-Unsubscribe"]).toBe("<https://zeroid.example/u/tok123>");
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("rewrites body links to signed tracked links and adds an open pixel", () => {
    const m = build();
    const match = m.html.match(/https:\/\/zeroid\.example\/t\/c\/tok123\?u=([^&"]+)&s=([a-f0-9]+)/);
    expect(match).not.toBeNull();
    const url = decodeUrl(match![1]);
    expect(url).toBe("https://acme.example/pricing");
    expect(verifyLink("tok123", url, match![2])).toBe(true);
    expect(m.html).toContain("https://zeroid.example/t/o/tok123.gif");
  });

  it("a signature for one URL cannot be reused for another (no open redirect)", () => {
    const sig = signLink("tok123", "https://acme.example/pricing");
    expect(verifyLink("tok123", "https://evil.example/", sig)).toBe(false);
    expect(verifyLink("othertoken", "https://acme.example/pricing", sig)).toBe(false);
    expect(decodeUrl(encodeUrl("https://a.b/c?d=é"))).toBe("https://a.b/c?d=é");
  });

  it("escapes HTML coming from lead data so it cannot inject markup", () => {
    const m = build({ vars: { firstName: "<script>alert(1)</script>", company: "A&B" } });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("strips newlines from the subject (header injection)", () => {
    const m = build({ subjectTemplate: "Hello\r\nBcc: attacker@evil.com" });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("puts the token in the reply address so replies can be matched", () => {
    expect(plusAddress("kelechi@deep.example", "tok123")).toBe("kelechi+tok123@deep.example");
    expect(plusAddress("kelechi+old@deep.example", "tok123")).toBe("kelechi+tok123@deep.example");
    expect(build().replyTo).toBe("kelechi+tok123@deep.example");
  });
});
