-- migration_80_group_layouts.sql (2026-10-14)
-- Question groups can now carry what the official computer test shows
-- around the gaps:
--   body          — the notes / form / table text, with [[ ]] where each
--                   gap goes (filled by the group's questions in order)
--   image_url     — a map, plan or diagram picture
--   gap_positions — where each gap sits on that picture:
--                   {"<question id>": {"x": 12.5, "y": 40}} in % of the
--                   picture's width/height (top-left of the box)
-- Safe to run more than once.

alter table public.mock_question_groups
  add column if not exists body text,
  add column if not exists image_url text,
  add column if not exists gap_positions jsonb not null default '{}'::jsonb;

-- Students read groups only through this function, so it has to return
-- the new columns too. The return type changes, so drop and recreate.
drop function if exists public.get_mock_question_groups(uuid[]);
create function public.get_mock_question_groups(p_section_ids uuid[])
returns table(
  id uuid,
  section_id uuid,
  order_index integer,
  kind text,
  word_limit text,
  title text,
  instruction text,
  options_reusable boolean,
  body text,
  image_url text,
  gap_positions jsonb
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  return query
    select g.id, g.section_id, g.order_index, g.kind, g.word_limit, g.title, g.instruction,
           g.options_reusable, g.body, g.image_url, g.gap_positions
      from public.mock_question_groups g
      join public.mock_sections s on s.id = g.section_id
      join public.mock_exams e on e.id = s.exam_id
     where g.section_id = any(p_section_ids)
       and e.is_active
       and public.mock_exam_readable(e.id)
     order by g.section_id, g.order_index;
end;
$function$;
revoke all on function public.get_mock_question_groups(uuid[]) from public, anon;
grant execute on function public.get_mock_question_groups(uuid[]) to authenticated;

notify pgrst, 'reload schema';
