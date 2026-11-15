-- migration_129_writing_lab_chapter7.sql (2026-11-16)
-- Writing Lab Chapter 7 (Mr Ikromov's own page) in the Practice bank,
-- collection "Writing Task 1 · Sentence Lab", between Chapters 6 and 8.
-- Safe to run more than once.

insert into public.materials (title, file_name, storage_path, url, skill, collection, position, on_shelf)
select 'Chapter 7 · Writing the body paragraphs', 'task1-ch07.html', 'site:practice/writing-lab/task1-ch07.html',
       '/practice/writing-lab/task1-ch07.html', 'writing', 'Writing Task 1 · Sentence Lab', 7, false
 where not exists (select 1 from public.materials m where m.url = '/practice/writing-lab/task1-ch07.html');

-- Check: expect 1.
select count(*) as chapter7_in_bank from public.materials where url = '/practice/writing-lab/task1-ch07.html';
