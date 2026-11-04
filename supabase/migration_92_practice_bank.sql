-- migration_92_practice_bank.sql (2026-11-02)
--
-- Practice Bank: Mr Ikromov's interactive HTML pages (Reading and
-- Listening books, Writing Task 1 / Task 2 tests, workshops) live in their
-- own section of the site, not in the Materials Library. They are still
-- rows of `materials` (so homework tasks, the Books shelf, scores and weak
-- spots keep working) but carry a `collection` — the book or set they
-- belong to — and the Library hides them.
--
-- Also: Writing pages are allowed (homework-only: never on the shelf).
-- Safe to run more than once.

alter table public.materials
  add column if not exists collection text,
  add column if not exists position integer;

create index if not exists materials_collection_idx on public.materials (collection, position) where collection is not null;

alter table public.materials drop constraint if exists materials_skill_check;
alter table public.materials
  add constraint materials_skill_check check (skill is null or skill in ('reading', 'listening', 'writing', 'workshop'));

alter table public.materials drop constraint if exists materials_shelf_skill_check;
alter table public.materials
  add constraint materials_shelf_skill_check check (not on_shelf or skill in ('reading', 'listening'));
