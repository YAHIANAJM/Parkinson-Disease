require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const app  = express()
const PORT = process.env.PORT || 5000

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }))
app.use(express.json())

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/predict',      require('./routes/predict'))
app.use('/api/patients',     require('./routes/patients'))
app.use('/api/sessions',     require('./routes/sessions'))
app.use('/api/appointments', require('./routes/appointments'))
app.use('/api/training',     require('./routes/training'))
app.use('/api/dashboard',    require('./routes/dashboard'))

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', err.message)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`NeuroTrack backend running on port ${PORT}`)
})
