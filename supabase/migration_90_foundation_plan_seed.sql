-- migration_90_foundation_plan_seed.sql (2026-11-02)
--
-- First draft of the Foundation course (36 lessons, 12 weeks, 3 a week),
-- from the "Foundation Course Plan (draft)" doc. Run it once you're happy
-- with the doc; afterwards edit any lesson in Classroom → Course plans
-- (slides, class files and in-site tasks are added there).
--
-- Safe to run again: it only fills lessons that are still empty, and never
-- overwrites a lesson you've already written.

do $$
declare
  v_plan uuid;
begin
  select id into v_plan from public.course_plans where lower(title) = 'foundation' limit 1;
  if v_plan is null then
    insert into public.course_plans (title, description, weeks, sort_order)
    values ('Foundation',
            '3 months, 3 lessons a week. Day 1 Reading (one question type), Day 2 Listening + Speaking, Day 3 Writing. Lessons 12, 24 and 36 are checkpoint tests.',
            12, 1)
    returning id into v_plan;
  end if;

  insert into public.plan_lessons (plan_id, number, title, goal, homework_title, homework_text, enable_speaking, min_files)
  select v_plan, d.n, d.title, d.goal, d.hw_title, d.hw_text, d.speaking, d.min_files
    from (values
  (1, 'Reading: how the paper works + Note completion', 'Timing, skimming vs scanning, Note completion strategy', 'Lesson 1 homework', 'Reading homework: Book 1 · Section 1, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (2, 'Listening Part 1 + Speaking Lesson 1', 'Part 1 book Lessons 1–2 (at a glance; numbers, dates, prices); Speaking test format', 'Lesson 2 homework', 'Listening Part 1 Tests 1–2; record Part 1 answers. Record your speaking answers here in the site.', true, 0),
  (3, 'Task 1: introduction and overview', 'Paraphrasing the question, finding main features', 'Lesson 3 homework', 'Writing homework: Intro + overview for 2 Task 1 practice tasks. Write it by hand and upload a clear photo of it.', false, 1),
  (4, 'Reading: True / False / Not Given', 'False vs Not Given, keyword traps', 'Lesson 4 homework', 'Reading homework: Book 1 · Section 2, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (5, 'Listening Part 1 (forms) + Speaking Lesson 2 “All About You”', 'Part 1 book Lessons 3–5 (spelling, distractors, word limits)', 'Lesson 5 homework', 'Listening Part 1 Tests 3–4; record answers. Record your speaking answers here in the site.', true, 0),
  (6, 'Task 1: line graphs', 'Describing trends, trend vocabulary', 'Lesson 6 homework', 'Writing homework: Full line-graph task. Write it by hand and upload a clear photo of it.', false, 1),
  (7, 'Reading: Which paragraph contains the information', 'Paragraph summaries, scanning for detail', 'Lesson 7 homework', 'Reading homework: Book 2 · Section 1, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (8, 'Listening Part 2 (MCQ) + Speaking Lesson 3', 'Part 2 book Lessons 1 and 4 (multiple choice); Part 1 topics + first cue card', 'Lesson 8 homework', 'Listening Part 2 Tests 1–2; record answers. Record your speaking answers here in the site.', true, 0),
  (9, 'Task 1: bar charts', 'Comparing data, comparison language', 'Lesson 9 homework', 'Writing homework: Full bar-chart task. Write it by hand and upload a clear photo of it.', false, 1),
  (10, 'Reading: Summary completion with a list of words', 'Predicting the word type, ruling out options', 'Lesson 10 homework', 'Reading homework: Book 3 · Section 4, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (11, 'Listening Part 2 (maps and plans) + Speaking Lesson 4', 'Part 2 book Lessons 2–3 (maps, matching); Part 2 note-making in 1 minute', 'Lesson 11 homework', 'Listening Part 2 Tests 3–4; record a cue card. Record your speaking answers here in the site.', true, 0),
  (12, 'Checkpoint 1', 'One Listening part, one Reading passage, one Task 1 — timed', 'Lesson 12 homework', 'Review mistakes in the error log.', false, 0),
  (13, 'Reading: Matching headings', 'Main idea vs detail, ruling out headings', 'Lesson 13 homework', 'Reading homework: Book 2 · Section 2, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (14, 'Listening Part 3 (matching) + Speaking Lesson 5', 'Part 3 book Lessons 1, 2 and 4 (attitude language, matching with a box)', 'Lesson 14 homework', 'Listening Part 3 Tests 1–2; record answers. Record your speaking answers here in the site.', true, 0),
  (15, 'Task 1: pie charts, tables and mixed charts', 'Grouping data, proportions', 'Lesson 15 homework', 'Writing homework: Full mixed-chart task. Write it by hand and upload a clear photo of it.', false, 1),
  (16, 'Reading: Multiple choice (one answer)', 'Eliminating options with evidence', 'Lesson 16 homework', 'Reading homework: Book 3 · Section 2, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (17, 'Listening Part 3 (MCQ) + Speaking Lesson 6', 'Part 3 book Lessons 3 and 5 (MCQ, choose two, flow-charts)', 'Lesson 17 homework', 'Listening Part 3 Tests 3–4; record answers. Record your speaking answers here in the site.', true, 0),
  (18, 'Task 2 Coursebook Lesson 1', 'Essay structure, introduction, first essay type', 'Lesson 18 homework', 'Writing homework: Step-by-step essay from the Practice Book. Write it by hand and upload a clear photo of it.', false, 1),
  (19, 'Reading: Matching features', 'Names and dates as anchors', 'Lesson 19 homework', 'Reading homework: Book 2 · Section 3, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (20, 'Listening Part 4 (lecture notes) + Speaking Lesson 7', 'Part 4 book Lessons 1–3 (signposts, predicting the gap)', 'Lesson 20 homework', 'Listening Part 4 Tests 1–2; record a cue card. Record your speaking answers here in the site.', true, 0),
  (21, 'Task 2 Coursebook Lesson 2', 'Second essay type, body paragraphs', 'Lesson 21 homework', 'Writing homework: Practice Book essay. Write it by hand and upload a clear photo of it.', false, 1),
  (22, 'Reading: Table and flow-chart completion', 'Following order and categories', 'Lesson 22 homework', 'Reading homework: Book 1 · Section 3, tasks 1–2; Book 2 · Section 5, task 1. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (23, 'Listening Part 4 + Speaking Lesson 8', 'Part 4 book Lessons 4–5 (note-taking, academic paraphrase)', 'Lesson 23 homework', 'Listening Part 4 Tests 3–4; record answers. Record your speaking answers here in the site.', true, 0),
  (24, 'Checkpoint 2', 'Listening Parts 1–4 (one test), one Reading passage, Task 1 timed', 'Lesson 24 homework', 'Error log + retake of weakest type.', false, 0),
  (25, 'Reading: Choosing two or three answers', 'Two-answer questions, paraphrase hunting', 'Lesson 25 homework', 'Reading homework: Book 3 · Section 3, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (26, 'Listening: mixed full test strategy + Speaking Lesson 9', '“Hear the paraphrase” lessons from all four books; Speaking Part 3 basics', 'Lesson 26 homework', 'One full Listening test; record answers. Record your speaking answers here in the site.', true, 0),
  (27, 'Task 2 Coursebook Lesson 3', 'Third essay type, generating ideas', 'Lesson 27 homework', 'Writing homework: Practice Book essay. Write it by hand and upload a clear photo of it.', false, 1),
  (28, 'Reading: Writer''s views (Yes / No / Not Given)', 'Opinion vs fact', 'Lesson 28 homework', 'Reading homework: Book 3 · Section 1, tasks 1–3. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (29, 'Listening review of weak parts + Speaking Lesson 10', '“Why you miss it” lessons; each student''s weakest part (weak-spot report)', 'Lesson 29 homework', 'Two tests of that part; record Part 3 answers. Record your speaking answers here in the site.', true, 0),
  (30, 'Task 2 Coursebook Lesson 4', 'Fourth essay type, conclusions', 'Lesson 30 homework', 'Writing homework: Practice Book essay. Write it by hand and upload a clear photo of it.', false, 1),
  (31, 'Reading: Sentence completion + Short answers', 'Word limits, grammar fit', 'Lesson 31 homework', 'Reading homework: Book 1 · Section 4, tasks 1–2; Section 5, task 1. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (32, 'Listening full test + Speaking Lesson 11', '“Training drills and dictation” lessons; full speaking test in pairs', 'Lesson 32 homework', 'One full Listening test; record a full speaking test. Record your speaking answers here in the site.', true, 0),
  (33, 'Task 2 Coursebook Lesson 5', 'Fifth essay type, timing 40 minutes', 'Lesson 33 homework', 'Writing homework: Timed Practice Book essay. Write it by hand and upload a clear photo of it.', false, 1),
  (34, 'Reading: Summary without a list + Sentence endings, under time', 'Pacing 20 minutes per passage', 'Lesson 34 homework', 'Reading homework: Book 2 · Section 4, tasks 1–2; Book 3 · Section 5, task 1. Do them in the site, check your answers and write every mistake in your error log.', false, 0),
  (35, 'Listening + Speaking Lesson 12: mock day', '“Improvement plan” lessons; full Speaking mock, feedback', 'Lesson 35 homework', 'Listening Tests from each Part. Record your speaking answers here in the site.', true, 0),
  (36, 'Checkpoint 3 (final)', 'Full Reading and Listening, one Task 2 essay', 'Lesson 36 homework', 'Results go to the Practice course start.', false, 0)
    ) as d(n, title, goal, hw_title, hw_text, speaking, min_files)
  on conflict (plan_id, number) do update
     set title = excluded.title,
         goal = excluded.goal,
         homework_title = excluded.homework_title,
         homework_text = excluded.homework_text,
         enable_speaking = excluded.enable_speaking,
         min_files = excluded.min_files
   where public.plan_lessons.title = '' and public.plan_lessons.homework_text = '';
end $$;
