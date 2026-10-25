import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "ZeroidBot — Zeroid" };

const CONTACT = "kcperiyon@yahoo.com";

export default function BotPage() {
  return (
    <LegalPage title="About ZeroidBot" updated="25 October 2026">
      <p>
        ZeroidBot is the web crawler used by Zeroid, a business-to-business sales tool. If you are seeing it in your
        server logs, a Zeroid customer asked it to look at your company&apos;s public website to find the business contact
        details you publish (for example the email address on your contact page).
      </p>

      <h2>What it does</h2>
      <ul>
        <li>Reads at most a handful of public pages per site: the home page and pages such as contact, about and team.</li>
        <li>Waits at least a second and a half between requests to your site, and longer if your robots.txt asks for it.</li>
        <li>Follows your <strong>robots.txt</strong>. Pages it disallows are never fetched, and a site that disallows everything is left alone.</li>
        <li>Never logs in, never submits forms, and never reads social networks.</li>
      </ul>

      <h2>How to opt out</h2>
      <p>
        Add this to your robots.txt and ZeroidBot will not read your site again:
      </p>
      <pre>{"User-agent: ZeroidBot\nDisallow: /"}</pre>
      <p>
        Or write to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> with your domain and we will exclude it and remove what
        was collected about it. Anyone who receives an email from a Zeroid customer can also use the unsubscribe link in that
        email, which stops all further mail to that address immediately.
      </p>
    </LegalPage>
  );
}
