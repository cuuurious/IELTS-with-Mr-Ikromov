-- migration_81_essay_comments.sql (2026-10-16)
-- 1. Comments on parts of a writing mock essay. A writing examiner (or
--    the teacher) highlights a stretch of the essay and leaves a comment
--    with a category (grammar, vocabulary, …). The essay text never
--    changes after it is handed in, so a comment is anchored by its
--    character offsets in task1_text / task2_text, plus the quoted words
--    as a safety copy.
-- 2. The teacher can change marks on writing mocks and speaking exams;
--    teacher_edited_by / teacher_edited_at record that it happened.
-- 3. Comments on a speaking exam, each tied to a moment in the recording
--    (seconds) and/or a part of the test (1, 2, 3).
-- Safe to run more than once.

create table if not exists public.writing_mock_comments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.writing_mock_attempts(id) on delete cascade,
  task smallint not null check (task in (1, 2)),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null,
  quote text not null,
  category text not null default 'other'
    check (category in ('grammar', 'vocabulary', 'spelling', 'coherence', 'task', 'good', 'other')),
  comment text not null default '',
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint writing_mock_comments_range check (end_offset > start_offset)
);

create index if not exists writing_mock_comments_attempt_idx
  on public.writing_mock_comments (attempt_id, task, start_offset);
create index if not exists writing_mock_comments_author_idx
  on public.writing_mock_comments (author_id);

create or replace function public.touch_writing_mock_comment()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_touch_writing_mock_comment on public.writing_mock_comments;
create trigger trg_touch_writing_mock_comment
  before update on public.writing_mock_comments
  for each row execute function public.touch_writing_mock_comment();

alter table public.writing_mock_comments enable row level security;

-- Staff (teacher, writing examiners) read and write every comment.
-- A student reads the comments on their own essay once the result has
-- been released — the same moment they see the band.
drop policy if exists writing_mock_comments_select on public.writing_mock_comments;
create policy writing_mock_comments_select on public.writing_mock_comments
  for select to authenticated
  using (
    (select public.is_teacher())
    or (select public.is_writing_examiner())
    or exists (
      select 1 from public.writing_mock_attempts a
       where a.id = writing_mock_comments.attempt_id
         and a.student_id = (select auth.uid())
         and a.released_at is not null
    )
  );

drop policy if exists writing_mock_comments_insert on public.writing_mock_comments;
create policy writing_mock_comments_insert on public.writing_mock_comments
  for insert to authenticated
  with check (
    ((select public.is_teacher()) or (select public.is_writing_examiner()))
    and author_id = (select auth.uid())
  );

drop policy if exists writing_mock_comments_update on public.writing_mock_comments;
create policy writing_mock_comments_update on public.writing_mock_comments
  for update to authenticated
  using ((select public.is_teacher()) or (select public.is_writing_examiner()))
  with check ((select public.is_teacher()) or (select public.is_writing_examiner()));

drop policy if exists writing_mock_comments_delete on public.writing_mock_comments;
create policy writing_mock_comments_delete on public.writing_mock_comments
  for delete to authenticated
  using ((select public.is_teacher()) or (select public.is_writing_examiner()));

grant select, insert, update, delete on public.writing_mock_comments to authenticated;

-- Teacher mark changes ------------------------------------------------
alter table public.writing_mock_attempts
  add column if not exists teacher_edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists teacher_edited_at timestamptz;

alter table public.mock_speaking_slots
  add column if not exists teacher_edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists teacher_edited_at timestamptz;

create index if not exists writing_mock_attempts_teacher_edited_by_idx
  on public.writing_mock_attempts (teacher_edited_by);
create index if not exists mock_speaking_slots_teacher_edited_by_idx
  on public.mock_speaking_slots (teacher_edited_by);

