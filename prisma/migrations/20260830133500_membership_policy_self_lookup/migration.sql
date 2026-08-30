-- Login needs to find which org(s) a user belongs to *before* it knows which
-- organization_id to scope the request to (that's exactly what this query is
-- for) — the org-scoped-only policy from the previous migration can't serve
-- that lookup. Add a second, narrower way in: a membership row is also
-- visible to the specific user who holds it, once the app has verified their
-- identity and set app.user_id (see withUserScope in src/lib/tenant-db.ts).
-- This still isn't an open door — app.user_id is only ever set after a
-- password check succeeds, so this doesn't let a caller enumerate anyone
-- else's memberships.

DROP POLICY tenant_isolation ON "OrgMembership";

CREATE POLICY tenant_isolation ON "OrgMembership"
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR "userId" = current_setting('app.user_id', true)
  );
