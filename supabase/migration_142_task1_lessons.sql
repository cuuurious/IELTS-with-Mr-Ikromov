-- Migration 142: Task 1 Lessons 1-18 in the Practice Bank (2026-11-23).
-- Pages: public/practice/task1-lessons/lesson-01..18.html (Writing tab, like Task 2 Lessons).
-- Safe to run more than once.

set lock_timeout = '8s';

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select v.title, substr(v.url, length(regexp_replace(v.url, '[^/]*$', '')) + 1), 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       v.skill, null, v.collection, v.n, false, null
from (values
  ('writing', 'Task 1 Lessons · Lessons', 1, 'Task 1 Lesson 1 · Know Your Task', '/practice/task1-lessons/lesson-01.html', 4526582),
  ('writing', 'Task 1 Lessons · Lessons', 2, 'Task 1 Lesson 2 · Language of Change', '/practice/task1-lessons/lesson-02.html', 477481),
  ('writing', 'Task 1 Lessons · Lessons', 3, 'Task 1 Lesson 3 · Ten Sentence Structures', '/practice/task1-lessons/lesson-03.html', 152849),
  ('writing', 'Task 1 Lessons · Lessons', 4, 'Task 1 Lesson 4 · Introductions', '/practice/task1-lessons/lesson-04.html', 1180475),
  ('writing', 'Task 1 Lessons · Lessons', 5, 'Task 1 Lesson 5 · Overviews for Change Charts', '/practice/task1-lessons/lesson-05.html', 2222889),
  ('writing', 'Task 1 Lessons · Lessons', 6, 'Task 1 Lesson 6 · Topic Sentences', '/practice/task1-lessons/lesson-06.html', 2115312),
  ('writing', 'Task 1 Lessons · Lessons', 7, 'Task 1 Lesson 7 · Body Paragraphs for Change Charts', '/practice/task1-lessons/lesson-07.html', 2711154),
  ('writing', 'Task 1 Lessons · Lessons', 8, 'Task 1 Lesson 8 · Comparative Sentence Structures', '/practice/task1-lessons/lesson-08.html', 236749),
  ('writing', 'Task 1 Lessons · Lessons', 9, 'Task 1 Lesson 9 · Overviews for Comparative Charts', '/practice/task1-lessons/lesson-09.html', 828054),
  ('writing', 'Task 1 Lessons · Lessons', 10, 'Task 1 Lesson 10 · Topic Sentences and Body Paragraphs for Comparative Charts', '/practice/task1-lessons/lesson-10.html', 607221),
  ('writing', 'Task 1 Lessons · Lessons', 11, 'Task 1 Lesson 11 · Natural Comparison: Surveys, Money and Age', '/practice/task1-lessons/lesson-11.html', 589442),
  ('writing', 'Task 1 Lessons · Lessons', 12, 'Task 1 Lesson 12 · Map Sentence Structures', '/practice/task1-lessons/lesson-12.html', 857816),
  ('writing', 'Task 1 Lessons · Lessons', 13, 'Task 1 Lesson 13 · Map Introductions and Overviews', '/practice/task1-lessons/lesson-13.html', 1240272),
  ('writing', 'Task 1 Lessons · Lessons', 14, 'Task 1 Lesson 14 · Body Paragraphs and Full Map Answers', '/practice/task1-lessons/lesson-14.html', 1420716),
  ('writing', 'Task 1 Lessons · Lessons', 15, 'Task 1 Lesson 15 · Process Sentence Structures', '/practice/task1-lessons/lesson-15.html', 845761),
  ('writing', 'Task 1 Lessons · Lessons', 16, 'Task 1 Lesson 16 · Process Introductions and Overviews', '/practice/task1-lessons/lesson-16.html', 918188),
  ('writing', 'Task 1 Lessons · Lessons', 17, 'Task 1 Lesson 17 · Process Body Paragraphs and Full Answers', '/practice/task1-lessons/lesson-17.html', 866618),
  ('writing', 'Task 1 Lessons · Lessons', 18, 'Task 1 Lesson 18 · Mixed Graphs', '/practice/task1-lessons/lesson-18.html', 1015214)
) as v(skill, collection, n, title, url, size)
where not exists (select 1 from public.materials m where m.url = v.url and m.collection is not null);

notify pgrst, 'reload schema';

-- Check: expect task1_lessons = 18
select count(*) as task1_lessons from public.materials where url like '/practice/task1-lessons/%' and collection is not null;
