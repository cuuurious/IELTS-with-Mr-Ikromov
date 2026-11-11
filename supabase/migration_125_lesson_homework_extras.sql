-- migration_125_lesson_homework_extras.sql (2026-11-11)
-- Course homework that the teacher changed for one group before it was
-- posted (Group page → course → "Edit homework", saved in
-- group_lessons.override) can now carry extra files from the Materials
-- Library: post_group_lesson attaches them next to the slides.
-- Everything else in post_group_lesson is exactly as before.
-- Safe to run more than once.

set lock_timeout = '8s';

create or replace function public.post_group_lesson(p_group_lesson_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  gl public.group_lessons%rowtype;
  pl public.plan_lessons%rowtype;
  cp public.course_plans%rowtype;
  ov jsonb;
  v_due timestamptz;
  v_hw uuid;
  v_title text;
  v_text text;
  v_tasks jsonb;
  v_total integer;
  t jsonb;
  i integer := 0;
  v_secret text;
begin
  if not public.is_teacher() and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Teachers only.';
  end if;
  select * into gl from public.group_lessons where id = p_group_lesson_id for update;
  if gl.id is null then
    raise exception 'Lesson not found.';
  end if;
  if gl.homework_id is not null and not p_force then
    return gl.homework_id;
  end if;
  select * into pl from public.plan_lessons where plan_id = gl.plan_id and number = gl.number;
  select * into cp from public.course_plans where id = gl.plan_id;
  select count(*) into v_total from public.plan_lessons where plan_id = gl.plan_id;
  ov := coalesce(gl.override, '{}'::jsonb);

  v_title := coalesce(nullif(ov->>'homework_title', ''), nullif(pl.homework_title, ''), coalesce(ov->>'title', pl.title));
  v_text := coalesce(ov->>'homework_text', pl.homework_text, '');
  v_tasks := coalesce(ov->'tasks', pl.tasks, '[]'::jsonb);

  -- Nothing to post for this lesson.
  if coalesce(trim(v_title), '') = '' and coalesce(trim(v_text), '') = '' and jsonb_array_length(v_tasks) = 0
     and jsonb_array_length(case when jsonb_typeof(ov->'extra') = 'array' then ov->'extra' else '[]'::jsonb end) = 0 then
    update public.group_lessons set status = 'posted', posted_at = now() where id = gl.id;
    return null;
  end if;

  -- Due at the start of the next lesson (or two days later if none).
  select min(starts_at) into v_due from public.group_lessons
   where group_id = gl.group_id and starts_at > gl.starts_at and status = 'planned';
  v_due := coalesce(v_due, gl.ends_at + interval '2 days');

  insert into public.homeworks (
    group_id, title, description, created_by, due_date, homework_type,
    allowed_submission_types, min_submission_files, max_submission_files,
    enable_speaking, ai_eval_enabled, lesson_number, lesson_date, group_lesson_id
  ) values (
    gl.group_id,
    cp.title || ' · Lesson ' || gl.number || ': ' || coalesce(nullif(v_title, ''), 'Homework'),
    nullif(v_text, ''),
    cp.created_by,
    v_due,
    'standard',
    coalesce(pl.upload_types, array['image']::text[]),
    case when jsonb_array_length(v_tasks) > 0 then coalesce(pl.min_files, 0) else greatest(coalesce(pl.min_files, 1), 1) end,
    10,
    coalesce(pl.enable_speaking, false),
    coalesce(pl.ai_eval, false),
    gl.number,
    (gl.starts_at at time zone 'Asia/Tashkent')::date,
    gl.id
  ) returning id into v_hw;

  -- Slides go with the homework so a student who missed the lesson can study.
  if coalesce(ov->>'slides_url', pl.slides_url) is not null then
    insert into public.homework_attachments (homework_id, url, name, sort_order)
    values (v_hw, coalesce(ov->>'slides_url', pl.slides_url), coalesce(ov->>'slides_name', pl.slides_name, 'Lesson ' || gl.number || ' slides'), 0);
  end if;

  -- Extra files the teacher added for this group (2026-11-11).
  if jsonb_typeof(ov->'extra') = 'array' then
    insert into public.homework_attachments (homework_id, material_id, url, name, mime_type, size_bytes, sort_order)
    select v_hw,
           case when coalesce(x.e->>'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then (x.e->>'material_id')::uuid end,
           x.e->>'url',
           coalesce(nullif(x.e->>'name', ''), 'File'),
           nullif(x.e->>'mime_type', ''),
           case when coalesce(x.e->>'size_bytes', '') ~ '^[0-9]+$' then (x.e->>'size_bytes')::bigint end,
           x.ord::integer
      from jsonb_array_elements(ov->'extra') with ordinality as x(e, ord)
     where coalesce(x.e->>'url', '') <> '';
  end if;

  for t in select * from jsonb_array_elements(v_tasks) loop
    insert into public.homework_tasks (homework_id, position, kind, exam_id, wordlist_id, html_url, title, shadowing_clip_id)
    values (
      v_hw, i, t->>'kind',
      nullif(t->>'exam_id', '')::uuid,
      nullif(t->>'wordlist_id', '')::uuid,
      nullif(t->>'html_url', ''),
      nullif(t->>'title', ''),
      nullif(t->>'shadowing_clip_id', '')::uuid
    );
    -- A word list from the plan becomes this group's list too.
    if t->>'kind' = 'wordlist' and nullif(t->>'wordlist_id', '') is not null then
      insert into public.wordlist_groups (wordlist_id, group_id)
      select (t->>'wordlist_id')::uuid, gl.group_id
       where not exists (select 1 from public.wordlist_groups w where w.wordlist_id = (t->>'wordlist_id')::uuid and w.group_id = gl.group_id);
    end if;
    i := i + 1;
  end loop;

  update public.group_lessons set status = 'posted', posted_at = now(), homework_id = v_hw where id = gl.id;

  -- Tell the students (bell, phone, Telegram).
  insert into public.notifications (user_id, type, title, body, link)
  select gm.student_id, 'homework', 'New homework', cp.title || ' · Lesson ' || gl.number || ': ' || coalesce(nullif(v_title, ''), 'Homework'), '/app'
    from public.group_members gm
    join public.profiles p on p.id = gm.student_id and p.status = 'approved'
   where gm.group_id = gl.group_id;

  -- Post it in the group's Telegram chat too (if linked).
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_telegram_secret';
    if v_secret is not null then
      perform net.http_post(
        url := 'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/telegram-group-post',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
        body := jsonb_build_object('action', 'post', 'homework_id', v_hw),
        timeout_milliseconds := 10000
      );
    end if;
  exception when others then
    raise warning 'telegram-group-post call failed: %', sqlerrm;
  end;

  return v_hw;
end;
$function$;

notify pgrst, 'reload schema';

-- Check: expect true (the new version is in place).
select pg_get_functiondef('public.post_group_lesson'::regproc) like '%Extra files the teacher added%' as extras_ready;
