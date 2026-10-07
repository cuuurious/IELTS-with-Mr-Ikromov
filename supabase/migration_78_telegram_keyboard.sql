-- migration_78_telegram_keyboard.sql (2026-10-07)
-- The "📱 Share my contact" button stayed under the message box in
-- Telegram for everyone who connected before 2 October (Telegram keeps
-- that button until the bot sends a message that removes it).
-- notify-telegram now removes it once per chat, silently, just before
-- the next notification, and ticks this column so it only happens once.
-- Safe to run more than once.

alter table public.telegram_links
  add column if not exists keyboard_cleared boolean not null default false;
