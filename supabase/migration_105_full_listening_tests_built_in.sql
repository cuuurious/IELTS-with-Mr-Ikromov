-- migration_105_full_listening_tests_built_in.sql  (2026-11-05)
-- Mr Ikromov's 53 full IELTS Listening tests (Parts 1–4, 40 questions,
-- the four part recordings play one after another) are part of the
-- website: pages live in public/practice/listening-full/ and use the
-- part recordings already in public/practice/listening/audio/.
-- This adds them to the Practice Bank under Listening as
-- "Full Listening Tests · Tests 1–10" etc. Scores save by themselves.
-- Safe to run twice. Needs migration 92 first.

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source,
   skill, question_type, collection, position, on_shelf, created_by)
select v.title, v.file_name, 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       'listening', null, v.collection, v.pos, false, null
from (values
  ('Full listening test 1', 'test-01.html', '/practice/listening-full/test-01.html', 80959, 'Full Listening Tests · Tests 1–10', 1),
  ('Full listening test 2', 'test-02.html', '/practice/listening-full/test-02.html', 32371, 'Full Listening Tests · Tests 1–10', 2),
  ('Full listening test 3', 'test-03.html', '/practice/listening-full/test-03.html', 31559, 'Full Listening Tests · Tests 1–10', 3),
  ('Full listening test 4', 'test-04.html', '/practice/listening-full/test-04.html', 33821, 'Full Listening Tests · Tests 1–10', 4),
  ('Full listening test 5', 'test-05.html', '/practice/listening-full/test-05.html', 33375, 'Full Listening Tests · Tests 1–10', 5),
  ('Full listening test 6', 'test-06.html', '/practice/listening-full/test-06.html', 33900, 'Full Listening Tests · Tests 1–10', 6),
  ('Full listening test 7', 'test-07.html', '/practice/listening-full/test-07.html', 115192, 'Full Listening Tests · Tests 1–10', 7),
  ('Full listening test 8', 'test-08.html', '/practice/listening-full/test-08.html', 33230, 'Full Listening Tests · Tests 1–10', 8),
  ('Full listening test 9', 'test-09.html', '/practice/listening-full/test-09.html', 34151, 'Full Listening Tests · Tests 1–10', 9),
  ('Full listening test 10', 'test-10.html', '/practice/listening-full/test-10.html', 33677, 'Full Listening Tests · Tests 1–10', 10),
  ('Full listening test 11', 'test-11.html', '/practice/listening-full/test-11.html', 32946, 'Full Listening Tests · Tests 11–20', 11),
  ('Full listening test 12', 'test-12.html', '/practice/listening-full/test-12.html', 34717, 'Full Listening Tests · Tests 11–20', 12),
  ('Full listening test 13', 'test-13.html', '/practice/listening-full/test-13.html', 49612, 'Full Listening Tests · Tests 11–20', 13),
  ('Full listening test 14', 'test-14.html', '/practice/listening-full/test-14.html', 34448, 'Full Listening Tests · Tests 11–20', 14),
  ('Full listening test 15', 'test-15.html', '/practice/listening-full/test-15.html', 236429, 'Full Listening Tests · Tests 11–20', 15),
  ('Full listening test 16', 'test-16.html', '/practice/listening-full/test-16.html', 94365, 'Full Listening Tests · Tests 11–20', 16),
  ('Full listening test 17', 'test-17.html', '/practice/listening-full/test-17.html', 33307, 'Full Listening Tests · Tests 11–20', 17),
  ('Full listening test 18', 'test-18.html', '/practice/listening-full/test-18.html', 33128, 'Full Listening Tests · Tests 11–20', 18),
  ('Full listening test 19', 'test-19.html', '/practice/listening-full/test-19.html', 33275, 'Full Listening Tests · Tests 11–20', 19),
  ('Full listening test 20', 'test-20.html', '/practice/listening-full/test-20.html', 35510, 'Full Listening Tests · Tests 11–20', 20),
  ('Full listening test 21', 'test-21.html', '/practice/listening-full/test-21.html', 184814, 'Full Listening Tests · Tests 21–30', 21),
  ('Full listening test 22', 'test-22.html', '/practice/listening-full/test-22.html', 34770, 'Full Listening Tests · Tests 21–30', 22),
  ('Full listening test 23', 'test-23.html', '/practice/listening-full/test-23.html', 150461, 'Full Listening Tests · Tests 21–30', 23),
  ('Full listening test 24', 'test-24.html', '/practice/listening-full/test-24.html', 35025, 'Full Listening Tests · Tests 21–30', 24),
  ('Full listening test 25', 'test-25.html', '/practice/listening-full/test-25.html', 33452, 'Full Listening Tests · Tests 21–30', 25),
  ('Full listening test 26', 'test-26.html', '/practice/listening-full/test-26.html', 34377, 'Full Listening Tests · Tests 21–30', 26),
  ('Full listening test 27', 'test-27.html', '/practice/listening-full/test-27.html', 31916, 'Full Listening Tests · Tests 21–30', 27),
  ('Full listening test 28', 'test-28.html', '/practice/listening-full/test-28.html', 34219, 'Full Listening Tests · Tests 21–30', 28),
  ('Full listening test 29', 'test-29.html', '/practice/listening-full/test-29.html', 69838, 'Full Listening Tests · Tests 21–30', 29),
  ('Full listening test 30', 'test-30.html', '/practice/listening-full/test-30.html', 34802, 'Full Listening Tests · Tests 21–30', 30),
  ('Full listening test 31', 'test-31.html', '/practice/listening-full/test-31.html', 74231, 'Full Listening Tests · Tests 31–40', 31),
  ('Full listening test 32', 'test-32.html', '/practice/listening-full/test-32.html', 88882, 'Full Listening Tests · Tests 31–40', 32),
  ('Full listening test 33', 'test-33.html', '/practice/listening-full/test-33.html', 34750, 'Full Listening Tests · Tests 31–40', 33),
  ('Full listening test 34', 'test-34.html', '/practice/listening-full/test-34.html', 61756, 'Full Listening Tests · Tests 31–40', 34),
  ('Full listening test 35', 'test-35.html', '/practice/listening-full/test-35.html', 63242, 'Full Listening Tests · Tests 31–40', 35),
  ('Full listening test 36', 'test-36.html', '/practice/listening-full/test-36.html', 64434, 'Full Listening Tests · Tests 31–40', 36),
  ('Full listening test 37', 'test-37.html', '/practice/listening-full/test-37.html', 34413, 'Full Listening Tests · Tests 31–40', 37),
  ('Full listening test 38', 'test-38.html', '/practice/listening-full/test-38.html', 34414, 'Full Listening Tests · Tests 31–40', 38),
  ('Full listening test 39', 'test-39.html', '/practice/listening-full/test-39.html', 350576, 'Full Listening Tests · Tests 31–40', 39),
  ('Full listening test 40', 'test-40.html', '/practice/listening-full/test-40.html', 33678, 'Full Listening Tests · Tests 31–40', 40),
  ('Full listening test 41', 'test-41.html', '/practice/listening-full/test-41.html', 32067, 'Full Listening Tests · Tests 41–50', 41),
  ('Full listening test 42', 'test-42.html', '/practice/listening-full/test-42.html', 61930, 'Full Listening Tests · Tests 41–50', 42),
  ('Full listening test 43', 'test-43.html', '/practice/listening-full/test-43.html', 64629, 'Full Listening Tests · Tests 41–50', 43),
  ('Full listening test 44', 'test-44.html', '/practice/listening-full/test-44.html', 34849, 'Full Listening Tests · Tests 41–50', 44),
  ('Full listening test 45', 'test-45.html', '/practice/listening-full/test-45.html', 34843, 'Full Listening Tests · Tests 41–50', 45),
  ('Full listening test 46', 'test-46.html', '/practice/listening-full/test-46.html', 87218, 'Full Listening Tests · Tests 41–50', 46),
  ('Full listening test 47', 'test-47.html', '/practice/listening-full/test-47.html', 52071, 'Full Listening Tests · Tests 41–50', 47),
  ('Full listening test 48', 'test-48.html', '/practice/listening-full/test-48.html', 34996, 'Full Listening Tests · Tests 41–50', 48),
  ('Full listening test 49', 'test-49.html', '/practice/listening-full/test-49.html', 208659, 'Full Listening Tests · Tests 41–50', 49),
  ('Full listening test 50', 'test-50.html', '/practice/listening-full/test-50.html', 244418, 'Full Listening Tests · Tests 41–50', 50),
  ('Full listening test 51', 'test-51.html', '/practice/listening-full/test-51.html', 33822, 'Full Listening Tests · Tests 51–53', 51),
  ('Full listening test 52', 'test-52.html', '/practice/listening-full/test-52.html', 117798, 'Full Listening Tests · Tests 51–53', 52),
  ('Full listening test 53', 'test-53.html', '/practice/listening-full/test-53.html', 119408, 'Full Listening Tests · Tests 51–53', 53)
) as v(title, file_name, url, size, collection, pos)
where not exists (select 1 from public.materials m where m.url = v.url);
