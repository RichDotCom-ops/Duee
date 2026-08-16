-- duee. — Supabase Schema
-- Run this once in your Supabase SQL Editor

-- Classes table
create table if not exists classes (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  name         text not null,
  professor    text default '',
  color        text default '#16a34a',
  icon         text default 'book-open',
  created_at   timestamptz default now()
);

-- Assignments table
create table if not exists assignments (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users(id) on delete cascade not null,
  class_id       uuid references classes(id) on delete set null,
  name           text not null,
  due_date       date not null,
  due_time       text default '23:59',
  priority       text default 'medium',
  estimated_time text default '1.5',
  notes          text default '',
  completed      boolean default false,
  created_at     timestamptz default now()
);

-- Row Level Security (users only see their own data)
alter table classes     enable row level security;
alter table assignments enable row level security;

create policy "own classes"     on classes     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own assignments" on assignments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
