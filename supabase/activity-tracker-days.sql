-- Store each self-monitoring day independently so participants can save as they go.
create table if not exists public.physical_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  day text not null check (day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  entry jsonb not null check (jsonb_typeof(entry) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, week_start, day)
);

alter table public.physical_activity_days enable row level security;

insert into public.physical_activity_days (user_id, week_start, day, entry, updated_at)
select weeks.user_id, weeks.week_start, entries.key, entries.value, weeks.updated_at
from public.physical_activity_weeks as weeks
cross join lateral jsonb_each(weeks.daily_entries) as entries
where entries.key in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  and jsonb_typeof(entries.value) = 'object'
on conflict (user_id, week_start, day) do nothing;
