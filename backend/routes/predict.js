const express  = require('express')
const multer   = require('multer')
const path     = require('path')
const fs       = require('fs')
const supabase = require('../supabase')

const router = express.Router()

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) return cb(null, true)
    cb(new Error('Only audio files are allowed'))
  },
})

// POST /api/predict
// Body (multipart): audio (file), patient_id (optional), doctor_id (optional)
// 1. Runs Python ML model on the audio
// 2. If patient_id + doctor_id are provided, saves the session to Supabase
// 3. Optionally uploads audio to Supabase Storage
router.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' })
  }

  const audioPath  = path.resolve(req.file.path)
  const { patient_id, doctor_id } = req.body

  // ── Step 1: Call FastAPI ML server ───────────────────────────────────────
  let mlResult
  try {
    mlResult = await callFastAPI(audioPath, req.file)
  } catch (err) {
    fs.unlink(audioPath, () => {})
    return res.status(500).json({ error: err.message })
  }

  // ── Step 2: Upload audio to Supabase Storage (if patient context given) ──
  let storagePath = null
  if (patient_id && doctor_id) {
    try {
      const ext      = path.extname(req.file.originalname || '.webm') || '.webm'
      const fileName = `${Date.now()}${ext}`
      storagePath    = `${doctor_id}/${patient_id}/${fileName}`

      const fileBuffer = fs.readFileSync(audioPath)
      const { error: storageErr } = await supabase.storage
        .from('audio-recordings')
        .upload(storagePath, fileBuffer, { contentType: req.file.mimetype || 'audio/webm' })

      if (storageErr) {
        console.warn('[predict] Storage upload failed:', storageErr.message)
        storagePath = null  // non-fatal — continue without storage
      }
    } catch (e) {
      console.warn('[predict] Storage error:', e.message)
      storagePath = null
    }
  }

  // ── Step 3: Save session record to Supabase ───────────────────────────────
  let sessionId = null
  if (patient_id && doctor_id) {
    const { data: session, error: sessionErr } = await supabase
      .from('voice_sessions')
      .insert({
        patient_id,
        doctor_id,
        audio_path:       storagePath,
        audio_file_name:  req.file.originalname || 'recording.webm',
        audio_size_bytes: req.file.size,
        result:           mlResult.prediction,
        confidence:       mlResult.confidence,
        message:          mlResult.message,
        features:         mlResult.features || null,
      })
      .select('id')
      .single()

    if (sessionErr) {
      console.warn('[predict] Failed to save session:', sessionErr.message)
    } else {
      sessionId = session.id
    }
  }

  // ── Cleanup temp file ─────────────────────────────────────────────────────
  fs.unlink(audioPath, () => {})

  res.json({
    prediction:      mlResult.prediction,
    confidence:      mlResult.confidence,
    message:         mlResult.message,
    voice_model:     mlResult.voice_model     || null,
    research_model:  mlResult.research_model  || null,
    session_id:      sessionId,
    audio_stored:    !!storagePath,
  })
})

// ── Utility: forward audio to FastAPI ML server and return parsed result ───────
async function callFastAPI(audioPath, fileInfo) {
  const apiUrl = process.env.PYTHON_API_URL || 'http://localhost:8000'

  const fileBuffer = fs.readFileSync(audioPath)
  const blob       = new Blob([fileBuffer], { type: fileInfo.mimetype || 'audio/webm' })
  const formData   = new FormData()
  formData.append('audio', blob, fileInfo.originalname || 'recording.webm')

  const res = await fetch(`${apiUrl}/predict`, { method: 'POST', body: formData })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`FastAPI error ${res.status}: ${text.slice(0, 300)}`)
  }

  return res.json()
}

module.exports = router
