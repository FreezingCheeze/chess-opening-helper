create table if not exists public.branch_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  opening_id uuid not null references public.openings (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, opening_id)
);

alter table public.branch_prefs enable row level security;

drop policy if exists "branch prefs are private" on public.branch_prefs;
create policy "branch prefs are private" on public.branch_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
