ALTER TABLE "CreditPurchase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditPurchase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CreditPurchase"
  USING ("organizationId" = current_setting('app.organization_id', true));
