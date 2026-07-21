/**
 * DiabetesGuard — server.js
 * Version: 2.2 (Correction pass)
 *
 * Correction in this pass:
 *  ⚠️ Restored the `ws` import and `realtime.transport` option. The
 *     previous pass removed this on the theory that it was dead code
 *     since nothing here opens a Realtime channel — that was wrong.
 *     Supabase's client constructs its realtime module EAGERLY inside
 *     createClient(), not lazily on first subscribe, and on Node
 *     runtimes without a global WebSocket (anything before Node 22,
 *     which covers most current Vercel/Node LTS deployments) that
 *     construction throws `ReferenceError: WebSocket is not defined`
 *     at server boot — even though the route handlers never touch
 *     Realtime. Confirmed by the actual crash this caused. Keeping the
 *     explicit `ws` transport is required for compatibility, not
 *     optional cleanup, regardless of whether Realtime is ever used.
 *
 * Carried forward from 2.1:
 *  ✅ Registration rolls back the auth user on ANY failure in
 *     steps 2-5 (profile/points/progress inserts), not just the alias
 *     collision case
 *  ✅ Alias-uniqueness race condition closed via catching Postgres
 *     unique-violation (code 23505) on the actual insert, in addition
 *     to the fast pre-check
 *  ✅ Daily per-metric-type point cap so /metrics/log can't be farmed
 *     indefinitely by scripting repeated calls
 *  ✅ /auth/logout attempts server-side session revocation instead of
 *     only deleting the client's local copy of the token
 *
 * Known follow-up (needs a small main.js change too, not done here
 * since it was out of scope for a server.js-only fix — flagged in
 * chat): quiz correctness is still reported by the client as a bare
 * `correct: true/false` boolean, which the server has no way to verify
 * without also knowing which question and which option was chosen.
 * Closing that fully requires main.js to send `week` + `chosenIndex`
 * instead, so the server can check it against its own answer key.
 */

