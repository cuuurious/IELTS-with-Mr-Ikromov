-- migration_135_examiner_booking.sql  (2026-11-18)
--
-- 1. One examiner account can be BOTH a speaking and a writing examiner.
--    The teacher ticks the skills in Staff accounts. (profiles.role stays
--    'speaking_examiner' when speaking is ticked, otherwise 'writing_examiner';
--    the ticked skills live in examiner_skills.)
-- 2. Speaking examiners open free time as small slots (e.g. 15:00, 15:15…).
--    Students see free and already-taken slots (no details about who),
--    request one, the examiner accepts or declines. Accepting creates the
--    normal row in the speaking timetable (mock_speaking_slots), so reminders,
--    marking, calendar file, and the Telegram/push alerts all keep working.
--    Rules: a student can hold ONE pending request or upcoming booking at a
--    time; a student can cancel up to 2 hours before the start.
--
-- Safe to run more than once. Needs migration 29 (examiner roles + slots).

set lock_timeout = '8s';

-- ---------- 1. Dual-role examiners ----------
create table if not exists public.examiner_skills (
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill   text not null check (skill in ('speaking', 'writing')),
  primary key (user_id, skill)
);

alter table public.examiner_skills enable row level security;

drop policy if exists "examiner_skills_select" on public.examiner_skills;
create policy "examiner_skills_select" on public.examiner_skills
  for select using (auth.uid() is not null);
-- no insert/update/delete policies: only set_examiner_roles() (teacher) writes.

insert into public.examiner_skills (user_id, skill)
select id, case role when 'speaking_examiner' then 'speaking' else 'writing' end
  from public.profiles
 where role in ('speaking_examiner', 'writing_examiner')
on conflict do nothing;

create or replace function public.is_speaking_examiner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'speaking_examiner'
            or (p.role = 'writing_examiner'
                and exists (select 1 from public.examiner_skills s where s.user_id = p.id and s.skill = 'speaking')))
  );
$$;

create or replace function public.is_writing_examiner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'writing_examiner'
            or (p.role = 'speaking_examiner'
                and exists (select 1 from public.examiner_skills s where s.user_id = p.id and s.skill = 'writing')))
  );
$$;

