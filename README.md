# Dia Shield
A health tech web app for a 12-week program for Diabetes 
Diabetes_guard#9112

[![Supabase keep-alive](https://github.com/mac-handel999/Diabetes-Guard/actions/workflows/supabase-keepalive.yml/badge.svg)](https://github.com/mac-handel999/Diabetes-Guard/actions/workflows/supabase-keepalive.yml)

## Admin dashboard

Set `ADMIN_EMAILS` (or `ADMIN_EMAIL`) in the server environment as a comma-separated allowlist, then open `/admin.html` and sign in with one of those accounts. For example: `ADMIN_EMAILS=research-admin@example.com`. Apply `supabase/admin-schema.sql` before recording baseline or endline assessments. The dashboard aggregates participant engagement from `research_analytics` and exports participant and outcome data for analysis.

## Supabase free-tier keep-alive

The `.github/workflows/supabase-keepalive.yml` workflow makes a small Supabase RPC request daily at 06:17 UTC and can also be run manually from the GitHub Actions tab. The workflow must be present on the repository's default branch. To enable it:

1. Run `supabase/keepalive.sql` in the Supabase SQL Editor to create the minimal `keepalive()` RPC. It returns only a fixed status and does not read participant data.
2. In the GitHub repository, add Actions secrets named `SUPABASE_URL` and `SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions**. Use the project's API URL and publishable/anon key; do not use the service-role key.
3. Run **Supabase keep-alive** once manually in the Actions tab to confirm the RPC and secrets are configured.

This is a best-effort heartbeat, not a Supabase uptime guarantee. GitHub scheduled jobs can be delayed or disabled by GitHub (including automatic disabling for inactive repositories), and a project that is already paused may need to be restored from the Supabase dashboard before API requests work again. Check Supabase's current free-plan inactivity and pause policy for the project's eligibility.

## WhatsApp follow-up contact

Before deploying registration changes, run `supabase/whatsapp-contact.sql` in the Supabase SQL Editor. Registration requires a WhatsApp number in international format (for example, `+2348012345678`) and confirmation that the participant agrees to WhatsApp follow-up about program engagement. The number is stored on the participant profile and shown only in the authorized admin participant detail view.

## Developer map

- `server.js` — Express server, Supabase access, authentication, session validation, participant APIs, admin APIs, exports, and static-file hosting.
- `public/index.html` — Participant page structure: sign-in forms, dashboard header, trackers, courses, leaderboard, profile, certificate controls, and navigation.
- `public/main.js` — Participant authentication, API calls, dashboard rendering, metrics, badges, certificate downloads, session expiry, and offline metric queueing.
- `public/modules.js` — Curriculum loading, offline lesson fallback, day/module rendering, quizzes, infographic viewer, risk checklist, and food diary.
- `public/style.css` — Participant dashboard layout, colors, typography, responsive header, cards, navigation, certificate controls, and offline banner.
- `public/admin.html` — Admin page structure and dashboard sections for overview, participants, learning, outcomes, alerts, and exports.
- `public/admin.js` — Admin login, dashboard requests, tables, participant detail modal, assessment entry, participant deletion, and downloads.
- `public/admin.css` and `public/admin-theme.css` — Admin layout rules and styling that matches the participant dashboard.
- `public/documentation.html` — Plain-language participant guide.
- `public/admin-documentation.html` — Plain-language research-team guide.
- `public/documentation.css` — Shared documentation page layout and responsive styling.
- `public/pwa.js` — Service-worker registration, offline status banner, queued-sync trigger, and Chrome install prompt.
- `service-worker.js` — App-shell caching, offline page fallback, static asset caching, and API cache protection.
- `public/curriculum.json` — Structured 12-week curriculum content; JSON cannot contain comments, so this map documents its role here.
- `manifest.json` — PWA name, icons, theme, start URL, and standalone display settings.
- `supabase/admin-schema.sql` — Database table and index for baseline/endline research assessments.
- `supabase/keepalive.sql` — Data-free RPC used by the scheduled database keep-alive workflow.
- `supabase/whatsapp-contact.sql` — Adds a validated WhatsApp contact field to participant profiles.
- `.github/workflows/supabase-keepalive.yml` — Daily GitHub Actions database heartbeat.
- `vercel.json` — Production routing: API requests go to `server.js`, while public files are served from `public/`.
- `package.json` — Node runtime dependencies and start/development commands.

### Main data flow

1. The browser signs in through `/api/v1/auth/login` and stores the returned session locally.
2. Protected requests send the access token and signed session ticket to `server.js`.
3. `server.js` validates the session, reads/writes Supabase tables, and returns JSON.
4. Participant and admin JavaScript functions render the returned data into the HTML sections.
5. The service worker caches static content, while database requests remain network-only for privacy and accuracy.
