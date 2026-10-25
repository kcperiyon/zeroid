/**
 * HARD SAFEGUARD -- the last line of defence against a campaign reaching real prospects through
 * the shared Brevo account.
 *
 * Context: Zeroid's Brevo account also sends Flux9, Moneyvarsity, Academytest and Lead CRM mail.
 * One spam wave from it would damage the sender reputation of all of them. So until a dedicated
 * sending identity (own domain + own server) exists, campaign mail may ONLY go to an allow-list of
 * addresses the owner controls.
 *
 * This is enforced at the sender layer (every EmailSender calls assertSendAllowed() immediately
 * before it touches the network), not just in the campaign engine, so no code path -- a new route,
 * a script, a future feature -- can bypass it by calling a sender directly.
 *
 * Rules, evaluated in this order:
 *  1. A "brevo_shared" identity is ALWAYS sandboxed. No flag turns that off.
 *  2. Any identity with sandboxOnly = true is sandboxed (the default for new identities).
 *  3. Live sending also needs the deliberate server-level switch CAMPAIGN_ALLOW_LIVE_SENDING=true.
 *     Without it, everything is sandboxed no matter what the database says.
 *  4. A sandboxed send is allowed only if the recipient is EXACTLY on CAMPAIGN_SANDBOX_ALLOWLIST
 *     (comma-separated full addresses; no wildcards, no whole domains). An empty list sends nothing.
 */

export type SendDecision = { allowed: true; mode: "sandbox" | "live" } | { allowed: false; reason: string };

export class SandboxBlockedError extends Error {
  constructor(readonly reason: string) {
    super(`Blocked by the sending safeguard: ${reason}`);
  }
}

export type GuardIdentity = { provider: "brevo_shared" | "smtp"; sandboxOnly: boolean };

export function parseAllowList(raw: string | undefined = process.env.CAMPAIGN_SANDBOX_ALLOWLIST): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,\s;]+/)
      .map((e) => e.trim().toLowerCase())
      // Only full addresses count; a bare domain or wildcard entry is ignored on purpose.
      .filter((e) => /^[^@\s*]+@[^@\s*]+\.[^@\s*]+$/.test(e))
  );
}

export function liveSendingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CAMPAIGN_ALLOW_LIVE_SENDING === "true";
}

export function checkSendAllowed(
  identity: GuardIdentity,
  recipient: string,
  env: Record<string, string | undefined> = process.env
): SendDecision {
  const to = recipient.trim().toLowerCase();
  const sandboxed = identity.provider === "brevo_shared" || identity.sandboxOnly || !liveSendingEnabled(env);

  if (!sandboxed) return { allowed: true, mode: "live" };

  if (parseAllowList(env.CAMPAIGN_SANDBOX_ALLOWLIST).has(to)) return { allowed: true, mode: "sandbox" };

  const why =
    identity.provider === "brevo_shared"
      ? "the shared Brevo account is sandbox-only"
      : identity.sandboxOnly
        ? "this sending identity is in sandbox mode"
        : "live sending is not switched on for this server";
  return { allowed: false, reason: `${why}, and ${to} is not on the sandbox allow-list.` };
}

/** Call immediately before any network send. Throws if the send is not permitted. */
export function assertSendAllowed(identity: GuardIdentity, recipient: string): "sandbox" | "live" {
  const decision = checkSendAllowed(identity, recipient);
  if (!decision.allowed) throw new SandboxBlockedError(decision.reason);
  return decision.mode;
}
