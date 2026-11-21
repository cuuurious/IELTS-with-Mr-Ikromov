-- Migration 140: pay-and-receipt step when asking for a speaking session (2026-11-21).
-- The student pays to the examiner's card (migration 139), attaches a photo of
-- the receipt and sends the request. The examiner sees the receipt next to the
-- request before accepting. Run migration 135 and 139 first. Safe to run twice.

alter table public.speaking_slot_requests
  add column if not exists receipt_path text;

-- Private bucket for receipt photos.
insert into storage.buckets (id, name, public)
values ('speaking-receipts', 'speaking-receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'speaking-receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'speaking-receipts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_site_admin()
      or exists (
        select 1 from public.speaking_slot_requests r
        where r.receipt_path = storage.objects.name and r.examiner_id = auth.uid()
      )
    )
  );

-- The student attaches the uploaded receipt to her own request.
create or replace function public.attach_request_receipt(p_request uuid, p_path text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_path is null or p_path not like auth.uid()::text || '/%' then
    raise exception 'Invalid receipt file.';
  end if;
  update public.speaking_slot_requests
     set receipt_path = p_path
   where id = p_request
     and student_id = auth.uid()
     and status in ('pending', 'accepted');
  if not found then
    raise exception 'Request not found.';
  end if;
end;
$$;

grant execute on function public.attach_request_receipt(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- Check: expect column_found = 1, bucket_found = 1, function_found = 1
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'speaking_slot_requests' and column_name = 'receipt_path') as column_found,
  (select count(*) from storage.buckets where id = 'speaking-receipts') as bucket_found,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'attach_request_receipt') as function_found;
