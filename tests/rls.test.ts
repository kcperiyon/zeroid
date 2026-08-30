// Verifies the RLS backstop described in docs/build-spec.md §5: even a
// query that "forgets" its own tenant WHERE clause must not be able to see
// another tenant's rows. This is the test the spec explicitly requires
// before Phase 1 ships — app-level scoping (tenant-db.ts) is the primary
// defense, but this test proves the database-level backstop actually works
// on its own, independent of whether the app code got the WHERE clause right.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { withOrgScope, withBusinessScope, withInviteTokenScope } from "../src/lib/tenant-db";

let orgA: { id: string };
let orgB: { id: string };
let businessA: { id: string };
let businessB: { id: string };

beforeAll(async () => {
  // Organization has no RLS (it's the tenant root) — plain create is fine.
  orgA = await db.organization.create({ data: { name: "RLS Test Org A", slug: `rls-test-a-${Date.now()}` } });
  orgB = await db.organization.create({ data: { name: "RLS Test Org B", slug: `rls-test-b-${Date.now()}` } });

  businessA = await withOrgScope(orgA.id, (tx) =>
    tx.business.create({ data: { organizationId: orgA.id, name: "Business A" } })
  );
  businessB = await withOrgScope(orgB.id, (tx) =>
    tx.business.create({ data: { organizationId: orgB.id, name: "Business B" } })
  );

  await withBusinessScope(orgA.id, businessA.id, (tx) =>
    tx.product.create({ data: { businessId: businessA.id, name: "Product A" } })
  );
  await withBusinessScope(orgB.id, businessB.id, (tx) =>
    tx.product.create({ data: { businessId: businessB.id, name: "Product B" } })
  );
});

afterAll(async () => {
  await withBusinessScope(orgA.id, businessA.id, (tx) => tx.product.deleteMany({ where: { businessId: businessA.id } }));
  await withBusinessScope(orgB.id, businessB.id, (tx) => tx.product.deleteMany({ where: { businessId: businessB.id } }));
  await withOrgScope(orgA.id, (tx) => tx.business.deleteMany({ where: { organizationId: orgA.id } }));
  await withOrgScope(orgB.id, (tx) => tx.business.deleteMany({ where: { organizationId: orgB.id } }));
  await withOrgScope(orgA.id, (tx) => tx.invite.deleteMany({ where: { organizationId: orgA.id } }));
  await withOrgScope(orgB.id, (tx) => tx.invite.deleteMany({ where: { organizationId: orgB.id } }));
  await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
});

describe("RLS tenant isolation backstop", () => {
  it("an unscoped findMany() on an org-scoped table only returns the current tenant's rows", async () => {
    const businesses = await withOrgScope(orgA.id, (tx) =>
      // Deliberately no `where` clause — this is the "developer forgot the
      // WHERE" scenario the policy exists to catch.
      tx.business.findMany()
    );
    const ids = businesses.map((b) => b.id);
    expect(ids).toContain(businessA.id);
    expect(ids).not.toContain(businessB.id);
  });

  it("directly requesting another org's row by id returns null, not the row", async () => {
    const result = await withOrgScope(orgA.id, (tx) =>
      // Deliberately omits organizationId from the filter — only `id` is used.
      tx.business.findFirst({ where: { id: businessB.id } })
    );
    expect(result).toBeNull();
  });

  it("an unscoped findMany() on a business-scoped table only returns the current business's rows", async () => {
    const products = await withBusinessScope(orgA.id, businessA.id, (tx) =>
      tx.product.findMany()
    );
    expect(products.length).toBe(1);
    expect(products[0].businessId).toBe(businessA.id);
  });

  it("a session with no tenant scope set sees nothing on tenant-scoped tables", async () => {
    const businesses = await db.$transaction((tx) => tx.business.findMany());
    const ids = businesses.map((b) => b.id);
    expect(ids).not.toContain(businessA.id);
    expect(ids).not.toContain(businessB.id);
  });

  it("possessing an invite's token reveals only that invite, not another org's", async () => {
    const inviteA = await withOrgScope(orgA.id, (tx) =>
      tx.invite.create({ data: { organizationId: orgA.id, email: "a@example.com" } })
    );
    const inviteB = await withOrgScope(orgB.id, (tx) =>
      tx.invite.create({ data: { organizationId: orgB.id, email: "b@example.com" } })
    );

    const found = await withInviteTokenScope(inviteA.token, (tx) => tx.invite.findUnique({ where: { token: inviteA.token } }));
    expect(found?.id).toBe(inviteA.id);

    // Holding org A's invite token doesn't grant visibility into org B's invite.
    const leaked = await withInviteTokenScope(inviteA.token, (tx) => tx.invite.findUnique({ where: { token: inviteB.token } }));
    expect(leaked).toBeNull();
  });
});
