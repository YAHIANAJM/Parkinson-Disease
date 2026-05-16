const express  = require('express')
const path     = require('path')
const supabase = require('../supabase')

const router = express.Router()

// POST /api/predict
// Body   : raw audio bytes  (Content-Type: audio/*)
// Headers: X-Filename       (optional original filename)
// Query  : patient_id, doctor_id  (optional, for Supabase persistence)
router.post(
  '/',
  express.raw({ type: 'audio/*', limit: '50mb' }),
  async (req, res) => {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'No audio body provided' })
    }

    const contentType = req.headers['content-type'] || 'audio/webm'
    const filename    = req.headers['x-filename']    || 'recording.webm'
    const { patient_id, doctor_id } = req.query

    // ── Step 1: Forward to FastAPI ML server ────────────────────────────────
    let mlResult
    try {
      mlResult = await callFastAPI(req.body, contentType, filename)
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }

    // ── Step 2: Upload audio to Supabase Storage (non-fatal) ────────────────
    let storagePath = null
    if (patient_id && doctor_id) {
      try {
        const ext = path.extname(filename) || '.webm'
        storagePath = `${doctor_id}/${patient_id}/${Date.now()}${ext}`

        const { error: storageErr } = await supabase.storage
          .from('audio-recordings')
          .upload(storagePath, req.body, { contentType })

        if (storageErr) {
          console.warn('[predict] Storage upload failed:', storageErr.message)
          storagePath = null
        }
      } catch (e) {
        console.warn('[predict] Storage error:', e.message)
        storagePath = null
      }
    }

    // ── Step 3: Persist session record to Supabase ───────────────────────────
    let sessionId = null
    if (patient_id && doctor_id) {
      const { data: session, error: sessionErr } = await supabase
        .from('voice_sessions')
        .insert({
          patient_id,
          doctor_id,
          audio_path:       storagePath,
          audio_file_name:  filename,
          audio_size_bytes: req.body.length,
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

    res.json({
      prediction:     mlResult.prediction,
      confidence:     mlResult.confidence,
      message:        mlResult.message,
      voice_model:    mlResult.voice_model    || null,
      research_model: mlResult.research_model || null,
      session_id:     sessionId,
      audio_stored:   !!storagePath,
    })
  }
)

// ── Proxy raw audio buffer to FastAPI ML server ───────────────────────────────
async function callFastAPI(buffer, contentType, filename) {
  const apiUrl   = process.env.PYTHON_API_URL || 'http://localhost:8000'
  const blob     = new Blob([buffer], { type: contentType })
  const formData = new FormData()
  formData.append('audio', blob, filename)

  const res = await fetch(`${apiUrl}/predict`, { method: 'POST', body: formData })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`FastAPI error ${res.status}: ${text.slice(0, 300)}`)
  }

  return res.json()
}

module.exports = router
