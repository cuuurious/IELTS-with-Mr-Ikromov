-- Migration 138: Writing Task 2 lessons in the Practice Bank (2026-11-21).
-- First lesson: public/practice/task2-lessons/lesson-01.html. They live in the
-- Writing tab as the book "Task 2 Lessons" and as their own box in
-- homework "Add tasks". Add more lessons later with the same kind of row.
-- Safe to run more than once.

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select v.title, v.file_name, 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       'writing', null, 'Task 2 Lessons · Lessons', v.n, false, null
from (values
  (1, 'Task 2 Lesson 1 · Essay types and the discussion introduction', 'lesson-01.html', '/practice/task2-lessons/lesson-01.html', 69509)
) as v(n, title, file_name, url, size)
where not exists (select 1 from public.materials m where m.url = v.url and m.collection is not null);

notify pgrst, 'reload schema';

-- Check: expect task2_lessons = 1
select count(*) as task2_lessons from public.materials where url like '/practice/task2-lessons/%' and collection is not null;
