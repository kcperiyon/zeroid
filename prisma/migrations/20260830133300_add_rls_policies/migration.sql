-- Row-Level Security backstop for tenant isolation — see docs/build-spec.md §5.
--
-- App-level scoping (src/lib/tenant-db.ts) is the primary defense: every
-- query that touches a tenant table goes through withOrgScope()/
-- withBusinessScope(), which sets these session variables before running the
-- query. RLS is the backstop — if a query is ever written without going
-- through that wrapper, these policies make it return zero rows instead of
-- another tenant's data, rather than relying on every developer (or every
-- future migration) remembering a WHERE clause.
--
-- FORCE ROW LEVEL SECURITY matters here specifically because the app
-- connects as the table owner (leadai_dev) — by default Postgres RLS does
-- NOT apply to a table's owner, which would silently defeat this policy for
-- every real query the app makes. FORCE closes that gap.

-- Org-scoped tables
ALTER TABLE "OrgMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgMembership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrgMembership"
  USING ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Business" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Business" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Business"
  USING ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription"
  USING ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AiCreditWallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCreditWallet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiCreditWallet"
  USING ("organizationId" = current_setting('app.organization_id', true));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("organizationId" = current_setting('app.organization_id', true));

-- Business-scoped tables
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "IcpProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IcpProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IcpProfile"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "ScoringConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScoringConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ScoringConfig"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "LeadSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadSource"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Lead"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "LeadEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeadEvent"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Deal"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "AiInstruction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiInstruction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiInstruction"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "KnowledgeSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "KnowledgeSource"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "AiUsageLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiUsageLog"
  USING ("businessId" = current_setting('app.business_id', true));

-- User and Organization themselves are intentionally NOT RLS-scoped:
-- Organization is the tenant root (nothing above it to scope by), and User
-- is a shared/global table (login looks a user up by email before any org
-- context exists, and one user can belong to more than one organization via
-- OrgMembership, which IS scoped above).
