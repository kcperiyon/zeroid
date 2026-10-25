import nodemailer from "nodemailer";
import { assertSendAllowed } from "./guard";
import { openSecret } from "@/lib/secrets";

/**
 * Pluggable senders. Each one calls assertSendAllowed() immediately before touching the network,
 * so the sandbox allow-list holds no matter who calls it (see guard.ts).
 *
 *  - brevo_shared: the shared Brevo account -- sandbox only, for tests to the owner own inboxes.
 *  - smtp:         our own MTA (or any SMTP relay). Signs with DKIM here, in the app.
 */

export type SenderIdentity = {
  provider: "brevo_shared" | "smtp";
  sandboxOnly: boolean;
  fromEmail: string;
  fromName: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  smtpPass?: string | null;
  dkimDomain?: string | null;
  dkimSelector?: string | null;
  dkimPrivateKey?: string | null;
};

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  replyTo: string;
  /** RFC 5322 Message-ID including angle brackets; used to match replies and bounces. */
  messageId: string;
};

export type SendResult = { mode: "sandbox" | "live"; providerId?: string };

export interface EmailSender {
  send(identity: SenderIdentity, email: OutgoingEmail): Promise<SendResult>;
}

const sandboxSubject = (mode: "sandbox" | "live", subject: string) =>
  mode === "sandbox" ? `[Zeroid sandbox] ${subject}` : subject;

export const brevoSharedSender: EmailSender = {
  async send(identity, email) {
    const mode = assertSendAllowed(identity, email.to);

    const apiKey = process.env.BREVO_API_KEY;
    const fromEmail = process.env.BREVO_FROM_EMAIL; // the one address verified in Brevo
    if (!apiKey || !fromEmail) throw new Error("BREVO_API_KEY / BREVO_FROM_EMAIL are not configured.");

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: fromEmail, name: identity.fromName },
        to: [{ email: email.to }],
        replyTo: { email: email.replyTo },
        subject: sandboxSubject(mode, email.subject),
        htmlContent: email.html,
        textContent: email.text,
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new Error(`Brevo send failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const body = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { mode, providerId: body.messageId };
  },
};

export const smtpSender: EmailSender = {
  async send(identity, email) {
    const mode = assertSendAllowed(identity, email.to);
    if (!identity.smtpHost) throw new Error("This sending identity has no SMTP host configured.");

    const transport = nodemailer.createTransport({
      host: identity.smtpHost,
      port: identity.smtpPort ?? (identity.smtpSecure ? 465 : 587),
      secure: Boolean(identity.smtpSecure),
      auth: identity.smtpUser ? { user: identity.smtpUser, pass: openSecret(identity.smtpPass) ?? "" } : undefined,
      dkim:
        identity.dkimDomain && identity.dkimSelector && identity.dkimPrivateKey
          ? { domainName: identity.dkimDomain, keySelector: identity.dkimSelector, privateKey: openSecret(identity.dkimPrivateKey) ?? "" }
          : undefined,
    });
    const info = await transport.sendMail({
      from: { name: identity.fromName, address: identity.fromEmail },
      to: email.to,
      replyTo: email.replyTo,
      subject: sandboxSubject(mode, email.subject),
      text: email.text,
      html: email.html,
      headers: email.headers,
      messageId: email.messageId,
    });
    return { mode, providerId: info.messageId };
  },
};

// A mutable registry so tests can swap in a fake sender; production code never mutates it.
export const SENDERS: Record<SenderIdentity["provider"], EmailSender> = {
  brevo_shared: brevoSharedSender,
  smtp: smtpSender,
};
