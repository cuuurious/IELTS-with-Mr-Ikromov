-- Migration 141: Task 2 lessons 1-24, Vocabulary for IELTS (20 units) and
-- Vocabulary for IELTS Advanced (20 units) in the Practice Bank (2026-11-23).
-- Pages: public/practice/task2-lessons/lesson-01..24.html,
--        public/practice/vocabulary/unit-01..20.html,
--        public/practice/vocabulary-advanced/unit-01..20.html.
-- Task 2 lessons stay in the Writing tab ("Task 2 Lessons"); the vocabulary
-- books go in the tab that is now called "Grammar & Vocabulary" (skill 'workshop').
-- Lesson 1 already exists (migration 138): its row is kept and its size updated.
-- Safe to run more than once.

set lock_timeout = '8s';

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select v.title, substr(v.url, length(regexp_replace(v.url, '[^/]*$', '')) + 1), 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       v.skill, null, v.collection, v.n, false, null
from (values
  ('writing', 'Task 2 Lessons · Lessons', 1, 'Task 2 Lesson 1 · Essay types and the discussion introduction', '/practice/task2-lessons/lesson-01.html', 62591),
  ('writing', 'Task 2 Lessons · Lessons', 2, 'Task 2 Lesson 2 · Developing Ideas', '/practice/task2-lessons/lesson-02.html', 103071),
  ('writing', 'Task 2 Lessons · Lessons', 3, 'Task 2 Lesson 3 · Conclusions', '/practice/task2-lessons/lesson-03.html', 54373),
  ('writing', 'Task 2 Lessons · Lessons', 4, 'Task 2 Lesson 4 · Agree / disagree introductions', '/practice/task2-lessons/lesson-04.html', 57070),
  ('writing', 'Task 2 Lessons · Lessons', 5, 'Task 2 Lesson 5 · Agree / disagree body paragraphs', '/practice/task2-lessons/lesson-05.html', 71970),
  ('writing', 'Task 2 Lessons · Lessons', 6, 'Task 2 Lesson 6 · Agree / disagree conclusions', '/practice/task2-lessons/lesson-06.html', 53094),
  ('writing', 'Task 2 Lessons · Lessons', 7, 'Task 2 Lesson 7 · Positive or negative introductions', '/practice/task2-lessons/lesson-07.html', 54255),
  ('writing', 'Task 2 Lessons · Lessons', 8, 'Task 2 Lesson 8 · Positive or negative body paragraphs', '/practice/task2-lessons/lesson-08.html', 76676),
  ('writing', 'Task 2 Lessons · Lessons', 9, 'Task 2 Lesson 9 · Positive or negative conclusions', '/practice/task2-lessons/lesson-09.html', 53381),
  ('writing', 'Task 2 Lessons · Lessons', 10, 'Task 2 Lesson 10 · Advantages and disadvantages introductions', '/practice/task2-lessons/lesson-10.html', 53995),
  ('writing', 'Task 2 Lessons · Lessons', 11, 'Task 2 Lesson 11 · Advantages and disadvantages body paragraphs', '/practice/task2-lessons/lesson-11.html', 75858),
  ('writing', 'Task 2 Lessons · Lessons', 12, 'Task 2 Lesson 12 · Advantages and disadvantages conclusions', '/practice/task2-lessons/lesson-12.html', 51777),
  ('writing', 'Task 2 Lessons · Lessons', 13, 'Task 2 Lesson 13 · Advantages and disadvantages introductions (with opinion)', '/practice/task2-lessons/lesson-13.html', 56110),
  ('writing', 'Task 2 Lessons · Lessons', 14, 'Task 2 Lesson 14 · Advantages and disadvantages body paragraphs (with opinion)', '/practice/task2-lessons/lesson-14.html', 71694),
  ('writing', 'Task 2 Lessons · Lessons', 15, 'Task 2 Lesson 15 · Advantages and disadvantages conclusions (with opinion)', '/practice/task2-lessons/lesson-15.html', 53983),
  ('writing', 'Task 2 Lessons · Lessons', 16, 'Task 2 Lesson 16 · Causes and solutions introductions', '/practice/task2-lessons/lesson-16.html', 55485),
  ('writing', 'Task 2 Lessons · Lessons', 17, 'Task 2 Lesson 17 · Causes and solutions body paragraphs', '/practice/task2-lessons/lesson-17.html', 74674),
  ('writing', 'Task 2 Lessons · Lessons', 18, 'Task 2 Lesson 18 · Causes and solutions conclusions', '/practice/task2-lessons/lesson-18.html', 52873),
  ('writing', 'Task 2 Lessons · Lessons', 19, 'Task 2 Lesson 19 · Effects and solutions introductions', '/practice/task2-lessons/lesson-19.html', 55284),
  ('writing', 'Task 2 Lessons · Lessons', 20, 'Task 2 Lesson 20 · Effects and solutions body paragraphs', '/practice/task2-lessons/lesson-20.html', 75292),
  ('writing', 'Task 2 Lessons · Lessons', 21, 'Task 2 Lesson 21 · Effects and solutions conclusions', '/practice/task2-lessons/lesson-21.html', 52340),
  ('writing', 'Task 2 Lessons · Lessons', 22, 'Task 2 Lesson 22 · Two-part question introductions', '/practice/task2-lessons/lesson-22.html', 54566),
  ('writing', 'Task 2 Lessons · Lessons', 23, 'Task 2 Lesson 23 · Two-part question body paragraphs', '/practice/task2-lessons/lesson-23.html', 75200),
  ('writing', 'Task 2 Lessons · Lessons', 24, 'Task 2 Lesson 24 · Two-part question conclusions', '/practice/task2-lessons/lesson-24.html', 53071),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 1, 'Vocabulary for IELTS · Unit 1 · Growing up', '/practice/vocabulary/unit-01.html', 2539731),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 2, 'Vocabulary for IELTS · Unit 2 · Mental and physical development', '/practice/vocabulary/unit-02.html', 1560084),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 3, 'Vocabulary for IELTS · Unit 3 · Keeping fit', '/practice/vocabulary/unit-03.html', 1268236),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 4, 'Vocabulary for IELTS · Unit 4 · Lifestyles', '/practice/vocabulary/unit-04.html', 1670307),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 5, 'Vocabulary for IELTS · Unit 5 · Student life', '/practice/vocabulary/unit-05.html', 1456560),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 6, 'Vocabulary for IELTS · Unit 6 · Effective communication', '/practice/vocabulary/unit-06.html', 961034),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 7, 'Vocabulary for IELTS · Unit 7 · On the move', '/practice/vocabulary/unit-07.html', 1303222),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 8, 'Vocabulary for IELTS · Unit 8 · Through the ages', '/practice/vocabulary/unit-08.html', 1727763),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 9, 'Vocabulary for IELTS · Unit 9 · The natural world', '/practice/vocabulary/unit-09.html', 618485),
  ('workshop', 'Vocabulary for IELTS · Units 1–10', 10, 'Vocabulary for IELTS · Unit 10 · Reaching for the skies', '/practice/vocabulary/unit-10.html', 2319558),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 11, 'Vocabulary for IELTS · Unit 11 · Design and innovation', '/practice/vocabulary/unit-11.html', 907950),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 12, 'Vocabulary for IELTS · Unit 12 · Information technology', '/practice/vocabulary/unit-12.html', 825825),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 13, 'Vocabulary for IELTS · Unit 13 · The modern world', '/practice/vocabulary/unit-13.html', 1246042),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 14, 'Vocabulary for IELTS · Unit 14 · Urbanisation', '/practice/vocabulary/unit-14.html', 877933),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 15, 'Vocabulary for IELTS · Unit 15 · The green revolution', '/practice/vocabulary/unit-15.html', 1286634),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 16, 'Vocabulary for IELTS · Unit 16 · The energy crisis', '/practice/vocabulary/unit-16.html', 1261982),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 17, 'Vocabulary for IELTS · Unit 17 · Talking business', '/practice/vocabulary/unit-17.html', 1101924),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 18, 'Vocabulary for IELTS · Unit 18 · The law', '/practice/vocabulary/unit-18.html', 844545),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 19, 'Vocabulary for IELTS · Unit 19 · The media', '/practice/vocabulary/unit-19.html', 1472414),
  ('workshop', 'Vocabulary for IELTS · Units 11–20', 20, 'Vocabulary for IELTS · Unit 20 · The arts', '/practice/vocabulary/unit-20.html', 1535935),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 1, 'Vocabulary for IELTS Advanced · Unit 1 · Human nature', '/practice/vocabulary-advanced/unit-01.html', 2704083),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 2, 'Vocabulary for IELTS Advanced · Unit 2 · Time for a change', '/practice/vocabulary-advanced/unit-02.html', 1992713),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 3, 'Vocabulary for IELTS Advanced · Unit 3 · No man is an island', '/practice/vocabulary-advanced/unit-03.html', 1889532),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 4, 'Vocabulary for IELTS Advanced · Unit 4 · Scientific discovery', '/practice/vocabulary-advanced/unit-04.html', 1465526),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 5, 'Vocabulary for IELTS Advanced · Unit 5 · Striving to achieve', '/practice/vocabulary-advanced/unit-05.html', 2251649),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 6, 'Vocabulary for IELTS Advanced · Unit 6 · Powers of persuasion', '/practice/vocabulary-advanced/unit-06.html', 1944344),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 7, 'Vocabulary for IELTS Advanced · Unit 7 · Ways and means', '/practice/vocabulary-advanced/unit-07.html', 2841016),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 8, 'Vocabulary for IELTS Advanced · Unit 8 · State control', '/practice/vocabulary-advanced/unit-08.html', 1460169),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 9, 'Vocabulary for IELTS Advanced · Unit 9 · Natural history', '/practice/vocabulary-advanced/unit-09.html', 1017021),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 1–10', 10, 'Vocabulary for IELTS Advanced · Unit 10 · Rocket science', '/practice/vocabulary-advanced/unit-10.html', 3015347),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 11, 'Vocabulary for IELTS Advanced · Unit 11 · Progress', '/practice/vocabulary-advanced/unit-11.html', 2011457),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 12, 'Vocabulary for IELTS Advanced · Unit 12 · The latest thing', '/practice/vocabulary-advanced/unit-12.html', 688437),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 13, 'Vocabulary for IELTS Advanced · Unit 13 · Urban jungle', '/practice/vocabulary-advanced/unit-13.html', 5004681),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 14, 'Vocabulary for IELTS Advanced · Unit 14 · Tackling issues', '/practice/vocabulary-advanced/unit-14.html', 672858),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 15, 'Vocabulary for IELTS Advanced · Unit 15 · This Earth', '/practice/vocabulary-advanced/unit-15.html', 3940299),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 16, 'Vocabulary for IELTS Advanced · Unit 16 · Energy efficient', '/practice/vocabulary-advanced/unit-16.html', 2727436),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 17, 'Vocabulary for IELTS Advanced · Unit 17 · Getting down to business', '/practice/vocabulary-advanced/unit-17.html', 1348693),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 18, 'Vocabulary for IELTS Advanced · Unit 18 · Law enforcement', '/practice/vocabulary-advanced/unit-18.html', 2394001),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 19, 'Vocabulary for IELTS Advanced · Unit 19 · The media', '/practice/vocabulary-advanced/unit-19.html', 1293019),
  ('workshop', 'Vocabulary for IELTS Advanced · Units 11–20', 20, 'Vocabulary for IELTS Advanced · Unit 20 · A matter of taste', '/practice/vocabulary-advanced/unit-20.html', 1826571)
) as v(skill, collection, n, title, url, size)
where not exists (select 1 from public.materials m where m.url = v.url and m.collection is not null);

-- Lesson 1 was replaced by a newer version of the page.
update public.materials set size_bytes = 62591
where url = '/practice/task2-lessons/lesson-01.html' and collection is not null;

notify pgrst, 'reload schema';

-- Check: expect task2_lessons = 24, vocabulary = 20, vocabulary_advanced = 20
select
  (select count(*) from public.materials where url like '/practice/task2-lessons/%' and collection is not null) as task2_lessons,
  (select count(*) from public.materials where url like '/practice/vocabulary/%' and collection is not null) as vocabulary,
  (select count(*) from public.materials where url like '/practice/vocabulary-advanced/%' and collection is not null) as vocabulary_advanced;
