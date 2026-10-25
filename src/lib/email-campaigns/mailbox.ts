import { ImapFlow } from "imapflow";
import { withBusinessScope } from "@/lib/tenant-db";
import { openSecret } from "@/lib/secrets";
import { handleInboundEmail, type InboundResult } from "./inbound";

/**
 * Reads replies, bounces and complaints from a mailbox over IMAP and feeds them to the same
 * handler as the HTTP endpoint. Works with ANY provider (Gmail/Yahoo app passwords, the reply-to
 * inbox of a Brevo sender, an own mail server), so reply capture does not need our own MTA.
 *
 * The mailbox is opened READ-ONLY and never modified: nothing is marked seen, moved or deleted, so
 * the owner can keep using it. Each message is looked at once, tracked by the highest UID processed.
 */
export type RawMessage = { uid: number; source: Buffer };

export interface MailboxSession {
  /** Messages with uid > afterUid, oldest first, capped. When afterUid is null: those since `since`. */
  fetchNew(opts: { afterUid: number | null; since: Date; limit: number }): Promise<RawMessage[]>;
  close(): Promise<void>;
}

export type MailboxConfig = { host: string; port: number; secure: boolean; user: string; pass: string; folder: string };
export type OpenMailbox = (cfg: MailboxConfig) => Promise<MailboxSession>;

export const openImap: OpenMailbox = async (cfg) => {
  const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock(cfg.folder, { readOnly: true });
  return {
    async fetchNew({ afterUid, since, limit }) {
      const found = afterUid == null ? await client.search({ since }, { uid: true }) : await client.search({ uid: `${afterUid + 1}:*` }, { uid: true });
      // IMAP "N:*" always includes the newest message even when it is <= N, so filter explicitly.
      const uids = (found || []).filter((u: number) => afterUid == null || u > afterUid).sort((a: number, b: number) => a - b).slice(0, limit);
      const out: RawMessage[] = [];
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) out.push({ uid, source: msg.source });
      }
      return out;
    },
    async close() {
      lock.release();
      await client.logout().catch(() => undefined);
    },
  };
};

export type PollResult = { fetched: number; matched: number; replies: number; bounces: number; error?: string };

const BATCH = 50;
const FIRST_RUN_LOOKBACK_MS = 3 * 86_400_000;
const MIN_INTERVAL_MS = 60_000;

/** Polls every identity of one business that has a mailbox configured and is due. */
export async function pollBusinessMailboxes(
  organizationId: string,
  businessId: string,
  deps: { open?: OpenMailbox; handle?: (raw: Buffer) => Promise<InboundResult>; now?: () => Date } = {}
): Promise<PollResult> {
  const open = deps.open ?? openImap;
  const handle = deps.handle ?? handleInboundEmail;
  const now = (deps.now ?? (() => new Date()))();
  const total: PollResult = { fetched: 0, matched: 0, replies: 0, bounces: 0 };

  const identities = await withBusinessScope(organizationId, businessId, (tx) =>
    tx.sendingIdentity.findMany({ where: { businessId, active: true, imapHost: { not: null }, imapUser: { not: null } } })
  );

  for (const id of identities) {
    if (id.imapLastCheckAt && now.getTime() - id.imapLastCheckAt.getTime() < MIN_INTERVAL_MS) continue;
    let lastUid = id.imapLastUid;
    let error: string | null = null;
    let session: MailboxSession | null = null;
    try {
      session = await open({
        host: id.imapHost!,
        port: id.imapPort ?? (id.imapSecure ? 993 : 143),
        secure: id.imapSecure,
        user: id.imapUser!,
        pass: openSecret(id.imapPass) ?? "",
        folder: id.imapFolder || "INBOX",
      });
      const messages = await session.fetchNew({ afterUid: id.imapLastUid, since: new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS), limit: BATCH });
      for (const m of messages) {
        total.fetched++;
        try {
          const r = await handle(m.source);
          if (r.kind !== "unmatched") total.matched++;
          if (r.kind === "reply") total.replies++;
          if (r.kind === "bounce") total.bounces++;
        } catch (e) {
          console.error("inbound message failed:", e instanceof Error ? e.message : e);
        }
        lastUid = Math.max(lastUid ?? 0, m.uid);
      }
    } catch (e) {
      // Never include credentials in what we store: only the message.
      error = (e instanceof Error ? e.message : "Mailbox check failed.").slice(0, 300);
      total.error = error;
    } finally {
      await session?.close().catch(() => undefined);
    }
    await withBusinessScope(organizationId, businessId, (tx) =>
      tx.sendingIdentity.update({ where: { id: id.id }, data: { imapLastCheckAt: now, imapLastError: error, ...(lastUid != null ? { imapLastUid: lastUid } : {}) } })
    );
  }
  return total;
}
