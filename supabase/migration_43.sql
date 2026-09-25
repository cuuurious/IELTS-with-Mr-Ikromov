-- ============================================================
-- Migration 43 — run this once in Supabase SQL Editor, after 29-42
--
-- Materials insertion, part 1: storage bucket for the "Import from
-- file" feature on the Reading/Listening content editor. A teacher
-- uploads a PDF, Word doc, or photo of a real question paper and the
-- new mock-content-import Edge Function reads it with OpenAI (same
-- OPENAI_API_KEY secret already set for ai-grading — nothing new to
-- configure) and hands back a structured draft of the passage/
-- transcript text plus a question list, which lands in the SAME
-- editable question builder the teacher already uses — nothing is
-- saved until the teacher reviews it and presses Save, exactly like
-- typing the questions in by hand. This is the "on hold, Jasur is
-- providing a separate spec" item from the phase plan (#10) — Jasur's
-- own explanation ("insert a pdf, word docx pic or any other file and
-- it has to build it to the mock environment") IS that spec, scoped
-- to the shape already designed and costed out earlier (single-digit
-- dollars total for a full 10-mock set): no tagging, no auto-save —
-- extract, then review, then save, same as the manual path.
--
-- Private bucket (not public) — same pattern as grading-criteria
-- (migration_16). Only a teacher can upload to it or have it read;
-- the Edge Function reads it with the service-role key and hands
-- OpenAI a short-lived signed URL, so the file is never public.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('mock-content-uploads', 'mock-content-uploads', false)
on conflict (id) do nothing;

drop policy if exists mock_content_uploads_storage_all_teacher on storage.objects;
create policy mock_content_uploads_storage_all_teacher
on storage.objects
for all
using ( bucket_id = 'mock-content-uploads' and public.is_teacher() )
with check ( bucket_id = 'mock-content-uploads' and public.is_teacher() );
