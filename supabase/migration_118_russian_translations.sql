-- migration_118_russian_translations.sql (2026-11-07)
-- Russian under every Uzbek translation (word lists, My words, reviews,
-- the dictionary pop-up, the Workshop word cards).
-- One shared dictionary: English word → Russian. It is filled by the
-- translate-ru function (AI, once per word); everyone signed in can read it.
-- Safe to run more than once.

set lock_timeout = '8s';

create table if not exists public.word_ru (
  word text primary key check (word = lower(word) and length(word) between 1 and 120),
  ru text not null check (length(ru) between 1 and 200),
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.word_ru enable row level security;

drop policy if exists word_ru_read on public.word_ru;
create policy word_ru_read on public.word_ru for select to authenticated using (true);

-- Teachers can correct a translation (they see it in the word lists).
drop policy if exists word_ru_teacher_fix on public.word_ru;
create policy word_ru_teacher_fix on public.word_ru for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

grant select, update on public.word_ru to authenticated;

notify pgrst, 'reload schema';

-- Check: expect true
select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'word_ru') as word_ru_ready;