-- Teacher-only: choose which examiner skills an account has.
create or replace function public.set_examiner_roles(p_user uuid, p_speaking boolean, p_writing boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can change examiner roles.';
  end if;
  if not coalesce(p_speaking, false) and not coalesce(p_writing, false) then
    raise exception 'Pick at least one: speaking or writing.';
  end if;

  select role into v_role from public.profiles where id = p_user;
  if v_role is null or v_role not in ('speaking_examiner', 'writing_examiner') then
    raise exception 'This account is not an examiner account.';
  end if;

  update public.profiles
     set role = case when p_speaking then 'speaking_examiner' else 'writing_examiner' end
   where id = p_user;

  delete from public.examiner_skills where user_id = p_user;
  if p_speaking then insert into public.examiner_skills (user_id, skill) values (p_user, 'speaking'); end if;
  if p_writing  then insert into public.examiner_skills (user_id, skill) values (p_user, 'writing');  end if;
end;
$$;

grant execute on function public.set_examiner_roles(uuid, boolean, boolean) to authenticated;

-- ---------- 2. Open slots + requests ----------
create table if not exists public.speaking_open_slots (
  id uuid primary key default gen_random_uuid(),
  examiner_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes int not null default 15 check (duration_minutes between 5 and 60),
  status text not null default 'open' check (status in ('open', 'booked')),
  booked_slot_id uuid references public.mock_speaking_slots(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (examiner_id, starts_at)
);

create index if not exists speaking_open_slots_time_idx on public.speaking_open_slots (starts_at);

alter table public.speaking_open_slots enable row level security;

-- Everyone signed in can see which slots are free or taken (no names, no details).
drop policy if exists "open_slots_select" on public.speaking_open_slots;
create policy "open_slots_select" on public.speaking_open_slots
  for select using (auth.uid() is not null);

drop policy if exists "open_slots_insert" on public.speaking_open_slots;
create policy "open_slots_insert" on public.speaking_open_slots
  for insert with check (
    examiner_id = auth.uid() and public.is_speaking_examiner() and status = 'open'
  );

drop policy if exists "open_slots_delete" on public.speaking_open_slots;
create policy "open_slots_delete" on public.speaking_open_slots
  for delete using (
    (examiner_id = auth.uid() and status = 'open') or public.is_teacher()
  );

create table if not exists public.speaking_slot_requests (
  id uuid primary key default gen_random_uuid(),
  open_slot_id uuid not null references public.speaking_open_slots(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  examiner_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- one pending request per student at a time
create unique index if not exists speaking_requests_one_pending
  on public.speaking_slot_requests (student_id) where status = 'pending';
create index if not exists speaking_requests_examiner_idx on public.speaking_slot_requests (examiner_id, status);
create index if not exists speaking_requests_slot_idx on public.speaking_slot_requests (open_slot_id);

alter table public.speaking_slot_requests enable row level security;

drop policy if exists "slot_requests_select" on public.speaking_slot_requests;
create policy "slot_requests_select" on public.speaking_slot_requests
  for select using (student_id = auth.uid() or examiner_id = auth.uid() or public.is_teacher());
-- writes only through the functions below.

do $$ begin
  begin alter publication supabase_realtime add table public.speaking_open_slots; exception when others then null; end;
  begin alter publication supabase_realtime add table public.speaking_slot_requests; exception when others then null; end;
end $$;

-- ---------- 3. Keeping slots in step with the timetable ----------
-- A session put on the timetable (by accepting a request OR by the examiner
-- booking a student directly) closes any open slot it overlaps.
create or replace function public.close_overlapping_open_slots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'scheduled' then
    update public.speaking_open_slots o
       set status = 'booked', booked_slot_id = new.id
     where o.examiner_id = new.examiner_id
       and o.status = 'open'
       and tstzrange(o.starts_at, o.starts_at + o.duration_minutes * interval '1 minute')
           && tstzrange(new.scheduled_at, new.scheduled_at + new.duration_minutes * interval '1 minute');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_close_open_slots on public.mock_speaking_slots;
create trigger trg_close_open_slots
  after insert on public.mock_speaking_slots
  for each row execute function public.close_overlapping_open_slots();

-- A cancelled or deleted session frees its slot again (and closes the request).
create or replace function public.reopen_slot_after_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_student uuid;
  v_when timestamptz;
begin
  if tg_op = 'DELETE' then
    v_id := old.id; v_student := old.student_id; v_when := old.scheduled_at;
  else
    if not (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
      return new;
    end if;
    v_id := new.id; v_student := new.student_id; v_when := new.scheduled_at;
  end if;

  update public.speaking_slot_requests r
     set status = 'cancelled', responded_at = now()
   where r.status = 'accepted'
     and r.open_slot_id in (select id from public.speaking_open_slots where booked_slot_id = v_id);

  update public.speaking_open_slots
     set status = case when v_when > now() then 'open' else 'booked' end,
         booked_slot_id = case when v_when > now() then null else booked_slot_id end
   where booked_slot_id = v_id;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists trg_reopen_slot_cancel on public.mock_speaking_slots;
create trigger trg_reopen_slot_cancel
  after update on public.mock_speaking_slots
  for each row execute function public.reopen_slot_after_cancel();

drop trigger if exists trg_reopen_slot_delete on public.mock_speaking_slots;
create trigger trg_reopen_slot_delete
  before delete on public.mock_speaking_slots
  for each row execute function public.reopen_slot_after_cancel();

-- If an examiner removes a free slot that students asked for, tell them.
create or replace function public.notify_open_slot_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select r.student_id, 'speaking_request', 'Speaking slot removed',
         'The examiner removed the slot you asked for (' || to_char(old.starts_at, 'FMDD Mon, HH24:MI') || '). Please pick another one.',
         '/app'
    from public.speaking_slot_requests r
   where r.open_slot_id = old.id and r.status = 'pending';
  return old;
end;
$$;

drop trigger if exists trg_notify_open_slot_removed on public.speaking_open_slots;
create trigger trg_notify_open_slot_removed
  before delete on public.speaking_open_slots
  for each row execute function public.notify_open_slot_removed();

-- ---------- 4. Requests: student asks, examiner answers ----------
create or replace function public.request_speaking_slot(p_open_slot uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_slot public.speaking_open_slots%rowtype;
  v_id uuid;
  v_name text;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and role = 'student' and status = 'approved') then
    raise exception 'Only students can request a speaking session.';
  end if;

  select * into v_slot from public.speaking_open_slots where id = p_open_slot for update;
  if not found then raise exception 'That slot no longer exists.'; end if;
  if v_slot.status <> 'open' then raise exception 'That slot has just been taken. Please pick another.'; end if;
  if v_slot.starts_at < now() + interval '30 minutes' then
    raise exception 'That slot starts too soon. Please pick a later one.';
  end if;

  if exists (select 1 from public.speaking_slot_requests where student_id = v_me and status = 'pending') then
    raise exception 'You already have a request waiting for an answer. Cancel it first or wait for the examiner.';
  end if;
  if exists (select 1 from public.mock_speaking_slots
              where student_id = v_me and status = 'scheduled' and scheduled_at > now()) then
    raise exception 'You already have an upcoming speaking session. Cancel it first to book another.';
  end if;

  insert into public.speaking_slot_requests (open_slot_id, student_id, examiner_id, note)
  values (p_open_slot, v_me, v_slot.examiner_id, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  select coalesce(full_name, username) into v_name from public.profiles where id = v_me;
  insert into public.notifications (user_id, type, title, body, link)
  values (v_slot.examiner_id, 'speaking_request', 'New speaking session request',
          coalesce(v_name, 'A student') || ' asked for ' || to_char(v_slot.starts_at, 'FMDD Mon, HH24:MI') || '.',
          '/app');
  return v_id;
end;
$$;

create or replace function public.respond_speaking_request(p_request uuid, p_accept boolean, p_meeting_link text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_req public.speaking_slot_requests%rowtype;
  v_slot public.speaking_open_slots%rowtype;
  v_new uuid;
  v_other record;
begin
  select * into v_req from public.speaking_slot_requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  if v_req.examiner_id <> v_me and not public.is_teacher() then
    raise exception 'This request is not yours to answer.';
  end if;
  if v_req.status <> 'pending' then raise exception 'This request has already been answered or cancelled.'; end if;

  select * into v_slot from public.speaking_open_slots where id = v_req.open_slot_id for update;

  if not p_accept then
    update public.speaking_slot_requests set status = 'declined', responded_at = now() where id = p_request;
    insert into public.notifications (user_id, type, title, body, link)
    values (v_req.student_id, 'speaking_request', 'Speaking request declined',
            'The examiner could not take ' || to_char(v_slot.starts_at, 'FMDD Mon, HH24:MI') || '. Please pick another time.',
            '/app');
    return null;
  end if;

  if v_slot.status <> 'open' then
    raise exception 'That slot is no longer free.';
  end if;
  if exists (
    select 1 from public.mock_speaking_slots s
     where s.examiner_id = v_req.examiner_id and s.status = 'scheduled'
       and tstzrange(s.scheduled_at, s.scheduled_at + s.duration_minutes * interval '1 minute')
           && tstzrange(v_slot.starts_at, v_slot.starts_at + v_slot.duration_minutes * interval '1 minute')
  ) then
    raise exception 'You already have a session at that time.';
  end if;

  -- the normal timetable row (this also fires the student's "scheduled" notification)
  insert into public.mock_speaking_slots (student_id, examiner_id, scheduled_at, duration_minutes, meeting_link, status)
  values (v_req.student_id, v_req.examiner_id, v_slot.starts_at, v_slot.duration_minutes,
          nullif(btrim(coalesce(p_meeting_link, '')), ''), 'scheduled')
  returning id into v_new;

  update public.speaking_open_slots set status = 'booked', booked_slot_id = v_new where id = v_slot.id;
  update public.speaking_slot_requests set status = 'accepted', responded_at = now() where id = p_request;

  -- anyone else who asked for the same slot gets a polite no
  for v_other in
    select id, student_id from public.speaking_slot_requests
     where open_slot_id = v_slot.id and status = 'pending' and id <> p_request
  loop
    update public.speaking_slot_requests set status = 'declined', responded_at = now() where id = v_other.id;
    insert into public.notifications (user_id, type, title, body, link)
    values (v_other.student_id, 'speaking_request', 'Speaking slot taken',
            'The slot at ' || to_char(v_slot.starts_at, 'FMDD Mon, HH24:MI') || ' was given to someone else. Please pick another time.',
            '/app');
  end loop;

  return v_new;
end;
$$;

create or replace function public.cancel_speaking_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_req public.speaking_slot_requests%rowtype;
  v_slot public.speaking_open_slots%rowtype;
  v_name text;
begin
  select * into v_req from public.speaking_slot_requests where id = p_request for update;
  if not found or v_req.student_id <> v_me then raise exception 'Request not found.'; end if;
  select * into v_slot from public.speaking_open_slots where id = v_req.open_slot_id;

  if v_req.status = 'pending' then
    update public.speaking_slot_requests set status = 'cancelled', responded_at = now() where id = p_request;
  elsif v_req.status = 'accepted' then
    if v_slot.starts_at - now() < interval '2 hours' then
      raise exception 'It is less than 2 hours before the session. Please message your examiner to cancel.';
    end if;
    -- the trigger on mock_speaking_slots reopens the slot and closes the request
    update public.mock_speaking_slots set status = 'cancelled'
     where id = v_slot.booked_slot_id and status = 'scheduled';
    update public.speaking_slot_requests set status = 'cancelled', responded_at = now() where id = p_request;
  else
    raise exception 'This request is already closed.';
  end if;

  select coalesce(full_name, username) into v_name from public.profiles where id = v_me;
  insert into public.notifications (user_id, type, title, body, link)
  values (v_req.examiner_id, 'speaking_request', 'Speaking session cancelled',
          coalesce(v_name, 'A student') || ' cancelled ' || to_char(v_slot.starts_at, 'FMDD Mon, HH24:MI') || '.',
          '/app');
end;
$$;

grant execute on function public.request_speaking_slot(uuid, text) to authenticated;
grant execute on function public.respond_speaking_request(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_speaking_request(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Check: expect tables = 3, functions = 4
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('examiner_skills', 'speaking_open_slots', 'speaking_slot_requests')) as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_examiner_roles', 'request_speaking_slot', 'respond_speaking_request', 'cancel_speaking_request')) as functions;
