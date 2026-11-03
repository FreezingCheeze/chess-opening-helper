-- Opening Trainer
-- Paste this into the SQL editor of a free Supabase project.
-- Then, in Authentication → Providers → Email, turn off "Confirm email"
-- so you can sign in right away. No paid plan is required.

create table if not exists public.openings (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  my_color text not null check (my_color in ('white', 'black')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lines (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  opening_id uuid not null references public.openings (id) on delete cascade,
  group_name text not null default '',
  name text not null,
  pgn text not null,
  included boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.progress (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  opening_id uuid not null references public.openings (id) on delete cascade,
  position_key text not null,
  expected_san text not null,
  introduced boolean not null default false,
  needs_review boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, opening_id, position_key, expected_san)
);

create index if not exists lines_opening_idx on public.lines (opening_id, sort_order);
create index if not exists progress_opening_idx on public.progress (opening_id);

alter table public.openings enable row level security;
alter table public.lines enable row level security;
alter table public.progress enable row level security;

create policy "openings are private" on public.openings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "lines are private" on public.lines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "progress is private" on public.progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
