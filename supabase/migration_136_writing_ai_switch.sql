-- Migration 136: teacher switch for AI feedback on Writing pages (2026-11-19).
-- Run once in the Supabase SQL editor. Safe to run twice.

alter table public.homework_tasks
  add column if not exists ai_feedback boolean not null default false;

-- Writing pages already handed out keep getting AI feedback, as before.
update public.homework_tasks
   set ai_feedback = true
 where kind = 'html'
   and html_url like '%/practice/writing/%'
   and ai_feedback = false;

-- Check: expect the column to exist.
select count(*) as column_found
  from information_schema.columns
 where table_schema = 'public' and table_name = 'homework_tasks' and column_name = 'ai_feedback';
