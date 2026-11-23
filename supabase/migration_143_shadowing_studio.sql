-- Migration 143: Shadowing Studio (19 video pages) in the Practice Bank + the public
-- "shadowing" storage bucket that holds the videos (2026-11-24).
-- Pages: public/practice/shadowing/NN-name.html. Each page streams its video from
--   <project>/storage/v1/object/public/shadowing/NN_Name.mp4
-- Upload the 19 mp4 files into the bucket after running this (Storage > shadowing > Upload).
-- Safe to run more than once.

set lock_timeout = '8s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shadowing', 'shadowing', true, 104857600, array['video/mp4'])
on conflict (id) do update set public = true, file_size_limit = 104857600, allowed_mime_types = array['video/mp4'];

insert into public.materials
  (title, file_name, storage_path, url, mime_type, size_bytes, source, skill, question_type, collection, position, on_shelf, created_by)
select v.title, substr(v.url, length(regexp_replace(v.url, '[^/]*$', '')) + 1), 'site:' || substr(v.url, 2), v.url, 'text/html', v.size, 'upload',
       v.skill, null, v.collection, v.n, false, null
from (values
  ('speaking', 'Shadowing Studio · Videos', 1, 'Shadowing № 01 · Zootopia (Film)', '/practice/shadowing/01-zootopia.html', 32877),
  ('speaking', 'Shadowing Studio · Videos', 2, 'Shadowing № 02 · Barack Obama (Speech)', '/practice/shadowing/02-obama.html', 31054),
  ('speaking', 'Shadowing Studio · Videos', 3, 'Shadowing № 03 · Zootopia 2 (Film)', '/practice/shadowing/03-zootopia2.html', 33120),
  ('speaking', 'Shadowing Studio · Videos', 4, 'Shadowing № 04 · Kung Fu Panda (Film)', '/practice/shadowing/04-kungfupanda.html', 33213),
  ('speaking', 'Shadowing Studio · Videos', 5, 'Shadowing № 05 · Madagascar (Film)', '/practice/shadowing/05-madagascar.html', 33980),
  ('speaking', 'Shadowing Studio · Videos', 6, 'Shadowing № 06 · Shrek (Film)', '/practice/shadowing/06-shrek.html', 32409),
  ('speaking', 'Shadowing Studio · Videos', 7, 'Shadowing № 07 · The Lion King (Film)', '/practice/shadowing/07-lionking.html', 33929),
  ('speaking', 'Shadowing Studio · Videos', 8, 'Shadowing № 08 · Tangled (Film)', '/practice/shadowing/08-tangled.html', 33408),
  ('speaking', 'Shadowing Studio · Videos', 9, 'Shadowing № 09 · Ratatouille (Film)', '/practice/shadowing/09-ratatouille.html', 33179),
  ('speaking', 'Shadowing Studio · Videos', 10, 'Shadowing № 10 · Frozen (Film)', '/practice/shadowing/10-frozen.html', 32960),
  ('speaking', 'Shadowing Studio · Videos', 11, 'Shadowing № 11 · Despicable Me (Film)', '/practice/shadowing/11-despicableme.html', 32601),
  ('speaking', 'Shadowing Studio · Videos', 12, 'Shadowing № 12 · Breaking Bad (TV series)', '/practice/shadowing/12-breakingbad.html', 33737),
  ('speaking', 'Shadowing Studio · Videos', 13, 'Shadowing № 13 · Suits (TV series)', '/practice/shadowing/13-suits.html', 35287),
  ('speaking', 'Shadowing Studio · Videos', 14, 'Shadowing № 14 · Friends (TV series)', '/practice/shadowing/14-friends3.html', 34433),
  ('speaking', 'Shadowing Studio · Videos', 15, 'Shadowing № 15 · Home Alone 2 (Film)', '/practice/shadowing/15-homealone2.html', 34529),
  ('speaking', 'Shadowing Studio · Videos', 16, 'Shadowing № 16 · Brad Pitt (Interview)', '/practice/shadowing/16-bradpitt.html', 31320),
  ('speaking', 'Shadowing Studio · Videos', 17, 'Shadowing № 17 · The Office (TV series)', '/practice/shadowing/17-theoffice.html', 33088),
  ('speaking', 'Shadowing Studio · Videos', 18, 'Shadowing № 18 · Michael B. Jordan (Speech)', '/practice/shadowing/18-michaelbjordan.html', 34257),
  ('speaking', 'Shadowing Studio · Videos', 19, 'Shadowing № 19 · Dwayne Johnson (Interview)', '/practice/shadowing/19-dwaynejohnson.html', 33377)
) as v(skill, collection, n, title, url, size)
where not exists (select 1 from public.materials m where m.url = v.url and m.collection is not null);

notify pgrst, 'reload schema';

-- Check: expect shadowing_pages = 19 and shadowing_bucket = 1
select
  (select count(*) from public.materials where url like '/practice/shadowing/%' and collection is not null) as shadowing_pages,
  (select count(*) from storage.buckets where id = 'shadowing') as shadowing_bucket;
