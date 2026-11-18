-- migration_134_grammar_lessons.sql (2026-11-18)
-- Mr Ikromov's 30 grammar lessons (Grammarway 3 + 4, merged by topic) become
-- part of the website. The pages live in public/practice/grammar/lesson-01..30.html.
--
--  1. Practice Bank → new "Grammar" tab, in 4 books (Lessons 1–7, 8–14,
--     15–20, 21–30). Give any lesson as homework like any bank page; the
--     score is the first-try score and arrives when every exercise is done.
--  2. Materials Library → folder "Grammar" with the same 30 lessons, so they
--     can also be added as lesson materials (Add from Library) and opened
--     inside the site.
--
-- Safe to run more than once. Needs migration 92 (collection column).

set lock_timeout = '8s';

-- 1. Practice Bank
insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select v.title, substr(v.url, 19), 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       'workshop', null, v.collection, v.n, false, null
from (values
  (1, 'Grammar Lesson 1 · Present Forms', '/practice/grammar/lesson-01.html', 208006, 'Grammar · Lessons 1–7'),
  (2, 'Grammar Lesson 2 · Past Forms', '/practice/grammar/lesson-02.html', 144811, 'Grammar · Lessons 1–7'),
  (3, 'Grammar Lesson 3 · Future Forms', '/practice/grammar/lesson-03.html', 129915, 'Grammar · Lessons 1–7'),
  (4, 'Grammar Lesson 4 · Tense Contrasts and Review', '/practice/grammar/lesson-04.html', 108836, 'Grammar · Lessons 1–7'),
  (5, 'Grammar Lesson 5 · The Infinitive', '/practice/grammar/lesson-05.html', 111643, 'Grammar · Lessons 1–7'),
  (6, 'Grammar Lesson 6 · The -ing Form and Infinitive vs -ing', '/practice/grammar/lesson-06.html', 106723, 'Grammar · Lessons 1–7'),
  (7, 'Grammar Lesson 7 · Participles, too and enough', '/practice/grammar/lesson-07.html', 106110, 'Grammar · Lessons 1–7'),
  (8, 'Grammar Lesson 8 · Modals: obligation and necessity', '/practice/grammar/lesson-08.html', 102165, 'Grammar · Lessons 8–14'),
  (9, 'Grammar Lesson 9 · Modals: ability, permission, requests, offers', '/practice/grammar/lesson-09.html', 102580, 'Grammar · Lessons 8–14'),
  (10, 'Grammar Lesson 10 · Modals: advice, possibility, deduction, perfect modals', '/practice/grammar/lesson-10.html', 100557, 'Grammar · Lessons 8–14'),
  (11, 'Grammar Lesson 11 · The passive voice', '/practice/grammar/lesson-11.html', 99948, 'Grammar · Lessons 8–14'),
  (12, 'Grammar Lesson 12 · Advanced passive and have something done', '/practice/grammar/lesson-12.html', 99901, 'Grammar · Lessons 8–14'),
  (13, 'Grammar Lesson 13 · Conditionals', '/practice/grammar/lesson-13.html', 100463, 'Grammar · Lessons 8–14'),
  (14, 'Grammar Lesson 14 · Wishes, would rather, had better and the unreal past', '/practice/grammar/lesson-14.html', 99274, 'Grammar · Lessons 8–14'),
  (15, 'Grammar Lesson 15 · Relative clauses', '/practice/grammar/lesson-15.html', 100660, 'Grammar · Lessons 15–20'),
  (16, 'Grammar Lesson 16 · Clauses of time, result and reason', '/practice/grammar/lesson-16.html', 100507, 'Grammar · Lessons 15–20'),
  (17, 'Grammar Lesson 17 · Purpose, contrast, manner and exclamations', '/practice/grammar/lesson-17.html', 101114, 'Grammar · Lessons 15–20'),
  (18, 'Grammar Lesson 18 · Reported speech: statements', '/practice/grammar/lesson-18.html', 105900, 'Grammar · Lessons 15–20'),
  (19, 'Grammar Lesson 19 · Reported speech: questions, commands and reporting verbs', '/practice/grammar/lesson-19.html', 104973, 'Grammar · Lessons 15–20'),
  (20, 'Grammar Lesson 20 · Emphasis and inversion', '/practice/grammar/lesson-20.html', 104615, 'Grammar · Lessons 15–20'),
  (21, 'Grammar Lesson 21 · Nouns: countable, uncountable, agreement and possession', '/practice/grammar/lesson-21.html', 102965, 'Grammar · Lessons 21–30'),
  (22, 'Grammar Lesson 22 · Articles: a / an / one, the and no article', '/practice/grammar/lesson-22.html', 100874, 'Grammar · Lessons 21–30'),
  (23, 'Grammar Lesson 23 · Word formation: prefixes and suffixes', '/practice/grammar/lesson-23.html', 100457, 'Grammar · Lessons 21–30'),
  (24, 'Grammar Lesson 24 · Adjectives and adverbs', '/practice/grammar/lesson-24.html', 99839, 'Grammar · Lessons 21–30'),
  (25, 'Grammar Lesson 25 · Comparisons', '/practice/grammar/lesson-25.html', 98327, 'Grammar · Lessons 21–30'),
  (26, 'Grammar Lesson 26 · Pronouns, possessives, reflexives and demonstratives', '/practice/grammar/lesson-26.html', 99454, 'Grammar · Lessons 21–30'),
  (27, 'Grammar Lesson 27 · Quantifiers', '/practice/grammar/lesson-27.html', 99781, 'Grammar · Lessons 21–30'),
  (28, 'Grammar Lesson 28 · Questions and Answers', '/practice/grammar/lesson-28.html', 97369, 'Grammar · Lessons 21–30'),
  (29, 'Grammar Lesson 29 · Prepositions', '/practice/grammar/lesson-29.html', 116117, 'Grammar · Lessons 21–30'),
  (30, 'Grammar Lesson 30 · Words Often Confused, Irregular Verbs and Final Review', '/practice/grammar/lesson-30.html', 108047, 'Grammar · Lessons 21–30')
) as v(n, title, url, size, collection)
where not exists (select 1 from public.materials m where m.url = v.url and m.collection is not null);

