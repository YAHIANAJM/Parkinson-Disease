const express  = require('express')
const supabase = require('../supabase')

const router = express.Router()

// GET /api/patients?doctor_id=...&limit=20&offset=0
// Returns paginated patients for a doctor using the patient_summary view
router.get('/', async (req, res) => {
  const { doctor_id, limit = 20, offset = 0 } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  const lim = Math.min(Number(limit), 100)
  const off = Number(offset)

  const { data, error, count } = await supabase
    .from('patient_summary')
    .select('*', { count: 'exact' })
    .eq('doctor_id', doctor_id)
    .order('created_at', { ascending: false })
    .range(off, off + lim - 1)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ data, total: count, limit: lim, offset: off })
})

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('patient_summary')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error) return res.status(404).json({ error: error.message })
  res.json(data)
})

// POST /api/patients — create patient
router.post('/', async (req, res) => {
  const { doctor_id, full_name, age, gender, stage, avatar_color, notes } = req.body
  if (!doctor_id || !full_name || !age) {
    return res.status(400).json({ error: 'doctor_id, full_name and age are required' })
  }

  const { data, error } = await supabase
    .from('patients')
    .insert({
      doctor_id,
      full_name: full_name.trim(),
      age: Number(age),
      gender:       gender       || null,
      stage:        stage        || 'early',
      avatar_color: avatar_color || '#BFDBFE',
      notes:        notes        || null,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PATCH /api/patients/:id — partial update
router.patch('/:id', async (req, res) => {
  const allowed = ['full_name','age','gender','stage','avatar_color','health_score','in_training','notes']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { data, error } = await supabase
    .from('patients')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/patients/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('patients')
    .delete()
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

// PATCH /api/patients/:id/training — toggle in_training flag
router.patch('/:id/training', async (req, res) => {
  const { in_training } = req.body
  if (typeof in_training !== 'boolean') {
    return res.status(400).json({ error: 'in_training (boolean) is required' })
  }

  const { data, error } = await supabase
    .from('patients')
    .update({ in_training })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

module.exports = router
