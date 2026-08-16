-- ============================================================
-- duee. — Full Admin SQL
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================


-- ============================================================
-- TABLES
-- ============================================================

-- Stores every payment from LemonSqueezy webhooks
CREATE TABLE IF NOT EXISTS payments (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email           text,
  plan            text NOT NULL,          -- 'pro' | 'annual'
  amount_cents    integer NOT NULL,       -- e.g. 599 = $5.99
  currency        text DEFAULT 'USD',
  status          text DEFAULT 'paid',    -- 'paid' | 'refunded' | 'failed'
  ls_order_id     text UNIQUE,            -- LemonSqueezy order ID
  ls_variant_id   text,
  created_at      timestamptz DEFAULT now()
);

-- Stores current plan per user (synced from LemonSqueezy webhook)
CREATE TABLE IF NOT EXISTS user_plans (
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  plan            text DEFAULT 'free',    -- 'free' | 'pro' | 'annual'
  started_at      timestamptz DEFAULT now(),
  expires_at      timestamptz,
  ls_customer_id  text,
  ls_subscription_id text,
  updated_at      timestamptz DEFAULT now()
);

-- Row level security
ALTER TABLE payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;

-- Only service role (webhooks) can write; admin reads via SECURITY DEFINER functions
CREATE POLICY "No direct access" ON payments   FOR ALL USING (false);
CREATE POLICY "No direct access" ON user_plans FOR ALL USING (false);


-- ============================================================
-- USER FUNCTIONS
-- ============================================================

-- Total number of signed-up users
CREATE OR REPLACE FUNCTION get_total_users()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::integer FROM auth.users;
$$;

-- New signups per day (last N days)
CREATE OR REPLACE FUNCTION get_signups_by_day(days_back integer DEFAULT 14)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.date), '[]'::json)
  FROM (
    SELECT
      DATE(created_at)                   AS date,
      COUNT(*)::integer                  AS count,
      SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) AS cumulative
    FROM auth.users
    WHERE created_at >= NOW() - (days_back || ' days')::interval
    GROUP BY DATE(created_at)
    ORDER BY date
  ) t;
$$;

-- Full user list with plan + usage stats
CREATE OR REPLACE FUNCTION get_user_list(lim integer DEFAULT 50)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.joined DESC), '[]'::json)
  FROM (
    SELECT
      u.id,
      u.email,
      u.created_at                                        AS joined,
      u.last_sign_in_at                                   AS last_seen,
      COALESCE(up.plan, 'free')                           AS plan,
      up.expires_at,
      COUNT(DISTINCT a.id)::integer                       AS assignment_count,
      COUNT(DISTINCT c.id)::integer                       AS class_count,
      COUNT(DISTINCT a.id) FILTER (WHERE a.completed)::integer AS completed_count
    FROM auth.users u
    LEFT JOIN user_plans   up ON up.user_id = u.id
    LEFT JOIN assignments  a  ON a.user_id  = u.id
    LEFT JOIN classes      c  ON c.user_id  = u.id
    GROUP BY u.id, u.email, u.created_at, u.last_sign_in_at, up.plan, up.expires_at
    ORDER BY u.created_at DESC
    LIMIT lim
  ) t;
$$;

-- Users active in last N days (signed in or created data)
CREATE OR REPLACE FUNCTION get_active_users(days_back integer DEFAULT 7)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(DISTINCT u.id)::integer
  FROM auth.users u
  WHERE u.last_sign_in_at >= NOW() - (days_back || ' days')::interval
     OR EXISTS (
       SELECT 1 FROM assignments a
       WHERE a.user_id = u.id
         AND a.created_at >= NOW() - (days_back || ' days')::interval
     );
$$;


-- ============================================================
-- APP USAGE FUNCTIONS
-- ============================================================

-- Assignment overview across all users
CREATE OR REPLACE FUNCTION get_assignment_stats()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'total',     COUNT(*)::integer,
    'completed', COUNT(*) FILTER (WHERE completed)::integer,
    'pending',   COUNT(*) FILTER (WHERE NOT completed)::integer,
    'overdue',   COUNT(*) FILTER (WHERE NOT completed AND due_date < CURRENT_DATE)::integer,
    'today',     COUNT(*) FILTER (WHERE due_date = CURRENT_DATE)::integer,
    'high',      COUNT(*) FILTER (WHERE priority = 'high')::integer,
    'medium',    COUNT(*) FILTER (WHERE priority = 'medium')::integer,
    'low',       COUNT(*) FILTER (WHERE priority = 'low')::integer,
    'this_week', COUNT(*) FILTER (WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::integer
  )
  FROM assignments;
$$;

-- Assignments created per day (last N days)
CREATE OR REPLACE FUNCTION get_assignments_by_day(days_back integer DEFAULT 14)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.date), '[]'::json)
  FROM (
    SELECT
      DATE(created_at) AS date,
      COUNT(*)::integer AS count
    FROM assignments
    WHERE created_at >= NOW() - (days_back || ' days')::interval
    GROUP BY DATE(created_at)
    ORDER BY date
  ) t;
$$;

-- Class stats across all users
CREATE OR REPLACE FUNCTION get_class_stats()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'total', COUNT(*)::integer,
    'with_assignments', COUNT(DISTINCT c.id) FILTER (
      WHERE EXISTS (SELECT 1 FROM assignments a WHERE a.class_id = c.id)
    )::integer,
    'unique_names', COUNT(DISTINCT LOWER(c.name))::integer
  )
  FROM classes c;
$$;


