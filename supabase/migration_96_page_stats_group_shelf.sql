-- migration_96_page_stats_group_shelf.sql (2026-11-05)
--
-- 1. page_stats(): for every Practice Bank page, how many first tries
--    there were and their average score (homework first tries plus the
--    students' own Books-shelf practice). Shown as "easy / medium / hard"
--    in the Practice Bank and the page picker. Teachers only.
-- 2. group_shelf: which sets each group sees on its students' practice
--    shelf. A group with no rows sees every set that is on the shelf (as
--    before); once a teacher picks sets for a group, it sees only those.
-- Safe to run more than once.

create or replace function public.page_stats()
returns table(url text, tries integer, avg_pct integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can see page statistics.';
  end if;
  return query
    with firsts as (
      select t.html_url as url, 100.0 * a.score / a.max_score as pct
        from public.homework_attempts a
        join public.homework_tasks t on t.id = a.task_id
       where t.kind = 'html' and t.html_url is not null
         and a.submitted_at is not null and a.attempt_no = 1
         and a.score is not null and a.max_score > 0
      union all
      select m.url, 100.0 * b.score / b.max_score
        from (
          select distinct on (bp.user_id, bp.material_id) bp.*
            from public.book_practice bp
           order by bp.user_id, bp.material_id, bp.created_at
        ) b
        join public.materials m on m.id = b.material_id
       where b.max_score > 0 and m.url is not null
    )
    select f.url, count(*)::int, round(avg(f.pct))::int
      from firsts f
     group by f.url;
end;
$$;
revoke all on function public.page_stats() from public, anon;
grant execute on function public.page_stats() to authenticated;

create table if not exists public.group_shelf (
  group_id uuid not null references public.groups(id) on delete cascade,
  collection text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, collection)
);
alter table public.group_shelf enable row level security;

drop policy if exists group_shelf_teacher on public.group_shelf;
create policy group_shelf_teacher on public.group_shelf
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

drop policy if exists group_shelf_member_read on public.group_shelf;
create policy group_shelf_member_read on public.group_shelf
  for select using (public.is_group_member(group_id));
