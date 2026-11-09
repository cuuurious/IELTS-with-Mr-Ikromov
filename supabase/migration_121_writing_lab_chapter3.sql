-- migration_121_writing_lab_chapter3.sql (2026-11-09)
-- Writing Task 1 · Chapter 3 "The language of change" — the interactive lab
-- built from Chapter 3 of the Course Book — joins Chapter 4 in the Practice
-- bank collection "Writing Task 1 · Sentence Lab". Teachers set it as
-- homework like any page. Not on the students' Books shelf until you put it
-- there. Safe to run more than once.

set lock_timeout = '8s';

insert into public.materials (title, file_name, storage_path, url, skill, collection, position, on_shelf)
select 'Chapter 3 · The language of change', 'task1-ch03.html', 'site:practice/writing-lab/task1-ch03.html',
       '/practice/writing-lab/task1-ch03.html', 'writing', 'Writing Task 1 · Sentence Lab', 3, false
 where not exists (select 1 from public.materials where url = '/practice/writing-lab/task1-ch03.html');

-- Check: expect 1
select count(*) as chapter3_in_bank from public.materials where url = '/practice/writing-lab/task1-ch03.html';
