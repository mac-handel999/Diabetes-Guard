-- Deduplicate badge arrays that accumulated duplicates before the
-- badge-evaluation rewrite. The current server code already dedupes on
-- write, but existing rows may hold 30-odd copies of the same badge
-- from the old append-only logic.
--
-- Run this once in the Supabase SQL editor after deploying the badge
-- fix. It is idempotent — running it again is a no-op.
--
-- Note: the badges column is jsonb (a JSON array), so we use
-- jsonb_array_length / jsonb_array_elements rather than the SQL array
-- functions.

update public.program_progress
set badges = (
  select jsonb_agg(b order by b)
  from (
    select distinct b
    from jsonb_array_elements(badges) as t(b)
  ) as sub
)
where badges is not null
  and jsonb_array_length(badges) > (
    select count(distinct b)
    from jsonb_array_elements(badges) as t(b)
  );