-- migration_119_russian_fixes.sql (2026-11-09)
-- Corrections after spot-checking the automatic Russian translations
-- (word_ru). Each fixed row is marked checked = true so it is never
-- re-translated. Safe to run more than once.
update public.word_ru as w
set ru = v.ru, checked = true
from (values
  ('visual buzz',               'яркое визуальное впечатление'),
  ('centenary celebrations',    'празднование столетия'),
  ('a function of temperature', 'зависит от температуры'),
  ('bland',                     'пресный, невыразительный'),
  ('was fast-tracked',          'был ускорен'),
  ('adapted',                   'адаптированный, приспособленный'),
  ('cascade',                   'каскад'),
  ('positive spin-off',         'положительный побочный эффект'),
  ('cites',                     'ссылается на, приводит'),
  ('frame',                     'рамка, каркас')
) as v(word, ru)
where w.word = v.word;
