-- migration_75_fk_indexes.sql (2026-10-06)
-- Speed: an index on every foreign key that didn't have one (Supabase
-- performance advisor, "unindexed foreign keys"). Deleting or updating
-- a profile, exam, message, etc. no longer scans these tables in full.
-- Safe to run any time; nothing else changes.

create index if not exists full_mock_sets_created_by_idx on public.full_mock_sets (created_by);
create index if not exists full_mock_sets_listening_exam_id_idx on public.full_mock_sets (listening_exam_id);
create index if not exists full_mock_sets_reading_exam_id_idx on public.full_mock_sets (reading_exam_id);
create index if not exists full_mock_sets_writing_exam_id_idx on public.full_mock_sets (writing_exam_id);
create index if not exists grading_criteria_updated_by_idx on public.grading_criteria (updated_by);
create index if not exists group_admins_granted_by_idx on public.group_admins (granted_by);
create index if not exists group_message_actions_actor_id_idx on public.group_message_actions (actor_id);
create index if not exists group_message_actions_target_sender_id_idx on public.group_message_actions (target_sender_id);
create index if not exists group_message_pins_pinned_by_idx on public.group_message_pins (pinned_by);
create index if not exists group_messages_reply_to_id_idx on public.group_messages (reply_to_id);
create index if not exists groups_created_by_idx on public.groups (created_by);
create index if not exists homeworks_created_by_idx on public.homeworks (created_by);
create index if not exists material_folders_created_by_idx on public.material_folders (created_by);
create index if not exists material_inbox_state_folder_id_idx on public.material_inbox_state (folder_id);
create index if not exists materials_created_by_idx on public.materials (created_by);
create index if not exists message_pins_pinned_by_idx on public.message_pins (pinned_by);
create index if not exists messages_reply_to_id_idx on public.messages (reply_to_id);
create index if not exists mock_access_codes_created_by_idx on public.mock_access_codes (created_by);
create index if not exists mock_access_requests_decided_by_idx on public.mock_access_requests (decided_by);
create index if not exists mock_attempts_released_by_idx on public.mock_attempts (released_by);
create index if not exists mock_exams_created_by_idx on public.mock_exams (created_by);
create index if not exists mock_scheduled_sessions_created_by_idx on public.mock_scheduled_sessions (created_by);
create index if not exists mock_speaking_slots_released_by_idx on public.mock_speaking_slots (released_by);
create index if not exists submissions_examiner_reviewed_by_idx on public.submissions (examiner_reviewed_by);
create index if not exists telegram_link_tokens_user_id_idx on public.telegram_link_tokens (user_id);
create index if not exists topics_created_by_idx on public.topics (created_by);
create index if not exists wordlists_created_by_idx on public.wordlists (created_by);
create index if not exists writing_mock_attempts_examiner_reviewed_by_idx on public.writing_mock_attempts (examiner_reviewed_by);
create index if not exists writing_mock_attempts_released_by_idx on public.writing_mock_attempts (released_by);
create index if not exists writing_mock_exams_created_by_idx on public.writing_mock_exams (created_by);
