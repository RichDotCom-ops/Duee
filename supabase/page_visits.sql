-- ── Page Visits Tracking ──
-- Run this in Supabase SQL Editor

create table if not exists page_visits (
  id         bigint generated always as identity primary key,
  page       text not null default '/',
  referrer   text,
  visited_at timestamptz default now()
);

-- Anonymous inserts allowed, no reading from client
alter table page_visits enable row level security;
create policy "anon_insert" on page_visits for insert to anon, authenticated with check (true);

-- Admin RPC — security definer so RLS is bypassed
create or replace function get_visit_stats()
returns json language sql security definer as $$
  select json_build_object(
    'total',   count(*),
    'today',   count(*) filter (where visited_at >= current_date),
    'week',    count(*) filter (where visited_at >= current_date - 7),
    'month',   count(*) filter (where visited_at >= current_date - 30),
    'by_page', (
      select coalesce(json_object_agg(page, cnt), '{}'::json)
      from (
        select page, count(*) as cnt
        from page_visits
        group by page
        order by cnt desc
        limit 8
      ) t
    )
  )
  from page_visits;
$$;
