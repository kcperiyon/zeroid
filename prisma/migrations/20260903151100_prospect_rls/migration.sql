ALTER TABLE "Prospect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prospect" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Prospect"
  USING ("businessId" = current_setting('app.business_id', true));
