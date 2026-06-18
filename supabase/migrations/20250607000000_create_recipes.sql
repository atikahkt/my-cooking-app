create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  description text not null default '',
  thumbnail text not null default '',
  source_url text not null,
  created_at timestamptz not null default now()
);

alter table recipes enable row level security;

create policy "Allow public read on recipes"
  on recipes
  for select
  using (true);

create policy "Allow public insert on recipes"
  on recipes
  for insert
  with check (true);
