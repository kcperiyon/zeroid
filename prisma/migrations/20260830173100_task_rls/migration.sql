ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Task"
  USING ("businessId" = current_setting('app.business_id', true));
