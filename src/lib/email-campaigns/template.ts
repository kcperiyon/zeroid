import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Rendering of one campaign email: placeholders, plain-text -> HTML, the mandatory footer (physical
 * address + unsubscribe link), tracked links, open pixel and the one-click unsubscribe headers.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sentence-case first name ("JOHN smith" -> "John"); "there" when unknown. */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || /[@\d]/.test(first)) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Replaces {{placeholders}} (case-insensitive). Unknown placeholders become empty, never raw braces. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const lower = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => lower[key.toLowerCase()] ?? "");
}

// --- link signing (prevents the click tracker from being an open redirect) ------------------

function signingKey(): string {
  const key = process.env.EMAIL_LINK_SECRET ?? process.env.SESSION_SECRET;
  if (!key) throw new Error("EMAIL_LINK_SECRET (or SESSION_SECRET) is required to sign tracked links.");
  return key;
}

export function signLink(token: string, url: string): string {
  return createHmac("sha256", signingKey()).update(`${token}|${url}`).digest("hex").slice(0, 32);
}

export function verifyLink(token: string, url: string, signature: string): boolean {
  const expected = Buffer.from(signLink(token, url));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export const encodeUrl = (url: string) => Buffer.from(url, "utf8").toString("base64url");
export const decodeUrl = (encoded: string) => Buffer.from(encoded, "base64url").toString("utf8");

export function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// --- building the message ------------------------------------------------------------------

export type BuildInput = {
  subjectTemplate: string;
  bodyTemplate: string;
  vars: Record<string, string>;
  token: string;
  baseUrl: string;
  fromName: string;
  fromEmail: string;
  replyToEmail?: string | null;
  physicalAddress: string;
  /** Optional AI-written opening line placed before the body (already plain text). */
  openingLine?: string | null;
};

export type BuiltMessage = {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  replyTo: string;
  unsubscribeUrl: string;
};

/** name@example.com -> name+token@example.com, so a reply can be matched even without Message-ID. */
export function plusAddress(email: string, token: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  return `${email.slice(0, at).split("+")[0]}+${token}${email.slice(at)}`;
}

function linkify(text: string, token: string, baseUrl: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
    const url = raw.replace(/[.,;:!?)]+$/, "");
    const trailing = raw.slice(url.length);
    const tracked = `${baseUrl}/t/c/${token}?u=${encodeUrl(url)}&s=${signLink(token, url)}`;
    return `<a href="${tracked}">${url}</a>${trailing}`;
  });
}

export function buildMessage(input: BuildInput): BuiltMessage {
  const { token, baseUrl } = input;
  const subject = renderTemplate(input.subjectTemplate, input.vars).replace(/[\r\n]+/g, " ").trim();
  const bodyText = [input.openingLine?.trim(), renderTemplate(input.bodyTemplate, input.vars).trim()]
    .filter(Boolean)
    .join("\n\n");
  const unsubscribeUrl = `${baseUrl}/u/${token}`;

  const text =
    `${bodyText}\n\n--\n${input.fromName}\n${input.physicalAddress}\n\n` +
    `Not interested? Unsubscribe: ${unsubscribeUrl}\n`;

  // Escape FIRST, then linkify, so recipient-controlled text can never inject markup.
  const paragraphs = escapeHtml(bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${linkify(p, token, baseUrl).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1c2c52">` +
    paragraphs +
    `<p style="margin:18px 0 0;font-size:12px;color:#6b7a99">${escapeHtml(input.fromName)}<br>` +
    `${escapeHtml(input.physicalAddress)}<br>` +
    `<a href="${unsubscribeUrl}" style="color:#6b7a99">Unsubscribe</a></p>` +
    `<img src="${baseUrl}/t/o/${token}.gif" width="1" height="1" alt="" style="display:block;border:0">` +
    `</div>`;

  return {
    subject,
    text,
    html,
    headers: {
      // RFC 2369 + RFC 8058 one-click unsubscribe -- required by Gmail/Yahoo for bulk senders.
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-Zeroid-Message": token,
    },
    replyTo: plusAddress(input.replyToEmail || input.fromEmail, token),
    unsubscribeUrl,
  };
}
