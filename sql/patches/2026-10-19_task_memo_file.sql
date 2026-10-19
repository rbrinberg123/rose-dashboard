-- ===========================================================================
-- 2026-10-19_task_memo_file.sql
--
-- Marketing Memo DOCUMENT UPLOAD — where the uploaded Word file's SharePoint
-- reference is stored on its task.
--
-- The task owner (or a super user) uploads a .doc/.docx on the task drawer;
-- the app pushes it to the CRMDocuments SharePoint site's Documents library
-- via Microsoft Graph (app-only, lib/graph/sharepoint.ts) and records the
-- resulting driveItem here. A re-upload on the same task writes a NEW VERSION
-- of that same item (by memo_file_item_id).
--
-- All six columns are DASHBOARD-OWNED: never written by the Dynamics sync, so
-- they are safe on Dynamics-origin tasks too (like closed_at / claimed_by_id;
-- lock_origin only guards the origin column). Nullable, no default, no index
-- (read by task_id only).
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run. Until it is run the
-- drawer shows "Document upload isn't switched on yet" and the upload refuses.
-- See dashboard/content/docs/14-tasks.md → "Marketing Memo document".
-- ===========================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS memo_file_item_id          text,
  ADD COLUMN IF NOT EXISTS memo_file_web_url          text,
  ADD COLUMN IF NOT EXISTS memo_file_name             text,
  ADD COLUMN IF NOT EXISTS memo_file_uploaded_at      timestamptz,
  ADD COLUMN IF NOT EXISTS memo_file_uploaded_by_id   uuid,
  ADD COLUMN IF NOT EXISTS memo_file_uploaded_by_name text;

COMMENT ON COLUMN public.tasks.memo_file_item_id IS
  'DASHBOARD-OWNED. Marketing Memo upload: the SharePoint driveItem id in the CRMDocuments '
  'Documents library. Re-uploads on the task replace this item''s content (new version).';
COMMENT ON COLUMN public.tasks.memo_file_web_url IS
  'DASHBOARD-OWNED. Marketing Memo upload: the driveItem webUrl (opens the document in SharePoint).';
COMMENT ON COLUMN public.tasks.memo_file_name IS
  'DASHBOARD-OWNED. Marketing Memo upload: the file name as stored in SharePoint.';
COMMENT ON COLUMN public.tasks.memo_file_uploaded_at IS
  'DASHBOARD-OWNED. Marketing Memo upload: when the latest version was uploaded.';
COMMENT ON COLUMN public.tasks.memo_file_uploaded_by_id IS
  'DASHBOARD-OWNED. Marketing Memo upload: users.user_id of who uploaded the latest version.';
COMMENT ON COLUMN public.tasks.memo_file_uploaded_by_name IS
  'DASHBOARD-OWNED. Marketing Memo upload: display name of who uploaded the latest version.';

-- ---- Check after running ------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name LIKE 'memo_file_%';
--   -- expect 6 rows
