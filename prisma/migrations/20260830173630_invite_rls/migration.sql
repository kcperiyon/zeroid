-- Invite acceptance happens before the invitee has any account or org
-- context — same chicken-and-egg problem login had with OrgMembership (see
-- the 20260830133500 migration). Same fix: a second, narrower way in. The
-- token itself IS the authorization (a cuid has enough entropy that
-- possessing it is proof you were meant to see this one row) — the app sets
-- app.invite_token to the token from the URL before querying, so this never
-- allows enumerating other invites, only fetching the one whose token you
-- already have.

ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invite"
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR "token" = current_setting('app.invite_token', true)
  );
