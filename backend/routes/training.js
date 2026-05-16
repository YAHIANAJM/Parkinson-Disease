const express  = require('express')
const { spawn } = require('child_process')
const path     = require('path')
const supabase = require('../supabase')

const router = express.Router()

// GET /api/training?doctor_id=...
router.get('/', async (req, res) => {
  const { doctor_id, limit = 10 } = req.query
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  const { data, error } = await supabase
    .from('training_runs')
    .select(`
      id, status, accuracy, total_samples, patient_count,
      algorithm, config, model_path, error_message,
      started_at, completed_at, created_at,
      training_run_patients ( patient_id, sessions_count, stage_snapshot,
        patients ( full_name, initials, avatar_color )
      )
    `)
    .eq('doctor_id', doctor_id)
    .order('created_at', { ascending: false })
    .limit(Number(limit))

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/training/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('training_runs')
    .select(`*, training_run_patients(*, patients(full_name, initials, avatar_color))`)
    .eq('id', req.params.id)
    .single()

  if (error) return res.status(404).json({ error: error.message })
  res.json(data)
})

// POST /api/training — create and immediately start a training run
router.post('/', async (req, res) => {
  const { doctor_id, algorithm, config } = req.body
  if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

  // 1. Create the run record
  const { data: run, error: createErr } = await supabase
    .from('training_runs')
    .insert({
      doctor_id,
      status:    'pending',
      algorithm: algorithm || 'Random Forest + SVM Ensemble',
      config:    config    || undefined,
    })
    .select()
    .single()

  if (createErr) return res.status(500).json({ error: createErr.message })

  // 2. Snapshot which patients are in the training set
  const { error: snapErr } = await supabase.rpc('snapshot_training_patients', { p_run_id: run.id })
  if (snapErr) {
    await supabase.rpc('fail_training_run', { p_run_id: run.id, p_error: snapErr.message })
    return res.status(500).json({ error: snapErr.message })
  }

  // 3. Respond immediately — training runs async in background
  res.status(202).json({ ...run, status: 'running', message: 'Training started' })

  // 4. Kick off Python training script in background
  _runPythonTraining(run.id, doctor_id)
})

// PATCH /api/training/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  const { error } = await supabase.rpc('fail_training_run', {
    p_run_id: req.params.id,
    p_error: 'Cancelled by user',
  })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ status: 'failed', error_message: 'Cancelled by user' })
})

// ── Internal: run Python training script asynchronously ─────────────────────
function _runPythonTraining(runId, doctorId) {
  const scriptPath = path.resolve(process.env.TRAIN_SCRIPT || '../train.py')
  const python     = spawn(process.env.PYTHON_PATH || 'python', [scriptPath, runId, doctorId])

  let stdout = ''
  let stderr = ''

  python.stdout.on('data', d => (stdout += d.toString()))
  python.stderr.on('data', d => (stderr += d.toString()))

  python.on('close', async code => {
    if (code !== 0) {
      console.error(`[training] Python failed for run ${runId}:`, stderr)
      await supabase.rpc('fail_training_run', { p_run_id: runId, p_error: stderr.slice(0, 500) })
      return
    }

    try {
      const result = JSON.parse(stdout.trim())
      await supabase.rpc('complete_training_run', {
        p_run_id:    runId,
        p_accuracy:  result.accuracy,
        p_model_path: result.model_path || null,
      })
      console.log(`[training] Run ${runId} completed — accuracy: ${result.accuracy}`)
    } catch (e) {
      await supabase.rpc('fail_training_run', { p_run_id: runId, p_error: 'Invalid Python output' })
    }
  })

  python.on('error', async err => {
    console.error(`[training] Spawn error for run ${runId}:`, err.message)
    await supabase.rpc('fail_training_run', { p_run_id: runId, p_error: err.message })
  })
}

module.exports = router
