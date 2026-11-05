-- migration_97_bank_sets_topics_reports_favourites.sql (2026-11-05)
--
-- Practice Bank, part 3:
--   1. materials.topic — each reading passage tagged by topic (Science &
--      space, Nature & animals, History & archaeology …). Tagged here by
--      passage name; teachers can change a page's topic in the bank.
--   2. bank_sets — saved baskets of pages ("Week 3 TFNG pack").
--   3. book_practice.details — which questions a student got wrong when
--      practising on the shelf (homework keeps it in homework_attempts).
--   4. page_favourites — students star pages they enjoyed.
--   5. page_stats() now also returns how many students starred each page.
--   6. page_report(url) — every student's first try on one page, with the
--      questions they missed, for the per-page report.
-- Safe to run more than once.

-- 1. Topics ------------------------------------------------------------
alter table public.materials add column if not exists topic text;

update public.materials set topic = 'Science & space'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Radiocarbon dating', 'Theories of planet formation questioned', 'Life on Mars?', 'The Formation of Continents and the Evolution of Species', 'Incorrect Terminology in Science', 'The communication of science', 'Listening to the Ocean');
update public.materials set topic = 'Nature & animals'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Australia''s camouflaged creatures', 'Saving the Bittern', 'The return of the black-footed ferret', 'Australia''s Cane Toad Problem', 'New Understanding of Giraffes in the Wild', 'Health in the Wild', 'Bristlecone Pines', 'The Baobabs of Madagascar', 'Rights for apes', 'Ambergris – what is it and where does it come from?', 'Seaweed');
update public.materials set topic = 'Food & farming'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('The growth of agriculture', 'Farmers', 'Traditional Farming in Zambia''s Luapula Province', 'New perspectives on food production', 'Creating a Better Grapefruit', 'The History of the Chicken', 'The Impact of the Potato');
update public.materials set topic = 'History & archaeology'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Mungo Lady and Mungo Man', 'MAMMOTH KILL', 'The world''s first cities', 'Egypt''s ancient boat-builders', 'Ancient Rome: Archaeologists Are Trying to Understand More About the Early History of the City', 'Looking at daily life in ancient Rome', 'The mystery of Easter Island', 'The Peopling of Patagonia', 'The Antikythera Mechanism', 'The Voynich Manuscript', 'Coins – the first form of money', 'The Origin of Paper', 'The history of the pencil', 'A Brief History of Glassmaking', 'Child''s Play in Medieval England', 'Changes to the Soviet Union''s Working Week', 'Western Immigration of Canada', 'Tunnelling Under the Thames', 'Steam across the water');
update public.materials set topic = 'People & biographies'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Andrew Carnegie: industrialist and philanthropist', 'Antonio Stradivari – Violin Maker Supreme', 'The Life of Louis Braille', 'The life of Beatrix Potter', 'John Ray and the Study of Plants', 'Lawrence Johnston and Hidcote Garden', 'Sir Francis Ronalds 1788–1873', 'The Pixar Story');
update public.materials set topic = 'Psychology & mind'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('A Study of Introvert and Extrovert Characters', 'The Analysis of Fear', 'Blind to Change', 'IQ Scores', 'When the senses mix together', 'Conformity', 'Sorry — who are you?', 'The Purpose of Facial Expressions', 'Understanding Symbols', 'Looking for inspiration', 'Game Theory');
update public.materials set topic = 'Health & sleep'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Sleep – who needs it?', 'How sleep helps us learn', 'Why don''t we sleep?', 'Sleep Study on Modern-Day Hunter-Gatherers Dispels Popular Notions', 'Demystifying Yawning', 'New Technology in New Zealand''s Health Service', 'Optimism and Health', 'The Placebo Effect');
update public.materials set topic = 'Technology & buildings'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('The aerofoil', 'Computer games', 'The attraction of video games', 'A Mechanical Friend for Children', 'Art and engineering', 'Antarctic Architecture: Halley VI', 'Boring buildings', 'Ideal Homes', 'A new look for Talbot Park', 'Healthy Buildings, Productive People');
update public.materials set topic = 'Environment'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Solving the problem of waste disposal', 'How to clean a beach', 'Reducing exposure to indoor air pollution in developing countries', 'Petrol power: an eco-revolution?');
update public.materials set topic = 'Business & work'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('The Importance of Business Cards', 'Marketing and the information age', 'The Psychology of New Product Adoption', 'American businesses aim to support employees and their families', 'Born to trade');
update public.materials set topic = 'Education & language'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Practical Learning in the Classroom', 'The effectiveness of an online course', 'Starting school later has positive effects on teens', 'Literacy and Rural Communities in Australia', 'Translating: a key to international understanding?', 'Loss of Rare Languages', 'The History of the Celtic Language', 'Babies Cry in Their Mother Tongue');
update public.materials set topic = 'Arts & culture'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('Studies in the History of Art and Visual Culture', 'Photography', 'The Blockbuster Phenomenon: a new museum trend', 'Storytelling, from prehistoric caves to modern cinemas', 'Keeping the fun in funfairs', 'New Zealand home textile crafts of the 1930s to 1950s', 'The Origin and Development of Applause');
update public.materials set topic = 'Society & sport'
 where topic is null and skill = 'reading'
   and btrim(substr(title, strpos(title, ': ') + 2)) in ('The importance of law', 'What is an unfair advantage in sport?', 'The Origins of Tennis');

