const express  = require('express')
const supabase = require('../supabase')

const router = express.Router()

// GET /api/sessions?doctor_id=...&patient_id=...&limit=20
router.get('/', async (req, res) => {
  const { doctor_id, patient_id, limit = 20, offset = 0 } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  let query = supabase
    .from('voice_sessions')
    .select(`
      id, patient_id, doctor_id,
      audio_file_name, audio_size_bytes,
      result, confidence, message, features,
      created_at,
      patients ( full_name, initials, avatar_color, stage )
    `)
    .eq('doctor_id', doctor_id)
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1)

  if (patient_id) query = query.eq('patient_id', patient_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/sessions/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('voice_sessions')
    .select(`*, patients ( full_name, initials, avatar_color, stage )`)
    .eq('id', req.params.id)
    .single()

  if (error) return res.status(404).json({ error: error.message })
  res.json(data)
})

// POST /api/sessions — save an analysis result (called internally by predict route)
router.post('/', async (req, res) => {
  const { patient_id, doctor_id, audio_path, audio_file_name, audio_size_bytes,
          result, confidence, message, features } = req.body

  if (!patient_id || !doctor_id || !result || confidence === undefined) {
    return res.status(400).json({ error: 'patient_id, doctor_id, result and confidence are required' })
  }

  const { data, error } = await supabase
    .from('voice_sessions')
    .insert({
      patient_id, doctor_id,
      audio_path:       audio_path       || null,
      audio_file_name:  audio_file_name  || null,
      audio_size_bytes: audio_size_bytes || null,
      result,
      confidence: Number(confidence),
      message:    message  || null,
      features:   features || null,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// GET /api/sessions/weekly?doctor_id=...
// Returns the weekly_sessions view data for the bar chart
router.get('/stats/weekly', async (req, res) => {
  const { doctor_id } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  const { data, error } = await supabase
    .from('weekly_sessions')
    .select('week_label, week_start, session_count')
    .eq('doctor_id', doctor_id)
    .order('week_start', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router
