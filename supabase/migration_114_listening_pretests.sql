-- migration_114_listening_pretests.sql (2026-11-06)
-- Full Listening Tests: the 20 new Pre-Test Collection tests replace the
-- old 53 "full tests", which were only Part 1+2+3+4 of the thematic
-- "Listen with Mr.Ikromov" pages put together (same audio twice).
--   * The old 53 leave Practice Bank. Their files stay on the site for
--     now, because 2 homework tasks still use test 47.
--   * The 20 new tests: shelves "Full Listening Tests · Tests 1–10" and
--     "· Tests 11–20", hidden from students' shelf like the others.
-- Run AFTER the audio is pushed (until then the tests play nothing).
-- Safe to run more than once.

set lock_timeout = '8s';

delete from public.materials
 where url like '/practice/listening-full/%';

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source,
   skill, question_type, collection, position, on_shelf)
values
  ('Listening Test 1: Volunteering at a country park · Early maps · Later development of maps', 'test-01.html', 'site:practice/listening-pretest/test-01.html', '/practice/listening-pretest/test-01.html', 'text/html', 39813, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 1, false),
  ('Listening Test 2: Visiting the City Zoo', 'test-02.html', 'site:practice/listening-pretest/test-02.html', '/practice/listening-pretest/test-02.html', 'text/html', 39683, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 2, false),
  ('Listening Test 3: Cranfield Summer Festival · Early maps · Later development of maps', 'test-03.html', 'site:practice/listening-pretest/test-03.html', '/practice/listening-pretest/test-03.html', 'text/html', 106889, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 3, false),
  ('Listening Test 4: Courses for the family · Desert Holidays · The benefits of singing', 'test-04.html', 'site:practice/listening-pretest/test-04.html', '/practice/listening-pretest/test-04.html', 'text/html', 41724, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 4, false),
  ('Listening Test 5', 'test-05.html', 'site:practice/listening-pretest/test-05.html', '/practice/listening-pretest/test-05.html', 'text/html', 35996, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 5, false),
  ('Listening Test 6: extrahands.com · Song-writing course for drama students', 'test-06.html', 'site:practice/listening-pretest/test-06.html', '/practice/listening-pretest/test-06.html', 'text/html', 36455, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 6, false),
  ('Listening Test 7: Bridge to Brisbane Fun Run · Map of Race Village · Farmers’ attitudes to new developments in agriculture', 'test-07.html', 'site:practice/listening-pretest/test-07.html', '/practice/listening-pretest/test-07.html', 'text/html', 80032, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 7, false),
  ('Listening Test 8', 'test-08.html', 'site:practice/listening-pretest/test-08.html', '/practice/listening-pretest/test-08.html', 'text/html', 36227, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 8, false),
  ('Listening Test 9: Group Project', 'test-09.html', 'site:practice/listening-pretest/test-09.html', '/practice/listening-pretest/test-09.html', 'text/html', 78728, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 9, false),
  ('Listening Test 10: Planning a Party · The world’s oldest mechanical computer: the Antikythera mechanism', 'test-10.html', 'site:practice/listening-pretest/test-10.html', '/practice/listening-pretest/test-10.html', 'text/html', 36128, 'upload', 'listening', null, 'Full Listening Tests · Tests 1–10', 10, false),
  ('Listening Test 11: Superior Home Appliances – Customer Complaint Form · Saffron', 'test-11.html', 'site:practice/listening-pretest/test-11.html', '/practice/listening-pretest/test-11.html', 'text/html', 37183, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 11, false),
  ('Listening Test 12: Library services · Forest Lake Campsite · Ethics in Engineering', 'test-12.html', 'site:practice/listening-pretest/test-12.html', '/practice/listening-pretest/test-12.html', 'text/html', 73393, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 12, false),
  ('Listening Test 13: The London Relocation Services · Starting work at Hollies supermarket · Hollies supermarket · Geography – 331 Field Trip', 'test-13.html', 'site:practice/listening-pretest/test-13.html', '/practice/listening-pretest/test-13.html', 'text/html', 81269, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 13, false),
  ('Listening Test 14: Kenvale School Fair', 'test-14.html', 'site:practice/listening-pretest/test-14.html', '/practice/listening-pretest/test-14.html', 'text/html', 68680, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 14, false),
  ('Listening Test 15: PLAN FOR STUDY SYNDICATE', 'test-15.html', 'site:practice/listening-pretest/test-15.html', '/practice/listening-pretest/test-15.html', 'text/html', 35589, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 15, false),
  ('Listening Test 16: Temporary restaurant work · Bachelor of Communications Degree · Spices', 'test-16.html', 'site:practice/listening-pretest/test-16.html', '/practice/listening-pretest/test-16.html', 'text/html', 37321, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 16, false),
  ('Listening Test 17: Desert Holidays', 'test-17.html', 'site:practice/listening-pretest/test-17.html', '/practice/listening-pretest/test-17.html', 'text/html', 38501, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 17, false),
  ('Listening Test 18: Information for Volunteers at Clifton Bird Park · Geology field trip to Iceland', 'test-18.html', 'site:practice/listening-pretest/test-18.html', '/practice/listening-pretest/test-18.html', 'text/html', 208074, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 18, false),
  ('Listening Test 19: Green Island Nature Park', 'test-19.html', 'site:practice/listening-pretest/test-19.html', '/practice/listening-pretest/test-19.html', 'text/html', 35736, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 19, false),
  ('Listening Test 20', 'test-20.html', 'site:practice/listening-pretest/test-20.html', '/practice/listening-pretest/test-20.html', 'text/html', 36330, 'upload', 'listening', null, 'Full Listening Tests · Tests 11–20', 20, false)
on conflict (storage_path) do update
  set title = excluded.title, url = excluded.url, collection = excluded.collection,
      position = excluded.position, size_bytes = excluded.size_bytes;

-- Check: 20 new tests, 0 old ones.
select
  count(*) filter (where url like '/practice/listening-pretest/%') as new_tests,
  count(*) filter (where url like '/practice/listening-full/%') as old_tests
from public.materials;
