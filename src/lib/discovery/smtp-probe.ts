import net from "node:net";
import { Resolver } from "node:dns/promises";

/**
 * Optional mailbox check: ask the recipient's mail server "would you accept this address?" with
 * RCPT TO, then hang up before any message is sent. Also tests a random address to detect servers
 * that accept everything (a "catch-all"), where an "accepted" answer means nothing.
 *
 * It is OFF unless SMTP_PROBE_HELO and SMTP_PROBE_FROM are set to a real hostname and mailbox of the
 * sending domain: probing from an anonymous or shared identity gets IPs listed, and a mail server
 * is entitled to know who is asking. Until a real sending identity exists this stays unconfigured.
 *
 * Only a clear "no such mailbox" counts as rejected. Greylisting (4xx), policy blocks and timeouts
 * are "unknown", never evidence against the address.
 */
export type ProbeResult = { smtp: "accepted" | "rejected" | "unknown"; catchAll: boolean | null; detail?: string };

export type ProbeDeps = {
  helo?: string;
  from?: string;
  port?: number;
  timeoutMs?: number;
  /** Minimum gap between probes to the same domain. Tests set 0. */
  gapMs?: number;
  resolveMx?: (domain: string) => Promise<string[]>;
};

export function probeConfigured(deps: ProbeDeps = {}) {
  return Boolean((deps.helo ?? process.env.SMTP_PROBE_HELO) && (deps.from ?? process.env.SMTP_PROBE_FROM));
}

const catchAllCache = new Map<string, { value: boolean | null; at: number }>();
const lastProbe = new Map<string, number>();
const TTL = 6 * 60 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function defaultMx(domain: string): Promise<string[]> {
  const r = new Resolver({ timeout: 4000, tries: 1 });
  const mx = await r.resolveMx(domain);
  return mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange);
}

/** Minimal SMTP dialogue: send one command, read one (possibly multi-line) reply. */
class Session {
  private buf = "";
  private waiter: ((code: number, text: string) => void) | null = null;
  private failed: Error | null = null;
  private rejectWait: ((e: Error) => void) | null = null;
  constructor(private socket: net.Socket, private timeoutMs: number) {
    socket.setEncoding("utf8");
    socket.on("data", (d: string) => {
      this.buf += d;
      this.flush();
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => this.fail(new Error("Connection closed.")));
    socket.setTimeout(timeoutMs, () => this.fail(new Error("Timed out.")));
  }
  private fail(e: Error) {
    this.failed ??= e;
    this.rejectWait?.(e);
  }
  private flush() {
    if (!this.waiter) return;
    const lines = this.buf.split(/\r?\n/);
    if (lines.length < 2) return;
    // A reply ends at the first line whose 4th character is a space ("250 ok"); "250-" continues.
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
        const text = lines.slice(0, i + 1).join("\n");
        this.buf = lines.slice(i + 1).join("\n");
        const w = this.waiter;
        this.waiter = null;
        this.rejectWait = null;
        w(Number(lines[i].slice(0, 3)), text);
        return;
      }
    }
  }
  read(): Promise<{ code: number; text: string }> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.rejectWait = reject;
      this.waiter = (code, text) => resolve({ code, text });
      this.flush();
    });
  }
  async cmd(line: string) {
    this.socket.write(`${line}\r\n`);
    return this.read();
  }
  close() {
    this.socket.destroy();
  }
}

async function ask(host: string, port: number, deps: Required<Pick<ProbeDeps, "helo" | "from">> & { timeoutMs: number }, rcpts: string[]) {
  const socket = net.connect({ host, port });
  const s = new Session(socket, deps.timeoutMs);
  try {
    const banner = await s.read();
    if (banner.code !== 220) throw new Error(`Banner ${banner.code}`);
    const ehlo = await s.cmd(`EHLO ${deps.helo}`);
    if (ehlo.code !== 250) throw new Error(`EHLO ${ehlo.code}`);
    const from = await s.cmd(`MAIL FROM:<${deps.from}>`);
    if (from.code !== 250) throw new Error(`MAIL FROM ${from.code}`);
    const answers: { code: number; text: string }[] = [];
    for (const r of rcpts) answers.push(await s.cmd(`RCPT TO:<${r}>`));
    await s.cmd("RSET").catch(() => null);
    socket.write("QUIT\r\n");
    return answers;
  } finally {
    s.close();
  }
}

const NO_SUCH_USER = /user|mailbox|recipient|address|exist|unknown|no such|not found|invalid/i;

export async function probeMailbox(email: string, deps: ProbeDeps = {}): Promise<ProbeResult> {
  const helo = deps.helo ?? process.env.SMTP_PROBE_HELO;
  const from = deps.from ?? process.env.SMTP_PROBE_FROM;
  if (!helo || !from) return { smtp: "unknown", catchAll: null, detail: "SMTP check is not configured." };
  const domain = email.split("@")[1].toLowerCase();
  const timeoutMs = deps.timeoutMs ?? 8000;

  // Be gentle with any one mail server: at most one probe every few seconds per domain.
  const gapMs = deps.gapMs ?? 3000;
  const gap = Date.now() - (lastProbe.get(domain) ?? 0);
  if (gap < gapMs) await sleep(gapMs - gap);
  lastProbe.set(domain, Date.now());

  let hosts: string[];
  try {
    hosts = await (deps.resolveMx ?? defaultMx)(domain);
  } catch {
    return { smtp: "unknown", catchAll: null, detail: "No MX answer." };
  }
  const cached = catchAllCache.get(domain);
  const needCatchAll = !cached || Date.now() - cached.at > TTL;
  const randomAddr = `zx${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}@${domain}`;

  for (const host of hosts.slice(0, 2)) {
    try {
      const answers = await ask(host, deps.port ?? 25, { helo, from, timeoutMs }, needCatchAll ? [email, randomAddr] : [email]);
      const [real, rand] = answers;
      if (rand) catchAllCache.set(domain, { value: rand.code >= 200 && rand.code < 300 ? true : rand.code >= 500 && NO_SUCH_USER.test(rand.text) ? false : null, at: Date.now() });
      const catchAll = catchAllCache.get(domain)?.value ?? null;
      if (real.code >= 200 && real.code < 300) return { smtp: "accepted", catchAll };
      if ([550, 551, 553].includes(real.code) && NO_SUCH_USER.test(real.text)) return { smtp: "rejected", catchAll };
      return { smtp: "unknown", catchAll, detail: `RCPT answered ${real.code}.` };
    } catch (e) {
      // try the next MX
      if (host === hosts[Math.min(1, hosts.length - 1)]) return { smtp: "unknown", catchAll: null, detail: (e as Error).message };
    }
  }
  return { smtp: "unknown", catchAll: null, detail: "No reachable mail server." };
}

export const _resetProbeCaches = () => {
  catchAllCache.clear();
  lastProbe.clear();
};
