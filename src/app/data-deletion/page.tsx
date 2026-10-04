import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Data Deletion — Zeroid" };

const CONTACT = "kcperiyon@yahoo.com";

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion Instructions" updated="4 October 2026">
      <p>
        You can ask Zeroid to delete personal information we hold about you. This applies to your account, and to
        information about you that a business using Zeroid received through WhatsApp, Facebook, Instagram, a form or
        another channel.
      </p>

      <h2>How to request deletion</h2>
      <ul>
        <li>
          Email <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> with the subject
          &ldquo;Data deletion request&rdquo;.
        </li>
        <li>
          Include the name and the email address or phone number (including any WhatsApp, Facebook or Instagram name)
          that the information is held under, and the business you were in contact with if you know it.
        </li>
        <li>We may ask you to confirm your identity before deleting anything.</li>
      </ul>

      <h2>What happens next</h2>
      <ul>
        <li>We will confirm receipt and delete the matching personal information, normally within 30 days.</li>
        <li>
          We may keep limited records where the law requires it (for example payment records), and we will tell you if
          we do.
        </li>
        <li>
          If you used Zeroid through a Facebook or Instagram connection, you can also remove the app under
          Settings &rarr; Apps and Websites on that platform.
        </li>
      </ul>

      <p>
        Account holders can also delete leads and disconnect channels directly from their Zeroid account at any time.
        See the <a className="underline" href="/privacy">Privacy Policy</a> for more.
      </p>
    </LegalPage>
  );
}
