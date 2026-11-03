-- Seeded repertoire lines use stable readable IDs such as
-- "repertoire:caro:advance-1", so line IDs must accept text.
alter table public.lines
  alter column id type text using id::text;
