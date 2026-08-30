ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Appointment"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Referral" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Referral"
  USING ("businessId" = current_setting('app.business_id', true));

ALTER TABLE "ContentItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ContentItem"
  USING ("businessId" = current_setting('app.business_id', true));
