-- Migration 144: Shadowing Studio no. 20 (The Joker). Video file: shadowing bucket / 20_Joker.mp4
-- Safe to run more than once.
insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select 'Shadowing № 20 · The Joker (Film)', '20-joker.html', 'site:practice/shadowing/20-joker.html', '/practice/shadowing/20-joker.html', 'text/html', 30780, 'upload',
       'speaking', null, 'Shadowing Studio · Videos', 20, false, null
where not exists (select 1 from public.materials m where m.url = '/practice/shadowing/20-joker.html' and m.collection is not null);

notify pgrst, 'reload schema';

-- Check: expect shadowing_pages = 20 (19 after migration 143 + this one)
select count(*) as shadowing_pages from public.materials where url like '/practice/shadowing/%' and collection is not null;
