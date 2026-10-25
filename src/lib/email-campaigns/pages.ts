/** Tiny self-contained HTML for the public unsubscribe pages (no app chrome, mobile friendly). */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHELL = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#f5f8fe;font-family:Arial,Helvetica,sans-serif;color:#1c2c52;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border:1px solid #d8e2f4;border-radius:12px;max-width:440px;width:100%;padding:28px;box-shadow:0 4px 12px rgba(10,36,99,.06)}
h1{font-size:20px;margin:0 0 8px;color:#0a2463}p{font-size:15px;line-height:1.5;margin:8px 0}
.muted{font-size:12px;color:#6b7a99}
button{font:inherit;background:#0a2463;color:#fff;border:0;border-radius:8px;padding:10px 14px;margin-top:10px;cursor:pointer}
button.secondary{background:#fff;color:#0a2463;border:1px solid #b9c9e6}
</style></head><body><div class="card">${body}</div></body></html>`;

export function unsubscribedPage(args: { email: string; senderName: string; physicalAddress: string; scope: "business" | "global"; token: string }) {
  const globalBox =
    args.scope === "business"
      ? `<form method="post" action="/u/${encodeURIComponent(args.token)}"><input type="hidden" name="scope" value="global">
<p class="muted">Don't want email from any business that uses Zeroid?</p>
<button class="secondary" type="submit">Stop all Zeroid senders</button></form>`
      : `<p class="muted">You will not receive email from any business using Zeroid.</p>`;
  return SHELL(
    "You are unsubscribed",
    `<h1>You are unsubscribed</h1>
<p><strong>${escapeHtml(args.email)}</strong> will not receive any more emails from ${escapeHtml(args.senderName)}.</p>
${globalBox}
<p class="muted">${escapeHtml(args.physicalAddress)}</p>`
  );
}

export function invalidLinkPage() {
  return SHELL(
    "Link not valid",
    `<h1>This link is not valid</h1><p>It may have expired or been copied incorrectly. If you keep receiving unwanted email, reply to it with the word <strong>unsubscribe</strong>.</p>`
  );
}
