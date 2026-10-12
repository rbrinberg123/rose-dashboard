-- ===========================================================================
-- Patch: touchpoint_contacts — a touch point's CLIENT CONTACTS.
-- Date:  2026-10-12
--
-- WHAT
--   public.touchpoint_contacts, a DASHBOARD-OWNED junction (touch point ↔
--   existing contact), the same shape as public.event_contacts
--   (sql/patches/2026-10-07g_event_reps_task_dates.sql).
--
--   Nothing in Dynamics' synced data carries a touchpoint↔contact link: the
--   phonecall entity has no contact lookup and the sync does not expand its
--   activityparty collections (see sql/patches/2026-09-15_admin_touchpoints.sql,
--   "THERE IS NO CONTACT PERSON ANYWHERE"). So this is new, the sync never
--   writes it, and Dynamics-origin touch points simply have no rows here.
--
--   Written only by the touch point form's server actions
--   (app/touchpoints/actions.ts createTouch / updateTouch — requireCrmWriter,
--   audited). Each contact must belong to the touch point's client; the server
--   checks contacts.parent_customer_id. Cascades away with its touch point or
--   contact.
--
-- WHY A JUNCTION, NOT A COLUMN
--   The field is MULTI-select (a touch point can involve several of the
--   client's contacts), and a junction keeps each link a real foreign key.
--
-- Until this runs, the form still saves touch points; picking a Client Contact
-- returns "Client contacts need the 2026-10-12 touchpoint_contacts SQL patch
-- run first." and the drawer shows none.
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run.
-- See dashboard/content/docs/15-touches.md.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.touchpoint_contacts (
  touchpoint_id uuid        NOT NULL REFERENCES public.touchpoints (touchpoint_id) ON DELETE CASCADE,
  contact_id    uuid        NOT NULL REFERENCES public.contacts (contact_id) ON DELETE CASCADE,
  added_by_id   uuid,
  added_by_name text,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (touchpoint_id, contact_id)
);

COMMENT ON TABLE public.touchpoint_contacts IS
  'Dashboard-owned: a touch point''s client contacts (existing contacts at its '
  'client). Not synced from Dynamics. Written by app/touchpoints/actions.ts '
  '(createTouch / updateTouch), gated by requireCrmWriter and audited.';

-- The PK serves "contacts of this touch point"; this serves the reverse.
CREATE INDEX IF NOT EXISTS idx_touchpoint_contacts_contact ON public.touchpoint_contacts (contact_id);

-- Service-role only (the app's server actions); no anon / authenticated access.
ALTER TABLE public.touchpoint_contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.touchpoint_contacts TO service_role;