-- 2. Materials Library: folder "Grammar" + the same lessons
insert into public.material_folders (name, parent_id, created_by)
select 'Grammar', null, null
 where not exists (select 1 from public.material_folders where parent_id is null and lower(btrim(name)) = 'grammar');

insert into public.materials
  (folder_id, title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select (select id from public.material_folders where parent_id is null and lower(btrim(name)) = 'grammar'),
       v.title, 'grammar-lesson-' || lpad(v.n::text, 2, '0') || '.html', 'site:' || substr(v.url, 2) || '?library', v.url,
       'text/html', v.size, 'upload', null, null, null, null, false, null
from (values
  (1, 'Grammar Lesson 1 · Present Forms', '/practice/grammar/lesson-01.html', 208006, 'Grammar · Lessons 1–7'),
  (2, 'Grammar Lesson 2 · Past Forms', '/practice/grammar/lesson-02.html', 144811, 'Grammar · Lessons 1–7'),
  (3, 'Grammar Lesson 3 · Future Forms', '/practice/grammar/lesson-03.html', 129915, 'Grammar · Lessons 1–7'),
  (4, 'Grammar Lesson 4 · Tense Contrasts and Review', '/practice/grammar/lesson-04.html', 108836, 'Grammar · Lessons 1–7'),
  (5, 'Grammar Lesson 5 · The Infinitive', '/practice/grammar/lesson-05.html', 111643, 'Grammar · Lessons 1–7'),
  (6, 'Grammar Lesson 6 · The -ing Form and Infinitive vs -ing', '/practice/grammar/lesson-06.html', 106723, 'Grammar · Lessons 1–7'),
  (7, 'Grammar Lesson 7 · Participles, too and enough', '/practice/grammar/lesson-07.html', 106110, 'Grammar · Lessons 1–7'),
  (8, 'Grammar Lesson 8 · Modals: obligation and necessity', '/practice/grammar/lesson-08.html', 102165, 'Grammar · Lessons 8–14'),
  (9, 'Grammar Lesson 9 · Modals: ability, permission, requests, offers', '/practice/grammar/lesson-09.html', 102580, 'Grammar · Lessons 8–14'),
  (10, 'Grammar Lesson 10 · Modals: advice, possibility, deduction, perfect modals', '/practice/grammar/lesson-10.html', 100557, 'Grammar · Lessons 8–14'),
  (11, 'Grammar Lesson 11 · The passive voice', '/practice/grammar/lesson-11.html', 99948, 'Grammar · Lessons 8–14'),
  (12, 'Grammar Lesson 12 · Advanced passive and have something done', '/practice/grammar/lesson-12.html', 99901, 'Grammar · Lessons 8–14'),
  (13, 'Grammar Lesson 13 · Conditionals', '/practice/grammar/lesson-13.html', 100463, 'Grammar · Lessons 8–14'),
  (14, 'Grammar Lesson 14 · Wishes, would rather, had better and the unreal past', '/practice/grammar/lesson-14.html', 99274, 'Grammar · Lessons 8–14'),
  (15, 'Grammar Lesson 15 · Relative clauses', '/practice/grammar/lesson-15.html', 100660, 'Grammar · Lessons 15–20'),
  (16, 'Grammar Lesson 16 · Clauses of time, result and reason', '/practice/grammar/lesson-16.html', 100507, 'Grammar · Lessons 15–20'),
  (17, 'Grammar Lesson 17 · Purpose, contrast, manner and exclamations', '/practice/grammar/lesson-17.html', 101114, 'Grammar · Lessons 15–20'),
  (18, 'Grammar Lesson 18 · Reported speech: statements', '/practice/grammar/lesson-18.html', 105900, 'Grammar · Lessons 15–20'),
  (19, 'Grammar Lesson 19 · Reported speech: questions, commands and reporting verbs', '/practice/grammar/lesson-19.html', 104973, 'Grammar · Lessons 15–20'),
  (20, 'Grammar Lesson 20 · Emphasis and inversion', '/practice/grammar/lesson-20.html', 104615, 'Grammar · Lessons 15–20'),
  (21, 'Grammar Lesson 21 · Nouns: countable, uncountable, agreement and possession', '/practice/grammar/lesson-21.html', 102965, 'Grammar · Lessons 21–30'),
  (22, 'Grammar Lesson 22 · Articles: a / an / one, the and no article', '/practice/grammar/lesson-22.html', 100874, 'Grammar · Lessons 21–30'),
  (23, 'Grammar Lesson 23 · Word formation: prefixes and suffixes', '/practice/grammar/lesson-23.html', 100457, 'Grammar · Lessons 21–30'),
  (24, 'Grammar Lesson 24 · Adjectives and adverbs', '/practice/grammar/lesson-24.html', 99839, 'Grammar · Lessons 21–30'),
  (25, 'Grammar Lesson 25 · Comparisons', '/practice/grammar/lesson-25.html', 98327, 'Grammar · Lessons 21–30'),
  (26, 'Grammar Lesson 26 · Pronouns, possessives, reflexives and demonstratives', '/practice/grammar/lesson-26.html', 99454, 'Grammar · Lessons 21–30'),
  (27, 'Grammar Lesson 27 · Quantifiers', '/practice/grammar/lesson-27.html', 99781, 'Grammar · Lessons 21–30'),
  (28, 'Grammar Lesson 28 · Questions and Answers', '/practice/grammar/lesson-28.html', 97369, 'Grammar · Lessons 21–30'),
  (29, 'Grammar Lesson 29 · Prepositions', '/practice/grammar/lesson-29.html', 116117, 'Grammar · Lessons 21–30'),
  (30, 'Grammar Lesson 30 · Words Often Confused, Irregular Verbs and Final Review', '/practice/grammar/lesson-30.html', 108047, 'Grammar · Lessons 21–30')
) as v(n, title, url, size, collection)
where not exists (select 1 from public.materials m where m.url = v.url and m.collection is null);

notify pgrst, 'reload schema';

-- Check: expect bank_rows = 30, library_rows = 30, folder = 1
select
  (select count(*) from public.materials where url like '/practice/grammar/%' and collection is not null) as bank_rows,
  (select count(*) from public.materials where url like '/practice/grammar/%' and collection is null) as library_rows,
  (select count(*) from public.material_folders where parent_id is null and lower(btrim(name)) = 'grammar') as folder;
