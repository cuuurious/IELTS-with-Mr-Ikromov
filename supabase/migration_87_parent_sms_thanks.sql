-- migration_87_parent_sms_thanks.sql (2026-11-02)
--
-- Parent SMS: besides the missed-homework text, the teacher can now send
--   * a saved "thank you" text to the parents of students he picks, and
--   * a one-off text typed for that send only,
-- any time. The daily automatic missed-homework SMS is unchanged.
--
-- Safe to run more than once.

alter table public.parent_sms_settings
  add column if not exists thanks_template text not null
  default 'Assalomu alaykum! {student} bu hafta barcha uy vazifalarini o''z vaqtida topshirdi. Rahmat! Mr Ikromov';

alter table public.parent_sms_log drop constraint if exists parent_sms_log_kind_check;
alter table public.parent_sms_log
  add constraint parent_sms_log_kind_check check (kind in ('auto', 'manual', 'test', 'thanks', 'custom'));

notify pgrst, 'reload schema';