'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// SUPABASE  (service role — server-side only)
// NEVER send SUPABASE_SERVICE_ROLE_KEY to the browser
// ─────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// `realtime.transport` is required here even though this file never
// opens a Realtime channel — see the correction note above. Without
// it, createClient() itself throws on Node runtimes lacking a global
// WebSocket implementation.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth:     { persistSession: false },
    realtime: { transport: WebSocket },
  }

);

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
app.use(cors({
  origin:  process.env.CLIENT_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min window
  max: 10,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 min window
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.use('/api/', generalLimiter);
app.use('/api/v1/auth/', authLimiter);

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Points awarded per metric type */
const POINTS_MAP = {
  food:      15,
  water:     10,
  activity:  20,
  weight:    10,
  module:    30,
  quiz:      20,   // only awarded on correct answers (checked in route)
  challenge: 50,
};

/**
 * Max number of POINT-EARNING logs per metric type, per day, per user.
 * Logging beyond this cap still records the entry (so activity history
 * stays accurate) but awards 0 additional points — this closes the gap
 * where a script could call /metrics/log in a loop to farm unlimited
 * points and pollute the leaderboard / research data.
 */
const DAILY_METRIC_CAP = {
  food:      6,
  water:     8,
  activity:  4,
  weight:    2,
  module:    3,
  quiz:      12,
  challenge: 1,
};

/** All badge definitions + their unlock conditions */
const BADGE_RULES = [
  { key: 'first_log',  check: s => s.total_logs >= 1                   },
  { key: 'hydration',  check: s => s.water_today >= 8                  },
  { key: 'active',     check: s => s.activity_total >= 3               },
  { key: 'streak3',    check: s => s.streak >= 3                       },
  { key: 'streak7',    check: s => s.streak >= 7                       },
  { key: 'quiz_ace',   check: s => s.quiz_correct >= 1                 },
  { key: 'challenge',  check: s => s.challenge_total >= 1              },
  { key: 'week1',      check: s => s.modules_complete >= 1             },
  { key: 'complete',   check: s => s.modules_complete >= 12            },
];

/** Returns today's date as YYYY-MM-DD (UTC) */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the Monday of the current week as YYYY-MM-DD */
function weekStartStr() {
  const d   = new Date();
  const day = d.getDay();                         // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;         // shift to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluate which new badges a user has unlocked.
 * @param {string[]} current  - badge keys the user already holds
 * @param {object}   snapshot - aggregated counts used by badge rules
 * @returns {{ newBadges: string[], allBadges: string[] }}
 */
function evaluateBadges(current = [], snapshot = {}) {
  const earned = new Set(current);
  const newBadges = [];

  for (const rule of BADGE_RULES) {
    if (!earned.has(rule.key) && rule.check(snapshot)) {
      earned.add(rule.key);
      newBadges.push(rule.key);
    }
  }

  return { newBadges, allBadges: [...earned] };
}

// ─────────────────────────────────────────────
// JWT MIDDLEWARE
// ─────────────────────────────────────────────
async function verifyJWT(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token missing.' });
  }

  const token = header.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(403).json({ error: 'Invalid or expired session. Please sign in again.' });
  }

  req.user = user;
  req.token = token; // needed by /auth/logout to attempt server-side revocation
  next();
}

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 * Body: { email, password, username, anonHandle }
 */
app.post('/api/v1/auth/register', async (req, res) => {
  const { email, password, username, anonHandle } = req.body;

  if (!email || !password || !username || !anonHandle) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  let uid = null;

  try {
    // 1. Create auth user (service role skips email confirmation)
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authErr) {
      const isDupe = authErr.message?.toLowerCase().includes('already registered')
                  || authErr.message?.toLowerCase().includes('already exists');
      return res.status(isDupe ? 409 : 400).json({
        error: isDupe
          ? 'An account with that email already exists.'
          : authErr.message,
      });
    }

    uid = authData.user.id;

    // 2. Check alias uniqueness before committing (fast path — see
    //    step 3 for the race-condition-safe fallback on the actual insert)
    const { data: aliasCheck } = await supabase
      .from('profiles')
      .select('anon_handle')
      .eq('anon_handle', anonHandle)
      .maybeSingle();

    if (aliasCheck) {
      await rollbackAuthUser(uid);
      return res.status(409).json({
        error: 'That leaderboard alias is already taken. Please choose another.',
      });
    }

    // 3. Insert profile — if this fails for ANY reason (including a
    //    unique-constraint violation from a concurrent registration
    //    that slipped past the check above), roll back the auth user
    //    so the email isn't left in an orphaned, unusable state.
    const { error: profErr } = await supabase.from('profiles').insert({
      id:          uid,
      username,
      anon_handle: anonHandle,
      enrolled_at: new Date().toISOString(),
    });

    if (profErr) {
      await rollbackAuthUser(uid);
      const isAliasRace = profErr.code === '23505'; // Postgres unique_violation
      return res.status(isAliasRace ? 409 : 500).json({
        error: isAliasRace
          ? 'That leaderboard alias is already taken. Please choose another.'
          : 'Registration failed. Please try again.',
      });
    }

    // 4. Initialise points row
    const { error: ptsErr } = await supabase.from('user_points').insert({
      user_id:       uid,
      total_points:  0,
      streak:        0,
      last_log_date: null,
    });
    if (ptsErr) {
      await rollbackAuthUser(uid);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }

    // 5. Initialise program progress row
    const { error: progErr } = await supabase.from('program_progress').insert({
      user_id:          uid,
      current_week:     1,
      badges:           [],
      modules_complete: 0,
      challenges_done:  0,
    });
    if (progErr) {
      await rollbackAuthUser(uid);
      return res.status(500).json({ error: 'Registration failed. Please try again.' });
    }

    return res.status(201).json({ success: true });

  } catch (err) {
    console.error('[register]', err.message);
    if (uid) await rollbackAuthUser(uid);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/**
 * Best-effort rollback of a partially-created auth user. Swallows its
 * own errors — this is already inside a failure path, so we log and
 * move on rather than letting a rollback error mask the original one.
 */
async function rollbackAuthUser(uid) {
  try {
    await supabase.auth.admin.deleteUser(uid);
  } catch (err) {
    console.error('[register] rollback failed for uid', uid, err.message);
  }
}

/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 * Returns: { session: { access_token, user_id, username, anon_handle } }
 */
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data: authData, error: authErr } =
      await supabase.auth.signInWithPassword({ email, password });

    if (authErr) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Fetch profile (username + anon_handle both needed by frontend)
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('username, anon_handle')
      .eq('id', authData.user.id)
      .single();

    if (profErr || !profile) {
      return res.status(404).json({ error: 'Profile not found. Please contact support.' });
    }

    return res.json({
      session: {
        access_token: authData.session.access_token,
        user_id:      authData.user.id,
        username:     profile.username,
        anon_handle:  profile.anon_handle,   // ← needed for leaderboard "You" label
      },
    });

  } catch (err) {
    console.error('[login]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/v1/auth/logout
 * Attempts server-side revocation of the session so a leaked/exfiltrated
 * token can't keep being used after the user thinks they've signed out.
 * Falls back to a plain success response if the admin API call isn't
 * available on the installed supabase-js version — logout should never
 * fail hard just because revocation isn't supported.
 */
app.post('/api/v1/auth/logout', verifyJWT, async (req, res) => {
  try {
    if (typeof supabase.auth.admin.signOut === 'function') {
      await supabase.auth.admin.signOut(req.token, 'global');
    }
  } catch (err) {
    console.warn('[logout] server-side revocation failed:', err.message);
  }
  return res.json({ success: true });
});

// ─────────────────────────────────────────────
// PROFILE / ACCOUNT ROUTES
// ─────────────────────────────────────────────

/**
 * GET /api/v1/profile
 * Returns the logged-in user's full name, email, and leaderboard alias.
 * Email comes from Supabase Auth (req.user, set by verifyJWT) since
 * it isn't duplicated into the profiles table.
 */
app.get('/api/v1/profile', verifyJWT, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('username, anon_handle')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    return res.json({
      username:    profile.username,
      anon_handle: profile.anon_handle,
      email:       req.user.email,
    });

  } catch (err) {
    console.error('[profile]', err.message);
    return res.status(500).json({ error: 'Could not load profile.' });
  }
});

/**
 * DELETE /api/v1/account
 * Permanently deletes the logged-in user's account and all of their
 * research data, then invalidates their session.
 *
 * Implementation note: this only needs to delete the Supabase Auth
 * user. profiles.id references auth.users(id) ON DELETE CASCADE, and
 * research_analytics.user_id / user_points.user_id both reference
 * profiles(id) ON DELETE CASCADE, and program_progress.user_id
 * references auth.users(id) ON DELETE CASCADE — so one call here
 * cascades through every table that holds this user's data. If any
 * of those cascade constraints are ever changed to NO ACTION/RESTRICT,
 * this route would need to delete the child rows explicitly first.
 */
app.delete('/api/v1/account', verifyJWT, async (req, res) => {
  try {
    const { error } = await supabase.auth.admin.deleteUser(req.user.id);
    if (error) throw error;

    return res.json({ success: true });

  } catch (err) {
    console.error('[account/delete]', err.message);
    return res.status(500).json({ error: 'Could not delete account. Please try again.' });
  }
});

// ─────────────────────────────────────────────
// METRICS ROUTES
// ─────────────────────────────────────────────

/**
 * POST /api/v1/metrics/log
 * Body: { metric_type, ...extra }
 *
 * Handles:
 *  - Per-type points, capped per day (see DAILY_METRIC_CAP)
 *  - Streak calculation
 *  - Badge evaluation
 *  - quiz correct/incorrect distinction
 *
 * Returns: { success, points, badges }
 */
app.post('/api/v1/metrics/log', verifyJWT, async (req, res) => {
  const { metric_type, correct, ...extra } = req.body;
  const uid   = req.user.id;
  const today = todayStr();

  if (!metric_type) {
    return res.status(400).json({ error: 'metric_type is required.' });
  }

  try {
    // ── 0. Count today's point-earning logs of this type so far,
    //        to enforce the daily cap before we award anything ─
    const { count: todaysCount } = await supabase
      .from('research_analytics')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('metric_type', metric_type)
      .eq('logged_date', today);

    const countSoFar = todaysCount ?? 0;
    const cap = DAILY_METRIC_CAP[metric_type];
    const overCap = cap !== undefined && countSoFar >= cap;

    // For quiz entries, only award points if the answer was correct;
    // for everything else, 0 once the daily cap for that type is hit.
    let pts = overCap ? 0 : (POINTS_MAP[metric_type] ?? 10);
    if (metric_type === 'quiz' && correct === false) pts = 0;

    // ── 1. Insert the log entry (always recorded, even over cap —
    //        history should reflect what actually happened) ──────
    const { error: logErr } = await supabase.from('research_analytics').insert({
      user_id:     uid,
      metric_type,
      metadata:    { correct, ...extra },
      logged_date: today,
      logged_at:   new Date().toISOString(),
    });
    if (logErr) throw logErr;

    // ── 2. Fetch current points/streak row ───────────────────
    const { data: ptsRow } = await supabase
      .from('user_points')
      .select('total_points, streak, last_log_date')
      .eq('user_id', uid)
      .maybeSingle();

    const prevTotal    = ptsRow?.total_points  ?? 0;
    const prevStreak   = ptsRow?.streak        ?? 0;
    const lastLogDate  = ptsRow?.last_log_date ?? null;

    // ── 3. Calculate streak ──────────────────────────────────
    let newStreak = prevStreak;
    if (lastLogDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      if (lastLogDate === yesterdayStr) {
        newStreak = prevStreak + 1;   // consecutive day
      } else if (lastLogDate === null) {
        newStreak = 1;                // very first log ever
      } else {
        newStreak = 1;                // streak broken — restart
      }
    }
    // If lastLogDate === today: same day second log, streak stays unchanged

    const newTotal = prevTotal + pts;

    // ── 4. Upsert points + streak ────────────────────────────
    const { error: upsertErr } = await supabase.from('user_points').upsert({
      user_id:       uid,
      total_points:  newTotal,
      streak:        newStreak,
      last_log_date: today,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (upsertErr) throw upsertErr;

    // ── 5. Fetch program_progress for badge logic ────────────
    const { data: prog } = await supabase
      .from('program_progress')
      .select('badges, modules_complete, challenges_done')
      .eq('user_id', uid)
      .maybeSingle();

    // ── 6. Update modules/challenges counter if applicable ───
    if (metric_type === 'module') {
      await supabase.from('program_progress').upsert({
        user_id:          uid,
        modules_complete: (prog?.modules_complete ?? 0) + 1,
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    if (metric_type === 'challenge') {
      await supabase.from('program_progress').upsert({
        user_id:         uid,
        challenges_done: (prog?.challenges_done ?? 0) + 1,
        updated_at:      new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    // ── 7. Build snapshot for badge evaluation ───────────────
    const { data: allLogs } = await supabase
      .from('research_analytics')
      .select('metric_type, logged_date, metadata')
      .eq('user_id', uid);

    const logs = allLogs || [];

    const snapshot = {
      total_logs:        logs.length,
      water_today:       logs.filter(l => l.metric_type === 'water' && l.logged_date === today).length,
      activity_total:    logs.filter(l => l.metric_type === 'activity').length,
      streak:            newStreak,
      quiz_correct:      logs.filter(l => l.metric_type === 'quiz' && l.metadata?.correct === true).length,
      challenge_total:   logs.filter(l => l.metric_type === 'challenge').length,
      modules_complete:  (prog?.modules_complete ?? 0) + (metric_type === 'module' ? 1 : 0),
    };

    const { allBadges } = evaluateBadges(prog?.badges ?? [], snapshot);

    // ── 8. Persist badges if any new ones were earned ────────
    if (allBadges.length !== (prog?.badges ?? []).length) {
      await supabase.from('program_progress')
        .update({ badges: allBadges, updated_at: new Date().toISOString() })
        .eq('user_id', uid);
    }

    return res.json({ success: true, points: newTotal, badges: allBadges });

  } catch (err) {
    console.error('[metrics/log]', err.message);
    return res.status(500).json({ error: 'Failed to save log. Please try again.' });
  }
});

/**
 * GET /api/v1/metrics/snapshot
 * Returns today's per-type counts, this week's total, points, streak, badges
 */
app.get('/api/v1/metrics/snapshot', verifyJWT, async (req, res) => {
  const uid   = req.user.id;
  const today = todayStr();
  const wkStart = weekStartStr();

  try {
    const [logsRes, ptsRes, progRes] = await Promise.all([
      supabase
        .from('research_analytics')
        .select('metric_type, logged_date')
        .eq('user_id', uid),
      supabase
        .from('user_points')
        .select('total_points, streak')
        .eq('user_id', uid)
        .maybeSingle(),
      supabase
        .from('program_progress')
        .select('badges')
        .eq('user_id', uid)
        .maybeSingle(),
    ]);

    const allLogs  = logsRes.data  || [];
    const todayLgs = allLogs.filter(l => l.logged_date === today);
    const weekLgs  = allLogs.filter(l => l.logged_date >= wkStart);

    const todayCounts = todayLgs.reduce((acc, l) => {
      acc[l.metric_type] = (acc[l.metric_type] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      logs: {
        food:     todayCounts.food     || 0,
        water:    todayCounts.water    || 0,
        activity: todayCounts.activity || 0,
        weight:   todayCounts.weight   || 0,
      },
      weekLogs:  weekLgs.length,
      totalLogs: allLogs.length,          // kept for legacy frontend compatibility
      points:    ptsRes.data?.total_points ?? 0,
      streak:    ptsRes.data?.streak       ?? 0,
      badges:    progRes.data?.badges      ?? [],
    });

  } catch (err) {
    console.error('[metrics/snapshot]', err.message);
    return res.status(500).json({ error: 'Could not load snapshot.' });
  }
});

/**
 * GET /api/v1/metrics/leaderboard
 * Returns top 20 by points (alias only — no real names)
 */
app.get('/api/v1/metrics/leaderboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_points')
      .select('total_points, profiles(anon_handle)')
      .order('total_points', { ascending: false })
      .limit(20);

    if (error) throw error;

    // Filter out any rows where the profiles join returned null
    const board = (data || [])
      .filter(row => row.profiles?.anon_handle)
      .map(row => ({
        anon_handle:  row.profiles.anon_handle,
        total_points: row.total_points,
      }));

    return res.json(board);

  } catch (err) {
    console.error('[leaderboard]', err.message);
    return res.status(500).json({ error: 'Could not load leaderboard.' });
  }
});

// ─────────────────────────────────────────────
// PROGRAM ROUTES
// ─────────────────────────────────────────────

/**
 * GET /api/v1/program/week
 * Calculates which week of the 12-week program the user is currently on
 * based on their enrolled_at date
 */
app.get('/api/v1/program/week', verifyJWT, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('enrolled_at')
      .eq('id', req.user.id)
      .single();

    if (error || !profile?.enrolled_at) {
      return res.json({ week: 1 });
    }

    const enrolDate  = new Date(profile.enrolled_at);
    const now        = new Date();
    const daysPassed = Math.floor((now - enrolDate) / (1000 * 60 * 60 * 24));
    const week       = Math.min(12, Math.max(1, Math.floor(daysPassed / 7) + 1));

    return res.json({ week });

  } catch (err) {
    console.error('[program/week]', err.message);
    return res.status(500).json({ error: 'Could not determine program week.' });
  }
});

// ─────────────────────────────────────────────
// CATCH-ALL → SPA  (must be last)
// Ensures page refresh on any URL still serves index.html
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  DiabetesGuard server running → http://localhost:${PORT}`);
  console.log(`    Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`    Env:      ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;