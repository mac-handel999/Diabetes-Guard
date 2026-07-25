# Dia Shield
A health tech web app for a 12-week program for Diabetes 
Diabetes_guard#9112

## Admin dashboard

Set `ADMIN_EMAILS` (or `ADMIN_EMAIL`) in the server environment as a comma-separated allowlist, then open `/admin.html` and sign in with one of those accounts. For example: `ADMIN_EMAILS=research-admin@example.com`. Apply `supabase/admin-schema.sql` before recording baseline or endline assessments. The dashboard aggregates participant engagement from `research_analytics` and exports participant and outcome data for analysis.
