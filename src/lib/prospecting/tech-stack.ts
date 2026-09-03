// Detects a company's public tech stack by fetching their own homepage and
// matching known signatures against the raw HTML -- the same idea as
// BuiltWith/Wappalyzer, just a small honest starter set, not exhaustive.
// Legal footing: fetching a company's own public homepage and inspecting
// what it sent back, same as any browser or search-engine crawler does.

const SIGNATURES: { name: string; pattern: RegExp }[] = [
  { name: "Shopify", pattern: /cdn\.shopify\.com|Shopify\.theme/i },
  { name: "WordPress", pattern: /wp-content|wp-includes/i },
  { name: "WooCommerce", pattern: /woocommerce/i },
  { name: "Wix", pattern: /static\.wixstatic\.com/i },
  { name: "Squarespace", pattern: /static1\.squarespace\.com/i },
  { name: "HubSpot", pattern: /js\.hs-scripts\.com|hs-analytics\.net/i },
  { name: "Calendly", pattern: /calendly\.com\/(assets|widget)/i },
  { name: "Mailchimp", pattern: /list-manage\.com/i },
  { name: "Google Analytics", pattern: /googletagmanager\.com|google-analytics\.com/i },
  { name: "Meta Pixel", pattern: /connect\.facebook\.net\/[a-zA-Z_]+\/fbevents\.js/i },
  { name: "Stripe", pattern: /js\.stripe\.com/i },
  { name: "Paystack", pattern: /js\.paystack\.co/i },
  { name: "Flutterwave", pattern: /checkout\.flutterwave\.com/i },
  { name: "Intercom", pattern: /widget\.intercom\.io/i },
  { name: "Zendesk", pattern: /static\.zdassets\.com/i },
];

export async function detectTechStack(url: string): Promise<string[]> {
  const normalized = url.startsWith("http") ? url : `https://${url}`;

  let html: string;
  try {
    const res = await fetch(normalized, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    html = await res.text();
  } catch {
    throw new Error(`Couldn't reach ${normalized}.`);
  }

  return SIGNATURES.filter((sig) => sig.pattern.test(html)).map((sig) => sig.name);
}
