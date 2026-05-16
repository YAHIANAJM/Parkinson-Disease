const express  = require('express')
const supabase = require('../supabase')

const router = express.Router()

// GET /api/appointments?doctor_id=...&status=upcoming
router.get('/', async (req, res) => {
  const { doctor_id, status, limit = 10 } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  let query = supabase
    .from('appointments')
    .select(`
      id, scheduled_at, type, status, notes, session_id, created_at,
      patients ( id, full_name, initials, avatar_color, stage, age )
    `)
    .eq('doctor_id', doctor_id)
    .order('scheduled_at', { ascending: true })
    .limit(Number(limit))

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/appointments/next — next upcoming appointment for dashboard card
router.get('/next', async (req, res) => {
  const { doctor_id } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id, scheduled_at, type, status, notes,
      patients ( id, full_name, initials, avatar_color, stage, age )
    `)
    .eq('doctor_id', doctor_id)
    .eq('status', 'upcoming')
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .single()

  if (error && error.code === 'PGRST116') return res.json(null)  // no rows
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/appointments
router.post('/', async (req, res) => {
  const { patient_id, doctor_id, scheduled_at, type, notes } = req.body
  if (!patient_id || !doctor_id || !scheduled_at) {
    return res.status(400).json({ error: 'patient_id, doctor_id and scheduled_at are required' })
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert({ patient_id, doctor_id, scheduled_at, type: type || 'voice_analysis', notes: notes || null })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PATCH /api/appointments/:id
router.patch('/:id', async (req, res) => {
  const allowed = ['scheduled_at','type','status','notes','session_id']
  const updates = {}
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k]

  const { data, error } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('appointments').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

module.exports = router
