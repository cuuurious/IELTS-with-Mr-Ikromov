-- Migration 137: Grammar lives only in the Practice Bank (its own box in "Add tasks").
-- Removes the 30 Library copies and the "Grammar" Library folder made by migration 134.
delete from public.materials
 where collection is null
   and storage_path like 'site:practice/grammar/%';

delete from public.material_folders where name = 'Grammar';

-- Check: expect library_rows = 0, folders = 0, bank_rows = 30.
select
  (select count(*) from public.materials where collection is null and storage_path like 'site:practice/grammar/%') as library_rows,
  (select count(*) from public.material_folders where name = 'Grammar') as folders,
  (select count(*) from public.materials where collection like 'Grammar · %') as bank_rows;
