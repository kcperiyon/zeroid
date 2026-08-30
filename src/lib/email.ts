// Brevo transactional email — see docs/build-spec.md §14. Plain REST calls,
// no SDK dependency needed for something this small.
//
// Refuses to send without BREVO_FROM_EMAIL configured — that's a deliberate
// safety net, not a hoop to jump through: this account has no domain for
// Zeroid yet (zeroid.net isn't registered), so BREVO_FROM_EMAIL currently
// holds an explicit owner-approved placeholder (kelechi@lagosbusinessgroup.com,
// 2026-08-30 — "i will buy the domain later. you can create a placeholder"),
// not a real Zeroid address. Swap it for a zeroid.net address once that
// domain exists; until then this still refuses to send if the env var ever
// gets cleared, rather than silently falling back to nothing.

interface SendEmailInput {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL;
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not set. Add it to .env.local — see .env.example.");
  }
  if (!fromEmail) {
    throw new Error(
      "BREVO_FROM_EMAIL is not set — no verified sender identity exists for Zeroid yet. " +
        "Verify a sender in Brevo and set BREVO_FROM_EMAIL before sending real email."
    );
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: process.env.BREVO_FROM_NAME || "Zeroid" },
      to: input.to,
      subject: input.subject,
      htmlContent: input.htmlContent,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brevo send failed (${response.status}): ${body}`);
  }
}