-- 2. Saved sets ----------------------------------------------------------
create table if not exists public.bank_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  material_ids uuid[] not null default '{}',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.bank_sets enable row level security;
drop policy if exists bank_sets_teacher on public.bank_sets;
create policy bank_sets_teacher on public.bank_sets
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

-- 3. Which questions were missed on the shelf ---------------------------
alter table public.book_practice add column if not exists details jsonb;

-- 4. Favourites ------------------------------------------------------------
create table if not exists public.page_favourites (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, material_id)
);
alter table public.page_favourites enable row level security;
drop policy if exists page_favourites_own on public.page_favourites;
create policy page_favourites_own on public.page_favourites
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists page_favourites_teacher_read on public.page_favourites;
create policy page_favourites_teacher_read on public.page_favourites
  for select using ((select public.is_teacher()));

-- 5. page_stats with favourites -----------------------------------------
drop function if exists public.page_stats();
create or replace function public.page_stats()
returns table(url text, tries integer, avg_pct integer, favs integer)
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
    ),
    s as (
      select f.url, count(*)::int as tries, round(avg(f.pct))::int as avg_pct from firsts f group by f.url
    ),
    fv as (
      select m.url, count(*)::int as favs
        from public.page_favourites pf join public.materials m on m.id = pf.material_id
       where m.url is not null group by m.url
    )
    select coalesce(s.url, fv.url), coalesce(s.tries, 0), s.avg_pct, coalesce(fv.favs, 0)
      from s full join fv on fv.url = s.url;
end;
$$;
revoke all on function public.page_stats() from public, anon;
grant execute on function public.page_stats() to authenticated;

-- 6. One page's report ---------------------------------------------------
create or replace function public.page_report(p_url text)
returns table(user_id uuid, full_name text, group_name text, source text, score integer, max_score integer, done_at timestamptz, qs jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can see page reports.';
  end if;
  return query
    select a.user_id, p.full_name, g.name, 'homework'::text, a.score, a.max_score, a.submitted_at, a.results -> 'qs'
      from public.homework_attempts a
      join public.homework_tasks t on t.id = a.task_id
      join public.homeworks h on h.id = t.homework_id
      left join public.groups g on g.id = h.group_id
      join public.profiles p on p.id = a.user_id
     where t.kind = 'html' and t.html_url = p_url
       and a.submitted_at is not null and a.attempt_no = 1
    union all
    select b.user_id, p.full_name, null::text, 'shelf'::text, b.score, b.max_score, b.created_at, b.details -> 'qs'
      from (
        select distinct on (bp.user_id) bp.*
          from public.book_practice bp
          join public.materials m on m.id = bp.material_id
         where m.url = p_url
         order by bp.user_id, bp.created_at
      ) b
      join public.profiles p on p.id = b.user_id
    order by 7 desc;
end;
$$;
revoke all on function public.page_report(text) from public, anon;
grant execute on function public.page_report(text) to authenticated;
