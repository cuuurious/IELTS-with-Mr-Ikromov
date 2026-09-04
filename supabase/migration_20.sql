-- Adds an is_admin flag to profiles so exactly one teacher account (Jasur
-- Ikromov's own) can be marked as the site admin. Being a teacher already
-- lets an account manage groups, students, and homework — is_admin is a
-- narrower, separate power on top of that: only an is_admin account is
-- allowed to view and permanently delete OTHER teacher accounts. Every
-- other teacher account (including any created by mistake, or in the
-- future) defaults to is_admin = false and can never see or use that
-- ability.
alter table profiles
  add column if not exists is_admin boolean not null default false;

-- PostgREST (what Supabase's client library talks to) caches the
-- table schema and only notices new columns after being told to
-- reload it.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — run this yourself, separately, after the
-- migration above has been applied:
--
--   update profiles
--   set is_admin = true
--   where username = 'ikromovj';
--
-- Replace YOUR_LOGIN_USERNAME_HERE with the exact username you log in
-- with (all lowercase — that's how it's stored). This is deliberately
-- left as a manual step rather than guessed at automatically, since
-- getting the wrong account flagged as admin here would matter. Run it
-- once, from the Supabase SQL editor, against your own account only.
-- ---------------------------------------------------------------------
