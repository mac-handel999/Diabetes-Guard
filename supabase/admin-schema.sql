-- Research outcomes captured by the research team.
-- Run this migration in the Supabase SQL editor before using the admin assessment form.
create table if not exists public.research_assessments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references auth.users(id) on delete cascade,
  phase text not null check (phase in ('baseline', 'endline')),
  data jsonb not null default '{}'::jsonb,
  measured_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (participant_id, phase)
);

create index if not exists research_assessments_participant_idx
  on public.research_assessments (participant_id);

alter table public.research_assessments enable row level security;
