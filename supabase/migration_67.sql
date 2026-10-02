-- ============================================================
-- Migration 67 — big Telegram files (2026-09-30). Safe to re-run.
--
-- Stores the bot's MTProto login for the telegram-bigfile function, so
-- it doesn't log in again for every big file (Telegram rate-limits
-- repeated bot logins). Row-level security is ON with no policies, so
-- only the server (service role) can read or write it — never a
-- browser.
-- ============================================================
create table if not exists public.telegram_bot_session (
  id integer primary key check (id = 1),
  session text not null,
  updated_at timestamptz not null default now()
);
alter table public.telegram_bot_session enable row level security;
revoke all on public.telegram_bot_session from anon, authenticated;