-- Students and examiners must not be able to set the "changed by the
-- teacher" stamp themselves. Same function as before, plus those two
-- columns in both checks.
create or replace function public.enforce_writing_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.exam_id is distinct from old.exam_id
     or new.student_id is distinct from old.student_id
     or new.started_at is distinct from old.started_at
     or new.deadline_at is distinct from old.deadline_at
     or new.paused_at is distinct from old.paused_at
     or new.teacher_edited_by is distinct from old.teacher_edited_by
     or new.teacher_edited_at is distinct from old.teacher_edited_at then
    raise exception 'writing_mock_attempts: exam_id/student_id/started_at/deadline/pause cannot be changed.';
  end if;

  if public.is_writing_examiner() then
    if new.task1_text is distinct from old.task1_text
       or new.task2_text is distinct from old.task2_text
       or new.tab_switch_count is distinct from old.tab_switch_count
       or new.auto_submitted is distinct from old.auto_submitted
       or new.submitted_at is distinct from old.submitted_at
       or new.released_at is distinct from old.released_at
       or new.released_by is distinct from old.released_by then
      raise exception 'writing_mock_attempts: examiners can only set the grading fields.';
    end if;
    return new;
  end if;

  if new.examiner_band is distinct from old.examiner_band
     or new.examiner_feedback is distinct from old.examiner_feedback
     or new.examiner_reviewed_by is distinct from old.examiner_reviewed_by
     or new.examiner_reviewed_at is distinct from old.examiner_reviewed_at
     or new.ta_band is distinct from old.ta_band
     or new.cc_band is distinct from old.cc_band
     or new.lr_band is distinct from old.lr_band
     or new.gra_band is distinct from old.gra_band
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by then
    raise exception 'writing_mock_attempts: students cannot set grading or release fields.';
  end if;

  if old.submitted_at is not null then
    raise exception 'writing_mock_attempts: this attempt has already been submitted.';
  end if;

  if new.submitted_at is not null and old.paused_at is not null then
    raise exception 'writing_mock_attempts: this test is paused by your teacher.';
  end if;

  -- Time is up (server clock, 2-minute grace): keep the essay as it was.
  if old.deadline_at is not null and old.paused_at is null
     and now() > old.deadline_at + interval '2 minutes' then
    new.task1_text := old.task1_text;
    new.task2_text := old.task2_text;
  end if;

  -- The server, not the browser, decides when it was submitted.
  if new.submitted_at is not null then
    new.submitted_at := now();
  end if;

  new.last_seen_at := now();
  return new;
end;
$function$;

-- Speaking examiners may not stamp a slot as teacher-edited either.
create or replace function public.enforce_speaking_teacher_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.is_teacher() then
    return new;
  end if;
  if new.teacher_edited_by is distinct from old.teacher_edited_by
     or new.teacher_edited_at is distinct from old.teacher_edited_at then
    raise exception 'mock_speaking_slots: only the teacher can mark a result as changed by the teacher.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_enforce_speaking_teacher_edit on public.mock_speaking_slots;
create trigger trg_enforce_speaking_teacher_edit
  before update on public.mock_speaking_slots
  for each row execute function public.enforce_speaking_teacher_edit();

-- 3. Speaking comments ----------------------------------------------
create table if not exists public.speaking_comments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.mock_speaking_slots(id) on delete cascade,
  part smallint check (part in (1, 2, 3)),
  at_seconds integer check (at_seconds >= 0),
  category text not null default 'other'
    check (category in ('fluency', 'vocabulary', 'grammar', 'pronunciation', 'good', 'other')),
  comment text not null default '',
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists speaking_comments_slot_idx
  on public.speaking_comments (slot_id, at_seconds);
create index if not exists speaking_comments_author_idx
  on public.speaking_comments (author_id);

drop trigger if exists trg_touch_speaking_comment on public.speaking_comments;
create trigger trg_touch_speaking_comment
  before update on public.speaking_comments
  for each row execute function public.touch_writing_mock_comment();

alter table public.speaking_comments enable row level security;

-- The teacher and the slot's own examiner read and write; the student
-- reads the comments on their own exam once it has been released.
drop policy if exists speaking_comments_select on public.speaking_comments;
create policy speaking_comments_select on public.speaking_comments
  for select to authenticated
  using (
    (select public.is_teacher())
    or exists (
      select 1 from public.mock_speaking_slots s
       where s.id = speaking_comments.slot_id
         and (
           s.examiner_id = (select auth.uid())
           or (s.student_id = (select auth.uid()) and s.released_at is not null)
         )
    )
  );

drop policy if exists speaking_comments_insert on public.speaking_comments;
create policy speaking_comments_insert on public.speaking_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (select public.is_teacher())
      or exists (
        select 1 from public.mock_speaking_slots s
         where s.id = speaking_comments.slot_id and s.examiner_id = (select auth.uid())
      )
    )
  );

drop policy if exists speaking_comments_update on public.speaking_comments;
create policy speaking_comments_update on public.speaking_comments
  for update to authenticated
  using (
    (select public.is_teacher())
    or exists (
      select 1 from public.mock_speaking_slots s
       where s.id = speaking_comments.slot_id and s.examiner_id = (select auth.uid())
    )
  );

drop policy if exists speaking_comments_delete on public.speaking_comments;
create policy speaking_comments_delete on public.speaking_comments
  for delete to authenticated
  using (
    (select public.is_teacher())
    or exists (
      select 1 from public.mock_speaking_slots s
       where s.id = speaking_comments.slot_id and s.examiner_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.speaking_comments to authenticated;

notify pgrst, 'reload schema';
