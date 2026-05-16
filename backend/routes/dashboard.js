const express  = require('express')
const supabase = require('../supabase')

const router = express.Router()

// GET /api/dashboard?doctor_id=...
// Returns everything the Dashboard page needs in a single request
router.get('/', async (req, res) => {
  const { doctor_id } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  // Run all queries in parallel
  const [statsRes, sessionsRes, weeklyRes, patientsRes, nextApptRes, brainRes] =
    await Promise.all([
      // 1. Top-level stats card numbers
      supabase
        .from('doctor_dashboard_stats')
        .select('*')
        .eq('doctor_id', doctor_id)
        .single(),

      // 2. Recent 5 sessions with patient info
      supabase
        .from('voice_sessions')
        .select(`
          id, result, confidence, created_at,
          patients ( full_name, initials, avatar_color )
        `)
        .eq('doctor_id', doctor_id)
        .order('created_at', { ascending: false })
        .limit(5),

      // 3. Weekly chart data (last 6 weeks)
      supabase
        .from('weekly_sessions')
        .select('week_label, week_start, session_count')
        .eq('doctor_id', doctor_id)
        .order('week_start', { ascending: true })
        .limit(6),

      // 4. Patient mini-list (top 4 by score for sidebar card)
      supabase
        .from('patient_summary')
        .select('id, full_name, initials, avatar_color, stage, health_score, sessions_count')
        .eq('doctor_id', doctor_id)
        .order('health_score', { ascending: true })   // worst first (most attention needed)
        .limit(4),

      // 5. Next upcoming appointment
      supabase
        .from('appointments')
        .select(`
          id, scheduled_at, type, status,
          patients ( id, full_name, initials, avatar_color, stage )
        `)
        .eq('doctor_id', doctor_id)
        .eq('status', 'upcoming')
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .single(),

      // 6. Latest brain metrics (for dashboard brain panel)
      supabase
        .from('latest_brain_metrics')
        .select('tremor_score, dopamine_activity, motor_function, cognitive_score, patient_id')
        .eq('doctor_id', doctor_id)
        .limit(1)
        .single(),
    ])

  // Collect any hard errors (ignore 406 "no rows" from .single())
  const errors = [statsRes, sessionsRes, weeklyRes, patientsRes]
    .filter(r => r.error && r.error.code !== 'PGRST116')
    .map(r => r.error.message)

  if (errors.length > 0) {
    return res.status(500).json({ error: errors.join('; ') })
  }

  res.json({
    stats:        statsRes.data        || {},
    recentSessions: sessionsRes.data   || [],
    weeklyChart:  weeklyRes.data       || [],
    patients:     patientsRes.data     || [],
    nextAppointment: nextApptRes.data  || null,
    brainMetrics: brainRes.data        || null,
  })
})

// GET /api/dashboard/brain?doctor_id=...&patient_id=...
// Brain metrics for a specific patient (or aggregate across all patients)
router.get('/brain', async (req, res) => {
  const { doctor_id, patient_id } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  let query = supabase
    .from('latest_brain_metrics')
    .select('*')
    .eq('doctor_id', doctor_id)

  if (patient_id) query = query.eq('patient_id', patient_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router
