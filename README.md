# Dia Shield
A health tech web app for a 12-week program for Diabetes 
Diabetes_guard#9112

## Admin dashboard

Set `ADMIN_EMAILS` (or `ADMIN_EMAIL`) in the server environment as a comma-separated allowlist, then open `/admin.html` and sign in with one of those accounts. For example: `ADMIN_EMAILS=research-admin@example.com`. Apply `supabase/admin-schema.sql` before recording baseline or endline assessments. The dashboard aggregates participant engagement from `research_analytics` and exports participant and outcome data for analysis.

## Developer map

- `server.js` — Express server, Supabase access, authentication, session validation, participant APIs, admin APIs, exports, and static-file hosting.
- `public/index.html` — Participant page structure: sign-in forms, dashboard header, trackers, courses, leaderboard, profile, certificate controls, and navigation.
- `public/main.js` — Participant authentication, API calls, dashboard rendering, metrics, badges, certificate downloads, session expiry, and offline metric queueing.
- `public/modules.js` — Curriculum loading, offline lesson fallback, day/module rendering, quizzes, daily challenges, and weekly challenges.
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
- `vercel.json` — Production routing: API requests go to `server.js`, while public files are served from `public/`.
- `package.json` — Node runtime dependencies and start/development commands.

### Main data flow

1. The browser signs in through `/api/v1/auth/login` and stores the returned session locally.
2. Protected requests send the access token and signed session ticket to `server.js`.
3. `server.js` validates the session, reads/writes Supabase tables, and returns JSON.
4. Participant and admin JavaScript functions render the returned data into the HTML sections.
5. The service worker caches static content, while database requests remain network-only for privacy and accuracy.
