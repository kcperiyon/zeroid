// Google News RSS -- free, public, no API key. Confirmed live (2026-09-03)
// against a real query: items look like
// <item><title>Headline - Source Name</title><link>https://news.google.com/rss/articles/...</link>
// <pubDate>...</pubDate><description>...</description><source url="...">Source Name</source></item>
// `link` is a Google redirect, not the publisher's own URL -- fine to keep
// as-is, a human clicking it still lands on the real article.

export type NewsItem = { title: string; link: string; pubDate: string };

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export async function fetchNewsTriggers(query: string, limit = 15): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-NG&gl=NG&ceid=NG:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    throw new Error(`Google News RSS returned status ${res.status}.`);
  }
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks.slice(0, limit)) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1];
    if (title && link) {
      items.push({ title: decodeEntities(title.trim()), link: link.trim(), pubDate: pubDate?.trim() ?? "" });
    }
  }
  return items;
}
