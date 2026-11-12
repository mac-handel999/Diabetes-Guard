-- Deduplicate badge arrays that accumulated duplicates before the
-- badge-evaluation rewrite. The current server code already dedupes on
-- write, but existing rows may hold 30-odd copies of the same badge
-- from the old append-only logic.
--
-- Run this once in the Supabase SQL editor after deploying the badge
-- fix. It is idempotent — running it again is a no-op.

update public.program_progress
set badges = (
  select array_agg(b order by b)
  from (
    select distinct b
    from unnest(badges) as t(b)
  ) as sub
)
where badges is not null
  and array_length(badges, 1) > (
    select count(distinct b)
    from unnest(badges) as t(b)
  );