-- ============================================================
-- PAYMENT / REVENUE FUNCTIONS
-- ============================================================

-- Overall revenue summary
CREATE OR REPLACE FUNCTION get_revenue_stats()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    -- All time
    'total_revenue_cents',  COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::integer,
    'total_payments',       COUNT(*) FILTER (WHERE status = 'paid')::integer,
    'total_refunds',        COUNT(*) FILTER (WHERE status = 'refunded')::integer,
    'refunded_cents',       COALESCE(SUM(amount_cents) FILTER (WHERE status = 'refunded'), 0)::integer,

    -- This month
    'this_month_cents',     COALESCE(SUM(amount_cents) FILTER (
                              WHERE status = 'paid'
                                AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
                            ), 0)::integer,
    'this_month_payments',  COUNT(*) FILTER (
                              WHERE status = 'paid'
                                AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
                            )::integer,

    -- Last month
    'last_month_cents',     COALESCE(SUM(amount_cents) FILTER (
                              WHERE status = 'paid'
                                AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
                            ), 0)::integer,

    -- Today
    'today_cents',          COALESCE(SUM(amount_cents) FILTER (
                              WHERE status = 'paid' AND DATE(created_at) = CURRENT_DATE
                            ), 0)::integer,

    -- Plan breakdown
    'pro_count',            COUNT(*) FILTER (WHERE plan = 'pro'    AND status = 'paid')::integer,
    'annual_count',         COUNT(*) FILTER (WHERE plan = 'annual' AND status = 'paid')::integer,

    -- Active subscribers right now
    'active_pro',           (SELECT COUNT(*)::integer FROM user_plans WHERE plan = 'pro'    AND (expires_at IS NULL OR expires_at > NOW())),
    'active_annual',        (SELECT COUNT(*)::integer FROM user_plans WHERE plan = 'annual' AND (expires_at IS NULL OR expires_at > NOW()))
  )
  FROM payments;
$$;

-- Revenue per day (for chart)
CREATE OR REPLACE FUNCTION get_revenue_by_day(days_back integer DEFAULT 30)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.date), '[]'::json)
  FROM (
    SELECT
      DATE(created_at)                    AS date,
      SUM(amount_cents)::integer          AS revenue_cents,
      COUNT(*)::integer                   AS payment_count
    FROM payments
    WHERE status = 'paid'
      AND created_at >= NOW() - (days_back || ' days')::interval
    GROUP BY DATE(created_at)
    ORDER BY date
  ) t;
$$;

-- Monthly Recurring Revenue (MRR) estimate
CREATE OR REPLACE FUNCTION get_mrr_cents()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE
      WHEN plan = 'pro'    THEN 599          -- $5.99/mo
      WHEN plan = 'annual' THEN 341          -- $40.99/yr ÷ 12 ≈ $3.41/mo
      ELSE 0
    END)::integer,
  0)
  FROM user_plans
  WHERE expires_at IS NULL OR expires_at > NOW();
$$;

-- Recent payments list
CREATE OR REPLACE FUNCTION get_recent_payments(lim integer DEFAULT 20)
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      p.id,
      p.email,
      p.plan,
      p.amount_cents,
      p.currency,
      p.status,
      p.ls_order_id,
      p.created_at,
      u.id AS user_id
    FROM payments p
    LEFT JOIN auth.users u ON u.email = p.email
    ORDER BY p.created_at DESC
    LIMIT lim
  ) t;
$$;

-- All active Pro/Annual subscribers
CREATE OR REPLACE FUNCTION get_active_subscribers()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.started_at DESC), '[]'::json)
  FROM (
    SELECT
      up.user_id,
      u.email,
      up.plan,
      up.started_at,
      up.expires_at,
      up.ls_subscription_id,
      COUNT(DISTINCT a.id)::integer AS assignments,
      COUNT(DISTINCT c.id)::integer AS classes
    FROM user_plans up
    JOIN  auth.users u  ON u.id  = up.user_id
    LEFT JOIN assignments a ON a.user_id = up.user_id
    LEFT JOIN classes     c ON c.user_id = up.user_id
    WHERE up.plan != 'free'
      AND (up.expires_at IS NULL OR up.expires_at > NOW())
    GROUP BY up.user_id, u.email, up.plan, up.started_at, up.expires_at, up.ls_subscription_id
    ORDER BY up.started_at DESC
  ) t;
$$;


-- ============================================================
-- COMBINED DASHBOARD SNAPSHOT (one call for everything)
-- ============================================================

CREATE OR REPLACE FUNCTION get_admin_snapshot()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT json_build_object(
    'users',       get_total_users(),
    'active_7d',   get_active_users(7),
    'active_30d',  get_active_users(30),
    'assignments', get_assignment_stats(),
    'classes',     get_class_stats(),
    'revenue',     get_revenue_stats(),
    'mrr_cents',   get_mrr_cents()
  );
$$;


-- ============================================================
-- GRANT EXECUTE to authenticated role
-- (lets your admin page call these via the anon/service key)
-- ============================================================

GRANT EXECUTE ON FUNCTION get_total_users()                        TO authenticated;
GRANT EXECUTE ON FUNCTION get_signups_by_day(integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_list(integer)                   TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_users(integer)                TO authenticated;
GRANT EXECUTE ON FUNCTION get_assignment_stats()                   TO authenticated;
GRANT EXECUTE ON FUNCTION get_assignments_by_day(integer)          TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_stats()                        TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_stats()                      TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_by_day(integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION get_mrr_cents()                          TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_payments(integer)             TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_subscribers()                 TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_snapshot()                     TO authenticated;
