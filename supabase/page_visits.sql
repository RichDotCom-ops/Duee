-- ── Page Visits Tracking ──
-- Run this in Supabase Dashboard → SQL Editor

create table if not exists page_visits (
  id         bigint generated always as identity primary key,
  page       text not null default '/',
  referrer   text,
  visitor_id text,
  visited_at timestamptz default now()
);

-- Add visitor_id column if table already exists (safe to run twice)
alter table page_visits add column if not exists visitor_id text;

-- Anonymous inserts allowed, no reading from client
alter table page_visits enable row level security;
create policy if not exists "anon_insert" on page_visits for insert to anon, authenticated with check (true);

-- Admin RPC — counts unique visitors (distinct visitor_id) + total page loads
create or replace function get_visit_stats()
returns json language sql security definer as $$
  select json_build_object(
    'total',        count(distinct visitor_id),
    'total_loads',  count(*),
    'today',        count(distinct visitor_id) filter (where visited_at >= current_date),
    'week',         count(distinct visitor_id) filter (where visited_at >= current_date - 7),
    'month',        count(distinct visitor_id) filter (where visited_at >= current_date - 30),
    'by_page', (
      select coalesce(json_object_agg(page, cnt), '{}'::json)
      from (
        select page, count(distinct visitor_id) as cnt
        from page_visits
        group by page
        order by cnt desc
        limit 8
      ) t
    )
  )
  from page_visits;
$$;
