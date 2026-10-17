-- Minimal RPC target for the scheduled Supabase keep-alive workflow.
-- It exposes no project data and requires only the public anon API key.
create or replace function public.keepalive()
returns json
language sql
security invoker
as $$
  select json_build_object('status', 'ok');
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

notify pgrst, 'reload schema';
