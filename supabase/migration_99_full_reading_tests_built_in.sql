-- migration_99_full_reading_tests_built_in.sql  (2026-11-05)
-- Mr Ikromov's 38 full Academic Reading tests (3 passages, 40 questions,
-- 60 minutes, with Workshops) are part of the website: pages live in
-- public/practice/reading-full/test-01.html … test-38.html. This adds them
-- to the Practice Bank under Reading, in four sets (Tests 1–10, 11–20,
-- 21–30, 31–38). No single question type, so they don't count towards the
-- weak-spot report. Safe to run twice. Needs migration 92 first.

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source,
   skill, question_type, collection, position, on_shelf, created_by)
select v.title, v.file_name, 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       'reading', null, v.collection, v.pos, false, null
from (values
  ('Test 1: Mungo Lady and Mungo Man · The attraction of video games · Blind to Change', 'test-01.html', '/practice/reading-full/test-01.html', 202899, 'Full Reading Tests · Tests 1–10', 1),
  ('Test 2: The world''s first cities · Australia''s camouflaged creatures · The effectiveness of an online course', 'test-02.html', '/practice/reading-full/test-02.html', 203045, 'Full Reading Tests · Tests 1–10', 2),
  ('Test 3: The growth of agriculture · The aerofoil · Looking for inspiration', 'test-03.html', '/practice/reading-full/test-03.html', 192058, 'Full Reading Tests · Tests 1–10', 3),
  ('Test 4: Radiocarbon dating · How sleep helps us learn · Petrol power: an eco-revolution?', 'test-04.html', '/practice/reading-full/test-04.html', 203312, 'Full Reading Tests · Tests 1–10', 4),
  ('Test 5: Studies in the History of Art and Visual Culture · Sleep – who needs it? · Looking at daily life in ancient Rome', 'test-05.html', '/practice/reading-full/test-05.html', 198403, 'Full Reading Tests · Tests 1–10', 5),
  ('Test 6: Ambergris – what is it and where does it come from? · Photography · The long view', 'test-06.html', '/practice/reading-full/test-06.html', 197535, 'Full Reading Tests · Tests 1–10', 6),
  ('Test 7: Computer games · Art and engineering · Evolutionary psychology', 'test-07.html', '/practice/reading-full/test-07.html', 201180, 'Full Reading Tests · Tests 1–10', 7),
  ('Test 8: The Origin of Paper · A new look for Talbot Park · The Analysis of Fear', 'test-08.html', '/practice/reading-full/test-08.html', 197548, 'Full Reading Tests · Tests 1–10', 8),
  ('Test 9: The Blockbuster Phenomenon: a new museum trend · Saving the Bittern · The Placebo Effect', 'test-09.html', '/practice/reading-full/test-09.html', 206748, 'Full Reading Tests · Tests 1–10', 9),
  ('Test 10: Sorry — who are you? · MAMMOTH KILL · Keeping the fun in funfairs', 'test-10.html', '/practice/reading-full/test-10.html', 191717, 'Full Reading Tests · Tests 1–10', 10),
  ('Test 11: The Importance of Business Cards · The importance of law · The Voynich Manuscript', 'test-11.html', '/practice/reading-full/test-11.html', 197885, 'Full Reading Tests · Tests 11–20', 11),
  ('Test 12: A survivor''s story · Ideal Homes · Conformity', 'test-12.html', '/practice/reading-full/test-12.html', 193917, 'Full Reading Tests · Tests 11–20', 12),
  ('Test 13: Listening to the Ocean · Boring buildings · Marketing and the information age', 'test-13.html', '/practice/reading-full/test-13.html', 204573, 'Full Reading Tests · Tests 11–20', 13),
  ('Test 14: The history of the pencil · What is an unfair advantage in sport? · Theories of planet formation questioned', 'test-14.html', '/practice/reading-full/test-14.html', 198784, 'Full Reading Tests · Tests 11–20', 14),
  ('Test 15: New perspectives on food production · Egypt''s ancient boat-builders · The communication of science', 'test-15.html', '/practice/reading-full/test-15.html', 200358, 'Full Reading Tests · Tests 11–20', 15),
  ('Test 16: Starting school later has positive effects on teens · Born to trade · New Zealand home textile crafts of the 1930s to 1950s', 'test-16.html', '/practice/reading-full/test-16.html', 203163, 'Full Reading Tests · Tests 11–20', 16),
  ('Test 17: Steam across the water · IQ Scores · Practical Learning in the Classroom', 'test-17.html', '/practice/reading-full/test-17.html', 199664, 'Full Reading Tests · Tests 11–20', 17),
  ('Test 18: Australia''s Cane Toad Problem · Farmers · Life on Mars?', 'test-18.html', '/practice/reading-full/test-18.html', 191247, 'Full Reading Tests · Tests 11–20', 18),
  ('Test 19: The History of the Chicken · A Study of Introvert and Extrovert Characters · When the senses mix together', 'test-19.html', '/practice/reading-full/test-19.html', 197043, 'Full Reading Tests · Tests 11–20', 19),
  ('Test 20: The Pixar Story · A Mechanical Friend for Children · The Peopling of Patagonia', 'test-20.html', '/practice/reading-full/test-20.html', 200119, 'Full Reading Tests · Tests 11–20', 20),
  ('Test 21: Western Immigration of Canada · Why don''t we sleep? · Understanding Symbols', 'test-21.html', '/practice/reading-full/test-21.html', 201541, 'Full Reading Tests · Tests 21–30', 21),
  ('Test 22: Optimism and Health · New Technology in New Zealand''s Health Service · Game Theory', 'test-22.html', '/practice/reading-full/test-22.html', 202563, 'Full Reading Tests · Tests 21–30', 22),
  ('Test 23: The Baobabs of Madagascar · Coins – the first form of money · Creating a Better Grapefruit', 'test-23.html', '/practice/reading-full/test-23.html', 199495, 'Full Reading Tests · Tests 21–30', 23),
  ('Test 24: Andrew Carnegie: industrialist and philanthropist · Translating: a key to international understanding? · The mystery of Easter Island', 'test-24.html', '/practice/reading-full/test-24.html', 199949, 'Full Reading Tests · Tests 21–30', 24),
  ('Test 25: New Understanding of Giraffes in the Wild · Healthy Buildings, Productive People · Child''s Play in Medieval England', 'test-25.html', '/practice/reading-full/test-25.html', 201044, 'Full Reading Tests · Tests 21–30', 25),
  ('Test 26: Traditional Farming in Zambia''s Luapula Province · Babies Cry in Their Mother Tongue · Ancient Rome: Archaeologists Are Trying to Understand More About the Early History of the City', 'test-26.html', '/practice/reading-full/test-26.html', 208089, 'Full Reading Tests · Tests 21–30', 26),
  ('Test 27: The Origins of Tennis · John Ray and the Study of Plants · Sir Francis Ronalds 1788–1873', 'test-27.html', '/practice/reading-full/test-27.html', 191366, 'Full Reading Tests · Tests 21–30', 27),
  ('Test 28: Health in the Wild · Speaking of Nothing · Changes to the Soviet Union''s Working Week', 'test-28.html', '/practice/reading-full/test-28.html', 200526, 'Full Reading Tests · Tests 21–30', 28),
  ('Test 29: Seaweed · The History of the Celtic Language · The Psychology of New Product Adoption', 'test-29.html', '/practice/reading-full/test-29.html', 202835, 'Full Reading Tests · Tests 21–30', 29),
  ('Test 30: The Formation of Continents and the Evolution of Species · Demystifying Yawning · Incorrect Terminology in Science', 'test-30.html', '/practice/reading-full/test-30.html', 204012, 'Full Reading Tests · Tests 21–30', 30),
  ('Test 31: A Brief History of Glassmaking · The return of the black-footed ferret · Rights for apes', 'test-31.html', '/practice/reading-full/test-31.html', 201488, 'Full Reading Tests · Tests 31–38', 31),
  ('Test 32: Sleep Study on Modern-Day Hunter-Gatherers Dispels Popular Notions · Bristlecone Pines · Loss of Rare Languages', 'test-32.html', '/practice/reading-full/test-32.html', 194693, 'Full Reading Tests · Tests 31–38', 32),
  ('Test 33: The Impact of the Potato · Solving the problem of waste disposal · How to clean a beach', 'test-33.html', '/practice/reading-full/test-33.html', 202192, 'Full Reading Tests · Tests 31–38', 33),
  ('Test 34: Tunnelling Under the Thames · The Origin and Development of Applause · The Antikythera Mechanism', 'test-34.html', '/practice/reading-full/test-34.html', 204600, 'Full Reading Tests · Tests 31–38', 34),
  ('Test 35: Antonio Stradivari – Violin Maker Supreme · Antarctic Architecture: Halley VI · Lawrence Johnston and Hidcote Garden', 'test-35.html', '/practice/reading-full/test-35.html', 201823, 'Full Reading Tests · Tests 31–38', 35),
  ('Test 36: Minds of their own · American businesses aim to support employees and their families · Literacy and Rural Communities in Australia', 'test-36.html', '/practice/reading-full/test-36.html', 198841, 'Full Reading Tests · Tests 31–38', 36),
  ('Test 37: The Life of Louis Braille · Storytelling, from prehistoric caves to modern cinemas · Reducing exposure to indoor air pollution in developing countries', 'test-37.html', '/practice/reading-full/test-37.html', 193773, 'Full Reading Tests · Tests 31–38', 37),
  ('Test 38: The life of Beatrix Potter · The Purpose of Facial Expressions · Let''s all be friends', 'test-38.html', '/practice/reading-full/test-38.html', 198543, 'Full Reading Tests · Tests 31–38', 38)
) as v(title, file_name, url, size, collection, pos)
where not exists (select 1 from public.materials m where m.url = v.url);
