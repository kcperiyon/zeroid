import { z } from "zod";
import { looksLikeEmail } from "./suppression";
import { sealSecret } from "@/lib/secrets";

const emailField = z.string().trim().toLowerCase().refine(looksLikeEmail, "Enter a valid email address.");
const optionalEmail = emailField.optional().or(z.literal("").transform(() => undefined));

export const IdentityBase = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(["brevo_shared", "smtp"]),
  fromEmail: emailField,
  fromName: z.string().trim().min(1).max(80),
  replyToEmail: optionalEmail,
  physicalAddress: z.string().trim().min(8, "A real postal address is required (it appears in every email).").max(300),
  smtpHost: z.string().trim().max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(200).optional(),
  smtpPass: z.string().max(500).optional(),
  dkimDomain: z.string().trim().toLowerCase().max(200).optional(),
  dkimSelector: z.string().trim().max(100).optional(),
  dkimPrivateKey: z.string().max(5000).optional(),
  imapHost: z.string().trim().max(200).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  imapUser: z.string().trim().max(200).optional(),
  imapPass: z.string().max(500).optional(),
  imapFolder: z.string().trim().max(100).optional(),
  dailyCap: z.number().int().min(1).max(5000).optional(),
  perDomainHourlyCap: z.number().int().min(1).max(500).optional(),
});

export const IdentityCreateSchema = IdentityBase;
export const IdentityUpdateSchema = IdentityBase.partial().extend({
  active: z.boolean().optional(),
  sandboxOnly: z.boolean().optional(),
});

/** Secrets are encrypted before they reach the database; blank means "leave unchanged" on update. */
export function sealIdentitySecrets<T extends { smtpPass?: string; dkimPrivateKey?: string; imapPass?: string }>(d: T) {
  return {
    ...(d.smtpPass ? { smtpPass: sealSecret(d.smtpPass) } : {}),
    ...(d.dkimPrivateKey ? { dkimPrivateKey: sealSecret(d.dkimPrivateKey) } : {}),
    ...(d.imapPass ? { imapPass: sealSecret(d.imapPass) } : {}),
  };
}

/** Never send secrets back to the browser. */
export const publicIdentity = <T extends { smtpPass: string | null; dkimPrivateKey: string | null; imapPass: string | null }>(i: T) => {
  const { smtpPass, dkimPrivateKey, imapPass, ...rest } = i;
  return { ...rest, hasSmtpPassword: Boolean(smtpPass), hasDkimKey: Boolean(dkimPrivateKey), hasImapPassword: Boolean(imapPass) };
};
