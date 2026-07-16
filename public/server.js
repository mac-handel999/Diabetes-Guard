require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure connection credentials dynamically via project configurations with fallback placeholders to prevent crashes
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper function to safely extract anon handle from profile relation
const getAnonHandle = (profile) => {
    if (!profile) return 'Anonymous';
    if (Array.isArray(profile)) return profile[0]?.anon_handle || 'Anonymous';
    return profile.anon_handle || 'Anonymous';
};

// ================= AUTH GATEWAY PIPELINES =================
app.post('/api/v1/auth/register', async (req, res) => {
    const { email, password, username, anonHandle } = req.body;
    try {
        const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password });
        if (authErr) throw authErr;
        if (!authData || !authData.user) throw new Error("Could not create user account.");

        // Populate downstream profiles model
        const { error: profErr } = await supabase.from('profiles').insert({
            id: authData.user.id, username, anon_handle: anonHandle
        });
        if (profErr) throw profErr;

        // Initialize zeroed points registry record
        await supabase.from('user_points').insert({ user_id: authData.user.id, total_points: 0 });

        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/v1/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
        if (authErr) throw authErr;
        if (!authData || !authData.user || !authData.session) throw new Error("Invalid login session.");

        const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();
        const username = profile ? profile.username : (authData.user.email || 'Cohort User');

        res.json({
            session: { access_token: authData.session.access_token, username }
        });
    } catch(err) { res.status(400).json({ error: err.message }); }
});

// ================= MID-ROUTE SECURITY TOKEN INSPECTION =================
async function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if(!authHeader) return res.status(401).json({ error: "Access token missing." });
    
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Access token malformed." });
    
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if(error || !user) return res.status(403).json({ error: "Invalid token validation." });

        req.user = user;
        next();
    } catch(err) {
        return res.status(403).json({ error: "Token validation failed: " + err.message });
    }
}

// ================= TELEMETRY ANALYTICS ENDPOINTS =================
app.post('/api/v1/metrics/log', verifyJWT, async (req, res) => {
    const { metric_type } = req.body;
    const uid = req.user.id;
    try {
        // 1. Fire telemetry record straight into Research Database
        await supabase.from('research_analytics').insert({ user_id: uid, metric_type });
        // 2. Adjust points value model synchronously
        await supabase.rpc('increment_user_points', { uid, pts: 15 });
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/v1/metrics/snapshot', verifyJWT, async (req, res) => {
    const uid = req.user.id;
    try {
        const { data: logs, error: logsErr } = await supabase.from('research_analytics').select('metric_type').eq('user_id', uid);
        if (logsErr) throw logsErr;

        const { data: pts, error: ptsErr } = await supabase.from('user_points').select('total_points').eq('user_id', uid).maybeSingle();
        
        let counts = { food: 0, activity: 0, water: 0, weight: 0 };
        const logsList = logs || [];
        logsList.forEach(l => { if(counts[l.metric_type] !== undefined) counts[l.metric_type]++; });
        
        res.json({ logs: counts, totalLogs: logsList.length, points: pts ? pts.total_points : 0 });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/v1/metrics/leaderboard', async (req, res) => {
    try {
        const { data, error } = await supabase.from('user_points')
            .select(`total_points, profiles(anon_handle)`)
            .order('total_points', { ascending: false }).limit(5);
        if (error) throw error;

        const list = data || [];
        const formatted = list.map(d => ({
            total_points: d.total_points || 0,
            anon_handle: getAnonHandle(d.profiles)
        }));
        res.json(formatted);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('Secure Analytics Web Engine running smoothly.'));
