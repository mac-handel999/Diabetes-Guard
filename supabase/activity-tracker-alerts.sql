-- Self-monitoring activity records and administrative alert workflow.
-- These tables are intentionally separate from research assessments and analytics.
create table if not exists public.physical_activity_weeks (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  daily_entries jsonb not null default '{}'::jsonb,
  weekly_checkin jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.physical_activity_weeks enable row level security;

create table if not exists public.admin_alert_states (
  alert_key text primary key,
  participant_id uuid not null references auth.users(id) on delete cascade,
  alert_type text not null check (alert_type in ('inactive', 'missed_modules', 'declining', 'completed', 'smart_goal')),
  status text not null check (status in ('reviewed', 'resolved')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.admin_alert_states enable row level security;
