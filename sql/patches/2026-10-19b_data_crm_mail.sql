-- ===========================================================================
-- 2026-10-19b_data_crm_mail.sql
--
-- DATA UPLOAD tasks from the shared mailbox data-crm@roseandco.com.
--
-- The Dynamics sync cron (/api/sync-dynamics, every 10 min on weekdays) also
-- polls the mailbox's Inbox through Microsoft Graph (lib/data-upload/poll.ts).
-- Each NEW conversation produces ONE Outreach / Data Upload task in
-- public.tasks; replies in a conversation already seen are recorded and
-- skipped. Three tables, all dashboard-owned (the Dynamics sync never touches
-- them):
--
--   mail_poll_state            one row per polled mailbox: the watermark
--                              (newest receivedDateTime processed) + last run
--   data_crm_mail_conversations one row per conversationId that produced a
--                              task. The PK is what makes "one task per
--                              thread" hold under concurrent / repeated polls;
--                              task_id is chosen when the row is claimed, so a
--                              crash between claim and task insert self-heals
--                              on the next poll without a duplicate.
--   data_crm_mail_messages     one row per ingested message (first emails AND
--                              replies), unique on internet_message_id, so a
--                              re-poll of the overlap window never re-processes.
--
-- No foreign keys, matching public.tasks (which has none). Service-role only:
-- RLS is enabled with NO policies, so the anon / authenticated keys read
-- nothing; the app reads through the service role behind its own gates
-- (/data-uploads page + server actions).
--
-- Run ONCE in the Supabase SQL editor. Safe to re-run. Until it is run the poll
-- reports "patch not run" in the sync response and does nothing, and the
-- /data-uploads page shows a "run the patch" notice.
-- See dashboard/content/docs/05-sync-and-integrations.md → "Data-CRM mailbox poll".
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.mail_poll_state (
  mailbox           text PRIMARY KEY,
  -- Newest receivedDateTime fully processed. The next poll reads from
  -- (watermark − overlap). NULL never stored: the first poll initialises it.
  last_received_at  timestamptz NOT NULL,
  last_polled_at    timestamptz,
  last_status       text,          -- 'success' | 'partial' | 'error'
  last_error        text,
  last_fetched      integer,
  last_tasks_created integer,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_crm_mail_conversations (
  conversation_id   text PRIMARY KEY,
  mailbox           text NOT NULL,
  -- The task this conversation produced. Chosen (random UUID) at claim time
  -- and inserted with exactly this id, so a retry can never make a second one.
  task_id           uuid NOT NULL UNIQUE,
  -- internet_message_id of the email that started it (the task's source).
  first_message_id  text NOT NULL,
  task_created_at   timestamptz,   -- NULL = claimed but task not yet inserted
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_crm_mail_messages (
  internet_message_id text PRIMARY KEY,
  mailbox             text NOT NULL,
  graph_message_id    text NOT NULL,
  conversation_id     text,
  subject             text,
  sender_name         text,
  sender_address      text,
  received_at         timestamptz NOT NULL,
  web_link            text,
  body_preview        text,
  has_attachments     boolean,
  -- The task this message STARTED (null for replies / skipped messages).
  task_id             uuid,
  -- Why no task: 'reply' (conversation already has one) | 'own_mail' (sent by
  -- the mailbox itself). NULL when it started a task.
  skip_reason         text,
  -- Client match used for the task title (null = no match).
  matched_account_id  text,
  match_source        text,        -- 'ticker' | 'name' | 'sender_domain'
  ingested_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_crm_mail_messages_task
  ON public.data_crm_mail_messages (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_data_crm_mail_messages_conversation
  ON public.data_crm_mail_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_data_crm_mail_messages_received
  ON public.data_crm_mail_messages (received_at DESC);

ALTER TABLE public.mail_poll_state             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_crm_mail_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_crm_mail_messages      ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mail_poll_state IS
  'DASHBOARD-OWNED. Graph mailbox poll watermark per mailbox (lib/data-upload/poll.ts).';
COMMENT ON TABLE public.data_crm_mail_conversations IS
  'DASHBOARD-OWNED. data-crm@ conversations that produced a Data Upload task — one task per conversationId.';
COMMENT ON TABLE public.data_crm_mail_messages IS
  'DASHBOARD-OWNED. Every ingested data-crm@ Inbox message (first emails and replies); unique on internet_message_id.';

-- ---- Check after running ------------------------------------------------------
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('mail_poll_state','data_crm_mail_conversations','data_crm_mail_messages');
--   -- expect 3 rows
--
-- ---- Optional: backfill ---------------------------------------------------------
-- The first poll starts at "now" (no backfill). To pick up older mail, after
-- the first poll has created the row, move the watermark back, e.g.:
--   UPDATE public.mail_poll_state SET last_received_at = '2026-10-13T00:00:00Z'
--    WHERE mailbox = 'data-crm@roseandco.com';
