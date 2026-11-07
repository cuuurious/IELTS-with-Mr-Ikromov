-- migration_117_writing_lab_chapter4.sql (2026-11-07)
-- Writing Task 1 · Chapter 4 "Ten ways to say what changed" — the
-- interactive sentence-structure lab — goes into the Practice bank, in a
-- new collection "Writing Task 1 · Sentence Lab" (later chapters join it).
-- Teachers set it as homework like any page; the score is the number of
-- correct sentences. Not on the students' Books shelf until you put it there.
-- Safe to run more than once.

set lock_timeout = '8s';

insert into public.materials (title, file_name, storage_path, url, skill, collection, position, on_shelf)
select 'Chapter 4 · Ten ways to say what changed', 'task1-ch04.html', 'site:practice/writing-lab/task1-ch04.html',
       '/practice/writing-lab/task1-ch04.html', 'writing', 'Writing Task 1 · Sentence Lab', 4, false
 where not exists (select 1 from public.materials where url = '/practice/writing-lab/task1-ch04.html');

-- Check: expect 1
select count(*) as chapter4_in_bank from public.materials where url = '/practice/writing-lab/task1-ch04.html';
