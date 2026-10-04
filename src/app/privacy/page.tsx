import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy — Zeroid" };

const CONTACT = "kcperiyon@yahoo.com";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="4 October 2026">
      <p>
        Zeroid (&ldquo;Zeroid&rdquo;, &ldquo;we&rdquo;) is a lead-generation, qualification and sales-automation
        service operated by Codes &amp; Bytes. This policy explains what information we handle, why, and the choices
        you have. Businesses that use Zeroid (&ldquo;customers&rdquo;) decide what lead information goes into their
        account; for that information, the customer is the data controller and Zeroid acts as their processor.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li><strong>Account information:</strong> name, email address, organisation name, and a securely hashed password.</li>
        <li>
          <strong>Lead and prospect information:</strong> names, email addresses, phone numbers, company details and
          notes that customers add, import, or collect through forms, prospecting tools and connected channels.
        </li>
        <li>
          <strong>Messages from connected channels:</strong> when a customer connects WhatsApp, a Facebook Page or an
          Instagram account, we receive the messages, comments and lead-form submissions sent to that account so they
          can be turned into leads and, for WhatsApp, answered by the customer&apos;s AI assistant.
        </li>
        <li><strong>Usage and billing records:</strong> AI credit usage, purchases, and basic technical logs.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the service: capture, score and organise leads, draft follow-ups, and operate the customer&apos;s assistant.</li>
        <li>To secure accounts, prevent abuse, and meter and bill AI usage.</li>
        <li>To communicate with account holders about their account.</li>
      </ul>
      <p>We do not sell personal information, and we do not use customers&apos; lead data to advertise to anyone.</p>

      <h2>Service providers</h2>
      <p>
        To run Zeroid we use trusted providers who process data on our behalf: AI model providers (Anthropic and
        Google) to generate replies and drafts; Meta (WhatsApp, Facebook and Instagram) for connected channels;
        Brevo for email delivery; Flutterwave for payments; and our hosting provider. Text sent to an AI provider is
        used to produce the requested output.
      </p>

      <h2>Retention</h2>
      <p>
        We keep information for as long as the customer&apos;s account is active and as needed to meet legal and
        accounting obligations. Customers can delete leads and disconnect channels at any time; on account closure we
        delete or anonymise account data within a reasonable period.
      </p>

      <h2>Your rights and deletion requests</h2>
      <p>
        If you are a person whose details a customer holds in Zeroid, contact that business first. You may also ask
        us to access, correct or delete personal information we hold, or to stop processing it. See our{" "}
        <a className="underline" href="/data-deletion">data deletion instructions</a>.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, each customer&apos;s data is isolated from other customers&apos;, and access is
        limited to people who need it. No system is perfectly secure, and we cannot guarantee absolute security.
      </p>

      <h2>Changes</h2>
      <p>We may update this policy and will change the date above when we do.</p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalPage>
  );
}
