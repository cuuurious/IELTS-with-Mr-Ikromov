-- ============================================================
-- Migration 41 — run this once in Supabase SQL Editor, after 29-40
--
-- Finally wires up the Telegram bot linking schema migration_29 laid
-- down but never built the bot for. One small addition needed:
-- telegram_link_tokens didn't have anywhere to remember WHICH Telegram
-- chat sent "/start <token>" until the student then shares their
-- contact in a separate message a moment later — the webhook needs
-- both messages tied together to know who to link.
-- ============================================================

alter table public.telegram_link_tokens
  add column if not exists telegram_chat_id bigint;

-- The webhook runs with the service-role key, so RLS doesn't block it,
-- but this update needs to be reachable at all — the existing
-- telegram_link_tokens policies are select/insert only (see
-- migration_29), which is fine since the service-role key bypasses RLS
-- entirely. No new policy needed here.

notify pgrst, 'reload schema';
