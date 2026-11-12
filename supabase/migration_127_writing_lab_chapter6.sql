-- migration_127_writing_lab_chapter6.sql (2026-11-12)
-- Writing Lab Chapter 6 (Mr Ikromov's own page) in the Practice bank,
-- collection "Writing Task 1 · Sentence Lab", between Chapters 5 and 8.
-- Safe to run more than once.

insert into public.materials (title, file_name, storage_path, url, skill, collection, position, on_shelf)
select 'Chapter 6 · Paragraph organization and topic sentences', 'task1-ch06.html', 'site:practice/writing-lab/task1-ch06.html',
       '/practice/writing-lab/task1-ch06.html', 'writing', 'Writing Task 1 · Sentence Lab', 6, false
 where not exists (select 1 from public.materials m where m.url = '/practice/writing-lab/task1-ch06.html');

-- Check: expect 1.
select count(*) as chapter6_in_bank from public.materials where url = '/practice/writing-lab/task1-ch06.html';
