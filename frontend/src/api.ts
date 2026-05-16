// ── NeuroTrack API client ──────────────────────────────────────────────────────
// All calls go to the Express backend at VITE_API_URL (default: http://localhost:5000)
// The backend then talks to Supabase using the service role key.

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:9090'

// DEV_DOCTOR_ID: once you have a real Supabase doctor UUID, put it in .env.local
// VITE_DOCTOR_ID=<your-uuid>
export const DOCTOR_ID = import.meta.env.VITE_DOCTOR_ID || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Types (mirror Supabase table shapes) ──────────────────────────────────────

export type PatientStage = 'early' | 'moderate' | 'advanced'
export type SessionResult = 'healthy' | 'parkinson'

export interface Patient {
  id: string
  doctor_id: string
  full_name: string
  age: number
  gender: 'M' | 'F' | 'O' | null
  stage: PatientStage
  initials: string
  avatar_color: string
  health_score: number
  in_training: boolean
  notes: string | null
  sessions_count: number
  last_session_at: string | null
  last_result: SessionResult | null
  created_at: string
  updated_at: string
}

export interface VoiceSession {
  id: string
  patient_id: string
  doctor_id: string
  audio_file_name: string | null
  audio_size_bytes: number | null
  result: SessionResult
  confidence: number
  message: string | null
  features: Record<string, number> | null
  created_at: string
  patients?: {
    full_name: string
    initials: string
    avatar_color: string
    stage: PatientStage
  }
}

export interface Appointment {
  id: string
  patient_id: string
  doctor_id: string
  scheduled_at: string
  type: 'voice_analysis' | 'consultation' | 'follow_up'
  status: 'upcoming' | 'completed' | 'cancelled'
  notes: string | null
  session_id: string | null
  patients?: {
    id: string
    full_name: string
    initials: string
    avatar_color: string
    stage: PatientStage
    age: number
  }
}

export interface TrainingRun {
  id: string
  doctor_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  accuracy: number | null
  total_samples: number | null
  patient_count: number | null
  algorithm: string
  config: Record<string, unknown>
  model_path: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  training_run_patients?: Array<{
    patient_id: string
    sessions_count: number
    stage_snapshot: PatientStage
    patients: { full_name: string; initials: string; avatar_color: string }
  }>
}

export interface DashboardStats {
  doctor_id: string
  total_patients: number
  total_sessions: number
  training_patients: number
  avg_health_score: number
  upcoming_appointments: number
  completed_training_runs: number
  sessions_this_week: number
  latest_model_accuracy: number | null
}

export interface DashboardData {
  stats: DashboardStats
  recentSessions: VoiceSession[]
  weeklyChart: Array<{ week_label: string; week_start: string; session_count: number }>
  patients: Patient[]
  nextAppointment: Appointment | null
  brainMetrics: {
    tremor_score: string | null
    dopamine_activity: string | null
    motor_function: string | null
    cognitive_score: string | null
  } | null
}

export interface ModelResult {
  prediction?: 'healthy' | 'parkinson'
  confidence?: number
  error?: string
}

export interface PredictResult {
  prediction: SessionResult
  confidence: number
  message: string
  session_id: string | null
  audio_stored: boolean
  voice_model: ModelResult | null
  research_model: ModelResult | null
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export const api = {
  dashboard: {
    get: (doctorId: string) =>
      request<DashboardData>(`/api/dashboard?doctor_id=${doctorId}`),
  },

  // ── Patients ────────────────────────────────────────────────────────────────
  patients: {
    list: (doctorId: string, limit = 20, offset = 0) =>
      request<{ data: Patient[]; total: number; limit: number; offset: number }>(
        `/api/patients?doctor_id=${doctorId}&limit=${limit}&offset=${offset}`
      ),

    get: (id: string) =>
      request<Patient>(`/api/patients/${id}`),

    create: (body: { doctor_id: string; full_name: string; age: number; gender?: string; stage?: PatientStage; avatar_color?: string; notes?: string }) =>
      request<Patient>('/api/patients', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: Partial<Patient>) =>
      request<Patient>(`/api/patients/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    delete: (id: string) =>
      request<void>(`/api/patients/${id}`, { method: 'DELETE' }),

    toggleTraining: (id: string, inTraining: boolean) =>
      request<Patient>(`/api/patients/${id}/training`, {
        method: 'PATCH',
        body: JSON.stringify({ in_training: inTraining }),
      }),
  },

  // ── Voice Sessions ──────────────────────────────────────────────────────────
  sessions: {
    list: (doctorId: string, patientId?: string) => {
      const qs = patientId
        ? `doctor_id=${doctorId}&patient_id=${patientId}`
        : `doctor_id=${doctorId}`
      return request<VoiceSession[]>(`/api/sessions?${qs}`)
    },

    weekly: (doctorId: string) =>
      request<Array<{ week_label: string; week_start: string; session_count: number }>>(
        `/api/sessions/stats/weekly?doctor_id=${doctorId}`
      ),
  },

  // ── Appointments ─────────────────────────────────────────────────────────────
  appointments: {
    list: (doctorId: string, status?: string) => {
      const qs = status ? `doctor_id=${doctorId}&status=${status}` : `doctor_id=${doctorId}`
      return request<Appointment[]>(`/api/appointments?${qs}`)
    },

    next: (doctorId: string) =>
      request<Appointment | null>(`/api/appointments/next?doctor_id=${doctorId}`),

    create: (body: { patient_id: string; doctor_id: string; scheduled_at: string; type?: string; notes?: string }) =>
      request<Appointment>('/api/appointments', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: Partial<Appointment>) =>
      request<Appointment>(`/api/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    delete: (id: string) =>
      request<void>(`/api/appointments/${id}`, { method: 'DELETE' }),
  },

  // ── Training Runs ────────────────────────────────────────────────────────────
  training: {
    list: (doctorId: string) =>
      request<TrainingRun[]>(`/api/training?doctor_id=${doctorId}`),

    start: (doctorId: string, algorithm?: string) =>
      request<TrainingRun>('/api/training', {
        method: 'POST',
        body: JSON.stringify({ doctor_id: doctorId, algorithm }),
      }),

    cancel: (runId: string) =>
      request<void>(`/api/training/${runId}/cancel`, { method: 'PATCH' }),

    get: (runId: string) =>
      request<TrainingRun>(`/api/training/${runId}`),
  },

  // ── ML Predict ──────────────────────────────────────────────────────────────
  // Sends audio as raw binary body; patient/doctor IDs go as query params.
  predict: async (file: File, patientId?: string, doctorId?: string): Promise<PredictResult> => {
    const url = new URL(`${BASE}/api/predict`)
    if (patientId) url.searchParams.set('patient_id', patientId)
    if (doctorId)  url.searchParams.set('doctor_id',  doctorId)

    const res = await fetch(url.toString(), {
      method:  'POST',
      headers: {
        'Content-Type': file.type || 'audio/webm',
        'X-Filename':   file.name,
      },
      body: file,
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      throw new Error(b.error || `HTTP ${res.status}`)
    }
    return res.json() as Promise<PredictResult>
  },
}
