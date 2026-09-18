-- The webhook has no business/session context until it looks this row up
-- by phoneNumberId (Meta's payload only carries that, never our internal
-- business id) -- same chicken-and-egg shape as Invite's token lookup
-- (20260830173630). app.phone_number_id is set only for that one lookup,
-- never trusted for anything beyond it.

ALTER TABLE "WhatsAppConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WhatsAppConnection"
  USING (
    "businessId" = current_setting('app.business_id', true)
    OR "phoneNumberId" = current_setting('app.phone_number_id', true)
  );
