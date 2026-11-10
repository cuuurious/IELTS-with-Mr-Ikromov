-- migration_122_writing_lab_chapters_2_5_8.sql (2026-11-09)
-- Writing Task 1 · Chapters 2, 5 and 8 — interactive labs built from the
-- Course Book — join Chapters 3 and 4 in the Practice bank collection
-- "Writing Task 1 · Sentence Lab". Teachers set them as homework like any
-- page. Not on the students' Books shelf until you put them there.
-- Safe to run more than once.

set lock_timeout = '8s';

insert into public.materials (title, file_name, storage_path, url, skill, collection, position, on_shelf)
select v.title, v.file_name, 'site:practice/writing-lab/' || v.file_name, '/practice/writing-lab/' || v.file_name,
       'writing', 'Writing Task 1 · Sentence Lab', v.position, false
  from (values
    ('Chapter 2 · Say what changed (context and the introduction)', 'task1-ch02.html', 2),
    ('Chapter 5 · Write the overview in two sentences', 'task1-ch05.html', 5),
    ('Chapter 8 · Seven ways to compare', 'task1-ch08.html', 8)
  ) as v(title, file_name, position)
 where not exists (select 1 from public.materials m where m.url = '/practice/writing-lab/' || v.file_name);

-- Check: expect 3
select count(*) as new_chapters_in_bank from public.materials
 where url in ('/practice/writing-lab/task1-ch02.html', '/practice/writing-lab/task1-ch05.html', '/practice/writing-lab/task1-ch08.html');
