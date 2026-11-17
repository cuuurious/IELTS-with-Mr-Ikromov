-- FRANKFURT MOVE — storage access rules (24 policies on storage.objects).
-- Updated 2026-11-17. Copied from the live Sydney project. Run on the NEW project
-- (SQL Editor) right after the files are copied. The database dump does NOT
-- carry these (they live in the storage schema), and without them students
-- could not upload or open files. Safe to run again.

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy "Avatar images are publicly accessible" on storage.objects as PERMISSIVE for SELECT to public using ((bucket_id = 'avatars'::text));
create policy "Users can delete their own avatar" on storage.objects as PERMISSIVE for DELETE to public using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "Users can update their own avatar" on storage.objects as PERMISSIVE for UPDATE to public using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "Users can upload their own avatar" on storage.objects as PERMISSIVE for INSERT to public with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy grading_criteria_storage_all_teacher on storage.objects as PERMISSIVE for ALL to public using (((bucket_id = 'grading-criteria'::text) AND is_teacher())) with check (((bucket_id = 'grading-criteria'::text) AND is_teacher()));
create policy group_chat_storage_delete on storage.objects as PERMISSIVE for DELETE to public using (((bucket_id = 'group-chat'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy group_chat_storage_insert on storage.objects as PERMISSIVE for INSERT to public with check (((bucket_id = 'group-chat'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy group_chat_storage_read on storage.objects as PERMISSIVE for SELECT to public using (((bucket_id = 'group-chat'::text) AND (auth.role() = 'authenticated'::text)));
create policy group_photos_delete_teacher on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'group-photos'::text) AND is_teacher()));
create policy group_photos_read_all on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'group-photos'::text));
create policy group_photos_update_teacher on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'group-photos'::text) AND is_teacher()));
create policy group_photos_write_teacher on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'group-photos'::text) AND is_teacher()));
create policy homework_storage_delete_teacher on storage.objects as PERMISSIVE for DELETE to public using (((bucket_id = 'homework-files'::text) AND is_teacher()));
create policy materials_storage_read on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'materials'::text));
create policy materials_storage_teacher_delete on storage.objects as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'materials'::text) AND ( SELECT is_teacher() AS is_teacher)));
create policy materials_storage_teacher_insert on storage.objects as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'materials'::text) AND ( SELECT is_teacher() AS is_teacher)));
create policy materials_storage_teacher_update on storage.objects as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'materials'::text) AND ( SELECT is_teacher() AS is_teacher)));
create policy mock_content_uploads_storage_all_teacher on storage.objects as PERMISSIVE for ALL to public using (((bucket_id = 'mock-content-uploads'::text) AND is_teacher())) with check (((bucket_id = 'mock-content-uploads'::text) AND is_teacher()));
create policy shop_photos_teacher on storage.objects as PERMISSIVE for ALL to public using (((bucket_id = 'shop'::text) AND is_teacher())) with check (((bucket_id = 'shop'::text) AND is_teacher()));
create policy storage_delete_own_folder on storage.objects as PERMISSIVE for DELETE to public using (((bucket_id = ANY (ARRAY['homework-files'::text, 'submissions'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy storage_insert_own_folder on storage.objects as PERMISSIVE for INSERT to public with check (((bucket_id = ANY (ARRAY['homework-files'::text, 'submissions'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy storage_read_all_authenticated on storage.objects as PERMISSIVE for SELECT to public using (((bucket_id = ANY (ARRAY['homework-files'::text, 'submissions'::text])) AND (auth.role() = 'authenticated'::text)));
create policy storage_update_own_folder on storage.objects as PERMISSIVE for UPDATE to public using (((bucket_id = ANY (ARRAY['homework-files'::text, 'submissions'::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy submissions_storage_delete_teacher on storage.objects as PERMISSIVE for DELETE to public using (((bucket_id = 'submissions'::text) AND is_teacher()));

-- Check: must return 24.
select count(*) as policies from pg_policies where schemaname = 'storage' and tablename = 'objects';
