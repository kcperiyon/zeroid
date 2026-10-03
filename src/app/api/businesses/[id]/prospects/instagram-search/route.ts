import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getBusinessInOrg, withBusinessScope } from "@/lib/tenant-db";
import { discoverInstagramAccount, type DiscoveredAccount } from "@/lib/meta/graph";

const Schema = z.object({ usernames: z.string().min(1).max(1000) });
const MAX_PER_REQUEST = 10;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/**
 * Instagram Business Discovery: look up public business/creator accounts by
 * username using the business's own connected Instagram account. Instagram
 * offers no way to *search* for accounts, so the owner supplies usernames
 * (from a competitor's followers, a hashtag browse, an event list...).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!["owner", "admin", "manager"].includes(user.role)) {
    return NextResponse.json({ error: "You don't have permission to search for prospects." }, { status: 403 });
  }

  const { id: businessId } = await context.params;
  const business = await getBusinessInOrg(user.organizationId, businessId);
  if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter one or more Instagram usernames." }, { status: 400 });
  }

  const usernames = [
    ...new Set(
      parsed.data.usernames
        .split(/[\s,;]+/)
        .map((u) => u.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").trim().toLowerCase())
        .filter((u) => /^[a-z0-9._]{1,30}$/.test(u))
    ),
  ];
  if (usernames.length === 0) {
    return NextResponse.json({ error: "No valid Instagram usernames found." }, { status: 400 });
  }
  if (usernames.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: `Look up at most ${MAX_PER_REQUEST} accounts at a time.` }, { status: 400 });
  }

  const connection = await withBusinessScope(user.organizationId, businessId, (tx) =>
    tx.metaConnection.findFirst({ where: { businessId } })
  );
  if (!connection?.instagramAccountId) {
    return NextResponse.json(
      { error: "Connect a Facebook Page with a linked Instagram professional account first (Social tab)." },
      { status: 400 }
    );
  }

  const found: DiscoveredAccount[] = [];
  const failed: Array<{ username: string; reason: string }> = [];
  for (const username of usernames) {
    try {
      found.push(await discoverInstagramAccount(connection.instagramAccountId, connection.pageAccessToken, username));
    } catch (error) {
      failed.push({ username, reason: error instanceof Error ? error.message : "Lookup failed." });
    }
  }

  const prospects = await withBusinessScope(user.organizationId, businessId, async (tx) => {
    const rows = [];
    for (const a of found) {
      const data = {
        name: a.name || a.username,
        website: a.website,
        email: a.biography?.match(EMAIL)?.[0] ?? null,
        category: a.followers != null ? `${a.followers.toLocaleString("en-US")} followers` : null,
        sourceUrl: `https://www.instagram.com/${a.username}/`,
      };
      rows.push(
        await tx.prospect.upsert({
          where: { businessId_channel_externalId: { businessId, channel: "instagram", externalId: a.id } },
          update: data,
          create: { businessId, channel: "instagram", externalId: a.id, ...data },
        })
      );
    }
    return rows;
  });

  return NextResponse.json({ prospects, failed }, { status: 201 });
}
