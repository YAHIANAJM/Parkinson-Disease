import { useState, useRef, useCallback, useEffect } from 'react'
import './App.css'
import { api, DOCTOR_ID } from './api'
import type { Patient as ApiPatient, VoiceSession as ApiSession, DashboardData, Appointment as ApiAppointment } from './api'

// ── Types ──────────────────────────────────────────────────────────────────────
type Page = 'dashboard' | 'patients' | 'analysis' | 'training' | 'settings'
type Tab = 'upload' | 'record'
type AnalysisStatus = 'idle' | 'loading' | 'healthy' | 'parkinson'
type PatientStage = 'early' | 'moderate' | 'advanced'

interface Patient {
  id: string
  name: string
  age: number
  stage: PatientStage
  lastSession: string
  sessionsCount: number
  inTraining: boolean
  initials: string
  score: number
  color: string
  gender: 'M' | 'F'
}

interface SessionRecord {
  id: string
  patientName: string
  initials: string
  color: string
  date: string
  result: 'healthy' | 'parkinson'
  confidence: number
}

interface ModelSubResult {
  prediction?: 'healthy' | 'parkinson'
  confidence?: number
  error?:      string
}

interface AnalysisResult {
  prediction:     'healthy' | 'parkinson'
  confidence:     number
  message:        string
  voice_model:    ModelSubResult | null
  research_model: ModelSubResult | null
}

interface QueueItem {
  id:        string
  file:      File
  status:    'pending' | 'processing' | 'done' | 'error'
  result?:   AnalysisResult
  errorMsg?: string
  expanded:  boolean
}

// ── Mock Data ──────────────────────────────────────────────────────────────────
const INIT_PATIENTS: Patient[] = [
  { id: '1', name: 'Margaret Chen',  age: 68, stage: 'moderate', lastSession: 'May 13', sessionsCount: 12, inTraining: true,  initials: 'MC', score: 74, color: '#FBCFE8', gender: 'F' },
  { id: '2', name: 'Robert Davis',   age: 72, stage: 'early',    lastSession: 'May 12', sessionsCount: 8,  inTraining: true,  initials: 'RD', score: 88, color: '#BFDBFE', gender: 'M' },
  { id: '3', name: 'Helen Okafor',   age: 65, stage: 'early',    lastSession: 'May 10', sessionsCount: 5,  inTraining: false, initials: 'HO', score: 91, color: '#BBF7D0', gender: 'F' },
  { id: '4', name: 'James Wilson',   age: 75, stage: 'advanced', lastSession: 'May 8',  sessionsCount: 20, inTraining: true,  initials: 'JW', score: 42, color: '#FED7AA', gender: 'M' },
  { id: '5', name: 'Patricia Lim',   age: 61, stage: 'early',    lastSession: 'May 14', sessionsCount: 3,  inTraining: false, initials: 'PL', score: 93, color: '#DDD6FE', gender: 'F' },
  { id: '6', name: 'Thomas Brown',   age: 70, stage: 'moderate', lastSession: 'May 11', sessionsCount: 15, inTraining: true,  initials: 'TB', score: 61, color: '#FEF08A', gender: 'M' },
  { id: '7', name: 'Alice Nguyen',   age: 67, stage: 'early',    lastSession: 'May 9',  sessionsCount: 7,  inTraining: false, initials: 'AN', score: 85, color: '#A5F3FC', gender: 'F' },
  { id: '8', name: 'David Park',     age: 74, stage: 'advanced', lastSession: 'May 7',  sessionsCount: 18, inTraining: true,  initials: 'DP', score: 38, color: '#FECACA', gender: 'M' },
]

const INIT_SESSIONS: SessionRecord[] = [
  { id: 's1', patientName: 'Patricia Lim',   initials: 'PL', color: '#DDD6FE', date: 'Today, 10:30 AM',    result: 'healthy',   confidence: 0.93 },
  { id: 's2', patientName: 'Margaret Chen',  initials: 'MC', color: '#FBCFE8', date: 'Yesterday, 2:00 PM', result: 'parkinson', confidence: 0.87 },
  { id: 's3', patientName: 'Robert Davis',   initials: 'RD', color: '#BFDBFE', date: 'May 12, 11:00 AM',   result: 'parkinson', confidence: 0.78 },
  { id: 's4', patientName: 'Helen Okafor',   initials: 'HO', color: '#BBF7D0', date: 'May 10, 9:30 AM',    result: 'healthy',   confidence: 0.91 },
  { id: 's5', patientName: 'James Wilson',   initials: 'JW', color: '#FED7AA', date: 'May 8, 3:00 PM',     result: 'parkinson', confidence: 0.95 },
]

const CHART_DATA = [
  { label: 'Apr W1', val: 4 },
  { label: 'Apr W2', val: 7 },
  { label: 'Apr W3', val: 5 },
  { label: 'Apr W4', val: 9 },
  { label: 'May W1', val: 6 },
  { label: 'May W2', val: 11 },
]

// ── API ↔ UI mappers ──────────────────────────────────────────────────────────
function mapApiPatient(p: ApiPatient): Patient {
  return {
    id:            p.id,
    name:          p.full_name,
    age:           p.age,
    stage:         p.stage,
    lastSession:   p.last_session_at ? new Date(p.last_session_at).toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '—',
    sessionsCount: p.sessions_count ?? 0,
    inTraining:    p.in_training,
    initials:      p.initials,
    score:         p.health_score,
    color:         p.avatar_color,
    gender:        (p.gender as 'M'|'F') || 'M',
  }
}

function mapApiSession(s: ApiSession): SessionRecord {
  const dt = new Date(s.created_at)
  const now = new Date()
  const diffH = (now.getTime() - dt.getTime()) / 3600000
  let dateLabel: string
  if (diffH < 1)        dateLabel = 'Just now'
  else if (diffH < 24)  dateLabel = `Today, ${dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })}`
  else if (diffH < 48)  dateLabel = `Yesterday, ${dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })}`
  else                  dateLabel = dt.toLocaleDateString('en-US', { month:'short', day:'numeric' })
  return {
    id:          s.id,
    patientName: s.patients?.full_name ?? 'Unknown',
    initials:    s.patients?.initials  ?? '??',
    color:       s.patients?.avatar_color ?? '#BFDBFE',
    date:        dateLabel,
    result:      s.result,
    confidence:  Number(s.confidence),
  }
}

const AVATAR_COLORS = ['#FBCFE8','#BFDBFE','#BBF7D0','#FED7AA','#DDD6FE','#A5F3FC','#FEF08A','#FECACA']

// ── Helpers ────────────────────────────────────────────────────────────────────
function scoreColor(s: number) {
  if (s >= 80) return '#10B981'
  if (s >= 60) return '#F59E0B'
  return '#EF4444'
}

function stageLabel(stage: PatientStage) {
  return { early: 'Stage 1–2', moderate: 'Stage 3', advanced: 'Stage 4–5' }[stage]
}

// ── Brain SVG Visualization ────────────────────────────────────────────────────
function BrainVisualization() {
  return (
    <div className="brain-wrap">
      <svg viewBox="-75 0 400 310" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="hg" cx="50%" cy="38%" r="55%">
            <stop offset="0%" stopColor="#F0F5FF"/>
            <stop offset="100%" stopColor="#D8E4F8"/>
          </radialGradient>
          <filter id="sg" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* Shoulders */}
        <path d="M22 296 Q62 272 100 262 L100 278 Q62 286 22 308Z" fill="#DDE8F5" stroke="#C5D4EC" strokeWidth="1.2"/>
        <path d="M238 296 Q198 272 160 262 L160 278 Q198 286 238 308Z" fill="#DDE8F5" stroke="#C5D4EC" strokeWidth="1.2"/>
        <path d="M100 262 Q118 252 130 251 Q142 252 160 262 L160 278 Q142 272 130 271 Q118 272 100 278Z" fill="#E8EFF8" stroke="#C5D4EC" strokeWidth="1.2"/>

        {/* Neck */}
        <rect x="118" y="228" width="24" height="36" rx="10" fill="#E5EDF8" stroke="#C5D4EC" strokeWidth="1.5"/>

        {/* Head */}
        <ellipse cx="130" cy="118" rx="84" ry="100" fill="url(#hg)" stroke="#C5D4EC" strokeWidth="2"/>

        {/* Skull inner */}
        <ellipse cx="130" cy="112" rx="72" ry="87" fill="rgba(255,255,255,0.52)" stroke="#D5E2F2" strokeWidth="1"/>

        {/* Brain body */}
        <path d="M76 88 Q80 58 97 53 Q114 48 130 50 Q146 48 163 53 Q180 58 184 88 Q190 115 180 138 Q170 160 152 168 Q141 172 130 172 Q119 172 108 168 Q90 160 80 138 Q70 115 76 88Z"
          fill="#EEF3FF" stroke="#BDD2F0" strokeWidth="1.8"/>

        {/* Hemisphere split */}
        <path d="M130 52 Q132 112 130 172" stroke="#C8D8EE" strokeWidth="1" strokeDasharray="4 3" fill="none"/>

        {/* Brain folds */}
        <path d="M84 80 Q95 73 105 80 Q115 87 125 80" stroke="#A8C2DC" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M135 80 Q145 73 157 80 Q167 87 176 80" stroke="#A8C2DC" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M78 103 Q90 96 100 103 Q112 110 122 103" stroke="#A8C2DC" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M138 103 Q150 96 162 103 Q172 110 182 103" stroke="#A8C2DC" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M80 127 Q93 120 103 127 Q115 134 127 127" stroke="#A8C2DC" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        <path d="M133 127 Q145 120 157 127 Q169 134 179 127" stroke="#A8C2DC" strokeWidth="1.2" fill="none" strokeLinecap="round"/>

        {/* Motor Cortex — blue */}
        <path d="M93 65 Q112 55 130 53 Q148 55 167 65 Q161 77 149 82 Q139 86 130 86 Q121 86 111 82 Q99 77 93 65Z"
          fill="rgba(59,130,246,0.14)" stroke="rgba(59,130,246,0.45)" strokeWidth="1.5"/>

        {/* Thalamus — purple */}
        <ellipse cx="121" cy="118" rx="12" ry="10" fill="rgba(139,92,246,0.18)" stroke="rgba(139,92,246,0.52)" strokeWidth="1.5"/>
        <ellipse cx="139" cy="118" rx="12" ry="10" fill="rgba(139,92,246,0.14)" stroke="rgba(139,92,246,0.38)" strokeWidth="1.2"/>

        {/* Basal Ganglia — red, PRIMARY PD region */}
        <ellipse cx="115" cy="105" rx="15" ry="12" fill="rgba(239,68,68,0.24)" stroke="rgba(239,68,68,0.68)" strokeWidth="2" filter="url(#sg)"/>
        <ellipse cx="145" cy="105" rx="15" ry="12" fill="rgba(239,68,68,0.19)" stroke="rgba(239,68,68,0.52)" strokeWidth="1.8"/>

        {/* Substantia Nigra — amber, KEY dopamine area */}
        <ellipse cx="130" cy="150" rx="14" ry="7" fill="rgba(245,158,11,0.33)" stroke="rgba(245,158,11,0.82)" strokeWidth="2.2" filter="url(#sg)"/>

        {/* Cerebellum */}
        <path d="M89 155 Q103 147 117 155 Q130 163 143 155 Q157 147 171 155 Q171 170 130 174 Q89 170 89 155Z"
          fill="rgba(16,185,129,0.11)" stroke="rgba(16,185,129,0.33)" strokeWidth="1.2"/>

        {/* Brainstem */}
        <rect x="122" y="170" width="16" height="22" rx="7" fill="rgba(100,116,139,0.17)" stroke="rgba(100,116,139,0.30)" strokeWidth="1.2"/>

        {/* Pulse — Basal Ganglia */}
        <circle cx="115" cy="105" r="15" fill="none" stroke="rgba(239,68,68,0.38)" strokeWidth="1.5">
          <animate attributeName="r" values="15;23;15" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="145" cy="105" r="15" fill="none" stroke="rgba(239,68,68,0.28)" strokeWidth="1">
          <animate attributeName="r" values="15;22;15" dur="2s" begin="0.4s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" begin="0.4s" repeatCount="indefinite"/>
        </circle>

        {/* Pulse — Substantia Nigra */}
        <circle cx="130" cy="150" r="9" fill="none" stroke="rgba(245,158,11,0.58)" strokeWidth="1.5">
          <animate attributeName="r" values="9;16;9" dur="2.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.65;0;0.65" dur="2.5s" repeatCount="indefinite"/>
        </circle>

        {/* LEFT labels */}
        <line x1="18" y1="105" x2="100" y2="105" stroke="rgba(239,68,68,0.55)" strokeWidth="1.2" strokeDasharray="4 2"/>
        <circle cx="18" cy="105" r="3" fill="#EF4444"/>
        <text x="13" y="101" textAnchor="end" fill="#DC2626" fontSize="9" fontWeight="700">Basal</text>
        <text x="13" y="113" textAnchor="end" fill="#DC2626" fontSize="9" fontWeight="700">Ganglia</text>

        <line x1="-4" y1="150" x2="116" y2="150" stroke="rgba(245,158,11,0.65)" strokeWidth="1.2" strokeDasharray="4 2"/>
        <circle cx="-4" cy="150" r="3" fill="#F59E0B"/>
        <text x="-9" y="146" textAnchor="end" fill="#D97706" fontSize="9" fontWeight="700">Substantia</text>
        <text x="-9" y="158" textAnchor="end" fill="#D97706" fontSize="9" fontWeight="700">Nigra ⚠</text>

        {/* RIGHT labels */}
        <line x1="179" y1="70" x2="213" y2="70" stroke="rgba(59,130,246,0.55)" strokeWidth="1.2" strokeDasharray="4 2"/>
        <circle cx="213" cy="70" r="3" fill="#3B82F6"/>
        <text x="218" y="67" fill="#1D4ED8" fontSize="9" fontWeight="700">Motor</text>
        <text x="218" y="79" fill="#1D4ED8" fontSize="9" fontWeight="700">Cortex</text>

        <line x1="151" y1="118" x2="213" y2="118" stroke="rgba(139,92,246,0.55)" strokeWidth="1.2" strokeDasharray="4 2"/>
        <circle cx="213" cy="118" r="3" fill="#8B5CF6"/>
        <text x="218" y="115" fill="#6D28D9" fontSize="9" fontWeight="700">Thalamus</text>
        <text x="218" y="127" fill="#6D28D9" fontSize="8">(affected)</text>

        <line x1="171" y1="162" x2="213" y2="162" stroke="rgba(16,185,129,0.55)" strokeWidth="1.2" strokeDasharray="4 2"/>
        <circle cx="213" cy="162" r="3" fill="#10B981"/>
        <text x="218" y="159" fill="#047857" fontSize="9" fontWeight="700">Cerebellum</text>
        <text x="218" y="171" fill="#047857" fontSize="8">(normal)</text>

        {/* Face */}
        <ellipse cx="107" cy="180" rx="9" ry="6" fill="white" stroke="#C5D4EC" strokeWidth="1.2"/>
        <circle cx="108" cy="180" r="3.5" fill="#374151"/>
        <circle cx="109" cy="179" r="1.2" fill="white"/>
        <ellipse cx="153" cy="180" rx="9" ry="6" fill="white" stroke="#C5D4EC" strokeWidth="1.2"/>
        <circle cx="154" cy="180" r="3.5" fill="#374151"/>
        <circle cx="155" cy="179" r="1.2" fill="white"/>
        <path d="M99 173 Q107 169 115 173" stroke="#9FB8CC" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <path d="M145 173 Q153 169 161 173" stroke="#9FB8CC" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <path d="M126 196 Q130 189 134 196 Q132 203 130 205 Q128 203 126 196Z" fill="#DCE8F5" stroke="#C5D4EC" strokeWidth="1"/>
        <path d="M118 216 Q130 224 142 216" stroke="#C5D4EC" strokeWidth="1.5" fill="none" strokeLinecap="round"/>

        {/* Ears */}
        <path d="M45 108 Q37 115 37 126 Q37 136 45 142 Q51 136 49 126 Q51 115 45 108Z" fill="url(#hg)" stroke="#C5D4EC" strokeWidth="1.5"/>
        <path d="M215 108 Q223 115 223 126 Q223 136 215 142 Q209 136 211 126 Q209 115 215 108Z" fill="url(#hg)" stroke="#C5D4EC" strokeWidth="1.5"/>

        {/* PD center marker */}
        <circle cx="130" cy="118" r="6" fill="rgba(239,68,68,0.88)" stroke="white" strokeWidth="2">
          <animate attributeName="r" values="5;7;5" dur="1.5s" repeatCount="indefinite"/>
        </circle>
        <text x="130" y="121.5" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="800">PD</text>
      </svg>
    </div>
  )
}

// ── Sessions Bar Chart ─────────────────────────────────────────────────────────
function SessionsBarChart({ data }: { data: Array<{ label: string; val: number }> }) {
  const VW = 300            // fixed viewBox width — scales proportionally at any card size
  const VH = 110
  const barH_max = 70       // max bar height in viewBox units
  const labelY   = VH - 6
  const n   = data.length
  const max = Math.max(...data.map(d => d.val), 1)
  const barW  = n > 0 ? Math.floor((VW * 0.72) / n) : 40
  const gap   = n > 1 ? Math.floor((VW * 0.28) / (n - 1)) : 0
  const totalBarZone = n * barW + (n - 1) * gap
  const startX = (VW - totalBarZone) / 2

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="bar-chart-svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6"/>
          <stop offset="100%" stopColor="#93C5FD"/>
        </linearGradient>
        <linearGradient id="barGF" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BFDBFE"/>
          <stop offset="100%" stopColor="#DBEAFE"/>
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const isLast = i === data.length - 1
        const bh  = Math.max((d.val / max) * barH_max, 3)
        const x   = startX + i * (barW + gap)
        const y   = barH_max + 8 - bh           // 8px top padding
        const cx  = x + barW / 2
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={barW} height={bh} rx={4}
              fill={isLast ? 'url(#barG)' : 'url(#barGF)'}/>
            {isLast && d.val > 0 && (
              <text x={cx} y={y - 5} textAnchor="middle"
                fill="#1D4ED8" fontSize="9" fontWeight="700">{d.val}</text>
            )}
            <text x={cx} y={labelY} textAnchor="middle"
              fill="#94A3B8" fontSize="7.5">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Score Ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const r = size * 0.36
  const cx = size / 2
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ
  const color = scoreColor(score)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#E2E8F0" strokeWidth={size * 0.1}/>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={size * 0.1}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}/>
      <text x={cx} y={cx + 4} textAnchor="middle" fill={color} fontSize={size * 0.22} fontWeight="700">{score}</text>
    </svg>
  )
}

// ── Nav Icons ──────────────────────────────────────────────────────────────────
function IconDashboard() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
}
function IconPatients() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function IconMic() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
}
function IconBrain() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.14z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.14z"/></svg>
}
function IconSettings() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}
function IconCheck() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
}
function IconAlert() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
}
function IconUpload() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
}
function IconPlay() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
}
function IconRefresh() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
}
function IconPlus() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function IconTrash() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
}
function IconSearch() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
function IconBell() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}

const NAV_ITEMS: { id: Page; label: string; Icon: () => React.ReactElement }[] = [
  { id: 'dashboard', label: 'Dashboard',      Icon: IconDashboard },
  { id: 'patients',  label: 'Patients',        Icon: IconPatients  },
  { id: 'analysis',  label: 'Voice Analysis',  Icon: IconMic       },
  { id: 'training',  label: 'Model Training',  Icon: IconBrain     },
  { id: 'settings',  label: 'Settings',        Icon: IconSettings  },
]

// ── DASHBOARD PAGE ─────────────────────────────────────────────────────────────
function DashboardPage({ sessions, patients, dashData, onNavigate }: {
  sessions: SessionRecord[]
  patients: Patient[]
  dashData: DashboardData | null
  onNavigate: (p: Page) => void
}) {
  const stats = dashData?.stats
  const totalPatients  = stats?.total_patients  ?? patients.length
  const totalSessions  = stats?.total_sessions  ?? patients.reduce((a, p) => a + p.sessionsCount, 0)
  const inTraining     = stats?.training_patients ?? patients.filter(p => p.inTraining).length
  const avgScore       = stats?.avg_health_score  ?? Math.round(patients.reduce((a, p) => a + p.score, 0) / (patients.length || 1))
  const thisWeek       = stats?.sessions_this_week ?? 0

  const chartData: Array<{ label: string; val: number }> = dashData?.weeklyChart?.length
    ? dashData.weeklyChart.map(w => ({ label: w.week_label, val: w.session_count }))
    : CHART_DATA

  const bm = dashData?.brainMetrics
  const tremorScore    = bm?.tremor_score     ?? 'High'
  const dopamineAct    = bm?.dopamine_activity ?? 'Low'
  const motorFunc      = bm?.motor_function    ?? 'Moderate'
  const cogScore       = bm?.cognitive_score   ?? 'Normal'

  const next: ApiAppointment | null = dashData?.nextAppointment ?? null
  const nextPatient = next?.patients

  return (
    <div className="dashboard">
      {/* Top stats */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#EFF6FF', color: '#3B82F6' }}>
            <IconPatients/>
          </div>
          <div>
            <p className="stat-value">{totalPatients}</p>
            <p className="stat-label">Total Patients</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#F0FDF4', color: '#10B981' }}>
            <IconMic/>
          </div>
          <div>
            <p className="stat-value">{totalSessions}</p>
            <p className="stat-label">Voice Sessions</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#F5F3FF', color: '#8B5CF6' }}>
            <IconBrain/>
          </div>
          <div>
            <p className="stat-value">{inTraining}</p>
            <p className="stat-label">In Training Set</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: '#FFFBEB', color: '#F59E0B' }}>
            <IconDashboard/>
          </div>
          <div>
            <p className="stat-value">{avgScore}%</p>
            <p className="stat-label">Avg Health Score</p>
          </div>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="dash-grid">
        {/* Left: Brain + brain metrics */}
        <div className="dash-col dash-col-left">
          <div className="card brain-card">
            <div className="card-header">
              <h3 className="card-title">Brain Activity Map</h3>
              <span className="badge-live">
                <span className="live-dot"/>Live
              </span>
            </div>
            <BrainVisualization/>
            <div className="brain-metrics">
              <div className="bm-item">
                <span className="bm-dot" style={{ background: '#EF4444' }}/>
                <span className="bm-label">Tremor Score</span>
                <span className="bm-value" style={{ color: '#EF4444' }}>{tremorScore}</span>
              </div>
              <div className="bm-item">
                <span className="bm-dot" style={{ background: '#F59E0B' }}/>
                <span className="bm-label">Dopamine Activity</span>
                <span className="bm-value" style={{ color: '#F59E0B' }}>{dopamineAct}</span>
              </div>
              <div className="bm-item">
                <span className="bm-dot" style={{ background: '#3B82F6' }}/>
                <span className="bm-label">Motor Function</span>
                <span className="bm-value" style={{ color: '#3B82F6' }}>{motorFunc}</span>
              </div>
              <div className="bm-item">
                <span className="bm-dot" style={{ background: '#10B981' }}/>
                <span className="bm-label">Cognitive Score</span>
                <span className="bm-value" style={{ color: '#10B981' }}>{cogScore}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Chart + recent sessions */}
        <div className="dash-col dash-col-center">
          <div className="card chart-card">
            <div className="card-header">
              <h3 className="card-title">Training Sessions Overview</h3>
              <span className="chart-legend">
                <span className="legend-dot" style={{ background: '#3B82F6' }}/> Sessions
              </span>
            </div>
            <div className="chart-summary">
              <span className="chart-big">{thisWeek}</span>
              <span className="chart-sub">this week</span>
            </div>
            <SessionsBarChart data={chartData}/>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Recent Analyses</h3>
              <button className="see-all-btn" onClick={() => onNavigate('analysis')}>See All</button>
            </div>
            <div className="session-list">
              {sessions.map(s => (
                <div key={s.id} className="session-item">
                  <div className="s-avatar" style={{ background: s.color }}>
                    {s.initials}
                  </div>
                  <div className="s-info">
                    <p className="s-name">{s.patientName}</p>
                    <p className="s-date">{s.date}</p>
                  </div>
                  <div className={`s-badge ${s.result}`}>
                    {s.result === 'healthy' ? <IconCheck/> : <IconAlert/>}
                    {s.result === 'healthy' ? 'Healthy' : "Parkinson's"}
                  </div>
                  <span className="s-conf">{(s.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Upcoming + patients */}
        <div className="dash-col dash-col-right">
          <div className="card upcoming-card">
            <div className="card-header">
              <h3 className="card-title">Next Session</h3>
            </div>
            {next && nextPatient ? (
              <div className="upcoming-body">
                <div className="up-avatar" style={{ background: nextPatient.avatar_color ?? '#DDD6FE' }}>
                  {nextPatient.initials}
                </div>
                <p className="up-name">{nextPatient.full_name}</p>
                <p className="up-role">Neurology Patient — {stageLabel(nextPatient.stage)}</p>
                <div className="up-time">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {new Date(next.scheduled_at).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <button className="btn-primary" onClick={() => onNavigate('analysis')}>
                  <IconPlay/> Start Analysis
                </button>
              </div>
            ) : (
              <div className="upcoming-body">
                <div className="up-empty">No upcoming sessions scheduled.</div>
                <button className="btn-primary" onClick={() => onNavigate('analysis')}>
                  <IconPlay/> New Analysis
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">My Patients</h3>
              <button className="see-all-btn" onClick={() => onNavigate('patients')}>See All</button>
            </div>
            <div className="patient-mini-list">
              {patients.slice(0, 4).map(p => (
                <div key={p.id} className="pm-item">
                  <div className="pm-avatar" style={{ background: p.color }}>{p.initials}</div>
                  <div className="pm-info">
                    <p className="pm-name">{p.name}</p>
                    <p className="pm-sub">{stageLabel(p.stage)}</p>
                  </div>
                  <ScoreRing score={p.score} size={44}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 15
const TRAINING_PANEL_PAGE = 8

// ── Training Dataset panel list with show-more ─────────────────────────────────
function TrainingPanelList({ trainingPatients, onToggle }: {
  trainingPatients: Patient[]
  onToggle: (id: string) => void
}) {
  const [visible, setVisible] = useState(TRAINING_PANEL_PAGE)
  const shown   = trainingPatients.slice(0, visible)
  const hasMore = visible < trainingPatients.length

  return (
    <div className="training-list">
      {trainingPatients.length === 0 && (
        <div className="empty-state">
          <p>No patients in training dataset.</p>
          <p>Toggle patients from the left panel to add them.</p>
        </div>
      )}
      {shown.map(p => (
        <div key={p.id} className="training-item">
          <div className="ti-avatar" style={{ background: p.color }}>{p.initials}</div>
          <div className="ti-info">
            <p className="ti-name">{p.name}</p>
            <p className="ti-sub">{p.sessionsCount} sessions · {stageLabel(p.stage)}</p>
            <div className="ti-bar-bg">
              <div className="ti-bar-fill" style={{ width: `${Math.min(100,(p.sessionsCount/20)*100)}%`, background: scoreColor(p.score) }}/>
            </div>
          </div>
          <button className="icon-btn" onClick={() => onToggle(p.id)} title="Remove from training">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ))}
      {hasMore && (
        <div style={{ padding: '10px 16px', textAlign: 'center' }}>
          <button className="btn-ghost" style={{ width: '100%', fontSize: '13px' }}
            onClick={() => setVisible(v => v + TRAINING_PANEL_PAGE)}>
            Load More ({visible} of {trainingPatients.length})
          </button>
        </div>
      )}
    </div>
  )
}

// ── PATIENTS PAGE ──────────────────────────────────────────────────────────────
function PatientsPage({ patients: appPatients, setPatients: setAppPatients }: {
  patients: Patient[]
  setPatients: React.Dispatch<React.SetStateAction<Patient[]>>
}) {
  const [rows,      setRows]      = useState<Patient[]>([])
  const [total,     setTotal]     = useState(0)
  const [offset,    setOffset]    = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch]       = useState('')
  const [showAdd, setShowAdd]     = useState(false)
  const [newName, setNewName]     = useState('')
  const [newAge,  setNewAge]      = useState('')
  const [newStage, setNewStage]   = useState<PatientStage>('early')

  // Initial load
  useEffect(() => {
    if (!DOCTOR_ID) { setRows(appPatients); setTotal(appPatients.length); return }
    api.patients.list(DOCTOR_ID, PAGE_SIZE, 0)
      .then(res => { setRows(res.data.map(mapApiPatient)); setTotal(res.total); setOffset(PAGE_SIZE) })
      .catch(() => { setRows(appPatients); setTotal(appPatients.length) })
  }, [])

  const loadMore = async () => {
    if (!DOCTOR_ID || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await api.patients.list(DOCTOR_ID, PAGE_SIZE, offset)
      setRows(prev => [...prev, ...res.data.map(mapApiPatient)])
      setOffset(prev => prev + PAGE_SIZE)
    } finally { setLoadingMore(false) }
  }

  const hasMore = rows.length < total

  const filtered = rows.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const trainingPatients = rows.filter(p => p.inTraining)

  const setPatients = (fn: React.SetStateAction<Patient[]>) => {
    setRows(fn)
    setAppPatients(fn)
  }

  const toggleTraining = async (id: string) => {
    const patient = rows.find(p => p.id === id)
    if (!patient) return
    const next = !patient.inTraining
    // Optimistic update
    setPatients(prev => prev.map(p => p.id === id ? { ...p, inTraining: next } : p))
    if (DOCTOR_ID) {
      api.patients.toggleTraining(id, next).catch(err => {
        console.error('[toggleTraining] API error:', err.message)
        // Rollback
        setPatients(prev => prev.map(p => p.id === id ? { ...p, inTraining: !next } : p))
      })
    }
  }

  const addPatient = async () => {
    if (!newName.trim() || !newAge) return
    const color    = AVATAR_COLORS[rows.length % AVATAR_COLORS.length]
    const initials = newName.trim().split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase()

    if (DOCTOR_ID) {
      try {
        const created = await api.patients.create({
          doctor_id: DOCTOR_ID, full_name: newName.trim(),
          age: Number(newAge), stage: newStage, avatar_color: color,
        })
        setPatients(prev => [mapApiPatient({ ...created, sessions_count: 0, last_session_at: null, last_result: null }), ...prev])
      } catch (err: unknown) {
        alert(`Could not add patient: ${(err as Error).message}`)
        return
      }
    } else {
      // Demo mode — local only
      const np: Patient = {
        id: Date.now().toString(), name: newName.trim(), age: Number(newAge),
        stage: newStage, lastSession: '—', sessionsCount: 0, inTraining: false,
        initials, score: 80, color, gender: 'M',
      }
      setPatients(prev => [np, ...prev])
    }
    setNewName(''); setNewAge(''); setNewStage('early'); setShowAdd(false)
  }

  const removePatient = async (id: string) => {
    setPatients(prev => prev.filter(p => p.id !== id))
    if (DOCTOR_ID) {
      api.patients.delete(id).catch(err => console.error('[removePatient]', err.message))
    }
  }

  return (
    <div className="patients-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Patient Management</h2>
          <p className="page-sub">{total} total patients · {trainingPatients.length} in training dataset</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <IconPlus/> Add Patient
        </button>
      </div>

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Add New Patient</h3>
            <div className="form-group">
              <label>Full Name</label>
              <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. John Smith"/>
            </div>
            <div className="form-group">
              <label>Age</label>
              <input className="form-input" type="number" value={newAge} onChange={e => setNewAge(e.target.value)} placeholder="e.g. 68"/>
            </div>
            <div className="form-group">
              <label>Stage</label>
              <select className="form-input" value={newStage} onChange={e => setNewStage(e.target.value as PatientStage)}>
                <option value="early">Early (Stage 1–2)</option>
                <option value="moderate">Moderate (Stage 3)</option>
                <option value="advanced">Advanced (Stage 4–5)</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" onClick={addPatient}>Add Patient</button>
            </div>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="patients-panels">
        {/* Panel 1 — All Patients */}
        <div className="panel card">
          <div className="panel-header">
            <h3 className="panel-title">
              <IconPatients/> All Patients
              <span className="panel-count">{search ? filtered.length : total}</span>
            </h3>
            <div className="search-box">
              <IconSearch/>
              <input
                className="search-input"
                placeholder="Search patients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="patient-table-wrap">
            <table className="patient-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Age</th>
                  <th>Stage</th>
                  <th>Sessions</th>
                  <th>Last Visit</th>
                  <th>Score</th>
                  <th>Training</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="table-patient">
                        <div className="t-avatar" style={{ background: p.color }}>{p.initials}</div>
                        <span className="t-name">{p.name}</span>
                      </div>
                    </td>
                    <td className="t-muted">{p.age}</td>
                    <td>
                      <span className={`stage-badge stage-${p.stage}`}>{stageLabel(p.stage)}</span>
                    </td>
                    <td className="t-muted">{p.sessionsCount}</td>
                    <td className="t-muted">{p.lastSession}</td>
                    <td>
                      <span className="score-chip" style={{ color: scoreColor(p.score), background: `${scoreColor(p.score)}18` }}>
                        {p.score}%
                      </span>
                    </td>
                    <td>
                      <button
                        className={`toggle-btn ${p.inTraining ? 'on' : ''}`}
                        onClick={() => toggleTraining(p.id)}
                        title={p.inTraining ? 'Remove from training' : 'Add to training'}
                      >
                        {p.inTraining ? 'In Training' : 'Add'}
                      </button>
                    </td>
                    <td>
                      <button className="icon-btn danger" onClick={() => removePatient(p.id)} title="Remove patient">
                        <IconTrash/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!search && hasMore && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid #F1F5F9', textAlign: 'center' }}>
              <button className="btn-ghost" onClick={loadMore} disabled={loadingMore} style={{ width: '100%' }}>
                {loadingMore ? 'Loading...' : `Load More (${rows.length} of ${total})`}
              </button>
            </div>
          )}
        </div>

        {/* Panel 2 — Training Dataset */}
        <div className="panel card training-panel">
          <div className="panel-header">
            <h3 className="panel-title">
              <IconBrain/> Training Dataset
              <span className="panel-count">{trainingPatients.length}</span>
            </h3>
            <span className="dataset-info">{trainingPatients.reduce((a,p)=>a+p.sessionsCount,0)} voice samples</span>
          </div>
          <TrainingPanelList trainingPatients={trainingPatients} onToggle={toggleTraining} />
          <div className="panel-footer">
            <div className="dataset-stats">
              <div className="ds-stat">
                <p className="ds-num">{trainingPatients.filter(p=>p.stage==='early').length}</p>
                <p className="ds-label">Early Stage</p>
              </div>
              <div className="ds-stat">
                <p className="ds-num">{trainingPatients.filter(p=>p.stage==='moderate').length}</p>
                <p className="ds-label">Moderate</p>
              </div>
              <div className="ds-stat">
                <p className="ds-num">{trainingPatients.filter(p=>p.stage==='advanced').length}</p>
                <p className="ds-label">Advanced</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Test Samples Section ──────────────────────────────────────────────────────
const SAMPLES = [
  { id: 'h1', label: 'Healthy', kind: 'healthy' as const, src: '/samples/healthy/healthy_1.wav', name: 'Sample HC-1' },
  { id: 'h2', label: 'Healthy', kind: 'healthy' as const, src: '/samples/healthy/healthy_2.wav', name: 'Sample HC-2' },
  { id: 'h3', label: 'Healthy', kind: 'healthy' as const, src: '/samples/healthy/healthy_3.wav', name: 'Sample HC-3' },
  { id: 'h4', label: 'Healthy', kind: 'healthy' as const, src: '/samples/healthy/healthy_4.wav', name: 'Sample HC-4' },
  { id: 'h5', label: 'Healthy', kind: 'healthy' as const, src: '/samples/healthy/healthy_5.wav', name: 'Sample HC-5' },
  { id: 'p1', label: "Parkinson's", kind: 'parkinson' as const, src: '/samples/pd/pd_1.wav', name: 'Sample PD-1' },
  { id: 'p2', label: "Parkinson's", kind: 'parkinson' as const, src: '/samples/pd/pd_2.wav', name: 'Sample PD-2' },
  { id: 'p3', label: "Parkinson's", kind: 'parkinson' as const, src: '/samples/pd/pd_3.wav', name: 'Sample PD-3' },
  { id: 'p4', label: "Parkinson's", kind: 'parkinson' as const, src: '/samples/pd/pd_4.wav', name: 'Sample PD-4' },
  { id: 'p5', label: "Parkinson's", kind: 'parkinson' as const, src: '/samples/pd/pd_5.wav', name: 'Sample PD-5' },
]

function TestSamplesSection() {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const togglePlay = (id: string, src: string) => {
    if (playing === id) {
      audioRef.current?.pause()
      setPlaying(null)
    } else {
      if (audioRef.current) audioRef.current.pause()
      const a = new Audio(src)
      a.onended = () => setPlaying(null)
      a.play()
      audioRef.current = a
      setPlaying(id)
    }
  }

  const download = (src: string, name: string) => {
    const a = document.createElement('a')
    a.href = src
    a.download = `${name}.wav`
    a.click()
  }

  const healthy = SAMPLES.filter(s => s.kind === 'healthy')
  const pd      = SAMPLES.filter(s => s.kind === 'parkinson')

  return (
    <div className="test-samples-section">
      <div className="ts-header">
        <div className="ts-header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div>
          <h3 className="ts-title">Test Voice Samples</h3>
          <p className="ts-sub">Real recordings from our dataset — use these to verify the model before uploading your own audio</p>
        </div>
      </div>

      <div className="ts-grid">
        {/* Healthy column */}
        <div className="ts-col">
          <div className="ts-col-label healthy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Healthy Controls
          </div>
          {healthy.map(s => (
            <SampleRow key={s.id} sample={s} isPlaying={playing === s.id}
              onPlay={() => togglePlay(s.id, s.src)}
              onDownload={() => download(s.src, s.name)}/>
          ))}
        </div>

        {/* PD column */}
        <div className="ts-col">
          <div className="ts-col-label parkinson">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Parkinson's Patients
          </div>
          {pd.map(s => (
            <SampleRow key={s.id} sample={s} isPlaying={playing === s.id}
              onPlay={() => togglePlay(s.id, s.src)}
              onDownload={() => download(s.src, s.name)}/>
          ))}
        </div>
      </div>
    </div>
  )
}

function SampleRow({ sample, isPlaying, onPlay, onDownload }: {
  sample: typeof SAMPLES[0]
  isPlaying: boolean
  onPlay: () => void
  onDownload: () => void
}) {
  return (
    <div className={`sample-row ${sample.kind}`}>
      <button className={`sample-play ${isPlaying ? 'playing' : ''}`} onClick={onPlay} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        )}
      </button>

      <div className="sample-wave">
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className={`sw-bar ${isPlaying ? 'animate' : ''}`}
            style={{ animationDelay: `${i * 0.06}s`, height: `${6 + Math.sin(i * 1.1) * 5 + Math.random() * 6}px` }}/>
        ))}
      </div>

      <span className="sample-name">{sample.name}</span>

      <span className={`sample-badge ${sample.kind}`}>
        {sample.kind === 'healthy' ? 'HC' : 'PD'}
      </span>

      <button className="sample-dl" onClick={onDownload} title="Download">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
  )
}

// ── Recent Sessions with pagination ───────────────────────────────────────────
const SESSION_PAGE = 8

function RecentSessionsList() {
  const [rows,    setRows]    = useState<SessionRecord[]>([])
  const [offset,  setOffset]  = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    if (!DOCTOR_ID) return
    setLoading(true)
    api.sessions.list(DOCTOR_ID, undefined, SESSION_PAGE, 0)
      .then(list => {
        setRows(list.map(mapApiSession))
        setOffset(list.length)
        setHasMore(list.length === SESSION_PAGE)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const loadMore = async () => {
    if (loading || !hasMore || !DOCTOR_ID) return
    setLoading(true)
    try {
      const list = await api.sessions.list(DOCTOR_ID, undefined, SESSION_PAGE, offset)
      setRows(prev => [...prev, ...list.map(mapApiSession)])
      setOffset(prev => prev + list.length)
      setHasMore(list.length === SESSION_PAGE)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <h3 className="card-title">Recent Sessions</h3>
        {loading && <span className="spinner" style={{ width:14, height:14, borderWidth:2 }}/>}
      </div>
      {rows.length === 0 && !loading && (
        <div style={{ padding:'24px 20px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
          No sessions yet. Run your first analysis above.
        </div>
      )}
      <div className="session-list">
        {rows.map(s => (
          <div key={s.id} className="session-item">
            <div className="s-avatar" style={{ background: s.color }}>{s.initials}</div>
            <div className="s-info">
              <p className="s-name">{s.patientName}</p>
              <p className="s-date">{s.date}</p>
            </div>
            <div className={`s-badge ${s.result}`}>
              {s.result === 'healthy' ? <IconCheck/> : <IconAlert/>}
              {s.result === 'healthy' ? 'Healthy' : "PD"}
            </div>
            <span className="s-conf">{(s.confidence * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      {hasMore && (
        <div style={{ padding:'8px 16px 16px' }}>
          <button className="btn-ghost full-w" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── ANALYSIS PAGE ──────────────────────────────────────────────────────────────
function AnalysisPage({ patients, setSessions }: {
  patients: Patient[]
  setSessions: React.Dispatch<React.SetStateAction<SessionRecord[]>>
}) {
  const [tab, setTab] = useState<Tab>('upload')
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [recording, setRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recSeconds, setRecSeconds] = useState(0)
  const [selectedPatient, setSelectedPatient] = useState('')
  const [fileQueue, setFileQueue] = useState<QueueItem[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const reset = () => {
    setStatus('idle'); setResult(null); setShowModal(false); setProgress(0)
    setAudioFile(null); setAudioBlob(null); setFileQueue([]); setBatchRunning(false)
    if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); setRecSeconds(0)
    if (progressRef.current) clearInterval(progressRef.current)
  }

  const handleFiles = (files: FileList | File[]) => {
    if (batchRunning) return
    const valid = Array.from(files).filter(f => f.type.startsWith('audio/'))
    if (!valid.length) return
    setFileQueue(prev => [
      ...prev,
      ...valid.map(f => ({ id: `${Date.now()}-${Math.random()}-${f.name}`, file: f, status: 'pending' as const, expanded: false }))
    ])
  }

  const toggleExpanded = (id: string) =>
    setFileQueue(prev => prev.map(q => {
      if (q.id === id) return { ...q, expanded: !q.expanded }
      return { ...q, expanded: false }
    }))

  const removeFromQueue = (id: string) =>
    setFileQueue(prev => prev.filter(q => q.id !== id))

  const analyzeBatch = useCallback(async () => {
    if (batchRunning) return
    const queue = fileQueue
    if (!queue.some(q => q.status === 'pending')) return
    setBatchRunning(true)
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].status !== 'pending') continue
      setFileQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'processing' } : q))
      try {
        const data = await api.predict(queue[i].file, selectedPatient || undefined, DOCTOR_ID || undefined)
        const res: AnalysisResult = {
          prediction:     data.prediction,
          confidence:     data.confidence,
          message:        data.message,
          voice_model:    data.voice_model    ?? null,
          research_model: data.research_model ?? null,
        }
        // Accordion: expand this one, collapse others
        setFileQueue(prev => prev.map((q, idx) => {
          if (idx === i) return { ...q, status: 'done', result: res, expanded: true }
          return { ...q, expanded: false }
        }))
        const patient = patients.find(p => p.id === selectedPatient)
        if (patient) {
          setSessions(prev => [{
            id: data.session_id ?? Date.now().toString(),
            patientName: patient.name, initials: patient.initials,
            color: patient.color, date: 'Just now',
            result: data.prediction, confidence: data.confidence,
          }, ...prev])
        }
      } catch (err: unknown) {
        setFileQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'error', errorMsg: (err as Error).message } : q))
      }
    }
    setBatchRunning(false)
  }, [fileQueue, batchRunning, selectedPatient, patients, setSessions])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr; chunksRef.current = []
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start(); setRecording(true); setRecSeconds(0)
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000)
    } catch { alert('Microphone access denied.') }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop(); setRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const analyze = useCallback(async () => {
    const source = tab === 'upload'
      ? audioFile
      : audioBlob ? new File([audioBlob], 'recording.webm', { type: 'audio/webm' }) : null
    if (!source) return
    setStatus('loading'); setResult(null); setShowModal(false); setProgress(0)

    // Animated progress bar
    progressRef.current = setInterval(() => {
      setProgress(prev => prev >= 85 ? 85 : prev + Math.random() * 12)
    }, 400)

    try {
      const data = await api.predict(source, selectedPatient || undefined, DOCTOR_ID || undefined)
      if (progressRef.current) clearInterval(progressRef.current)
      setProgress(100)

      const analysisResult: AnalysisResult = {
        prediction:     data.prediction,
        confidence:     data.confidence,
        message:        data.message,
        voice_model:    data.voice_model    ?? null,
        research_model: data.research_model ?? null,
      }
      // short pause so 100% bar is visible, then show modal
      setTimeout(() => {
        setResult(analysisResult)
        setStatus(data.prediction)
        setShowModal(true)
      }, 450)

      // Add to recent sessions list in UI
      const patient = patients.find(p => p.id === selectedPatient)
      if (patient) {
        setSessions(prev => [{
          id:          data.session_id ?? Date.now().toString(),
          patientName: patient.name,
          initials:    patient.initials,
          color:       patient.color,
          date:        'Just now',
          result:      data.prediction,
          confidence:  data.confidence,
        }, ...prev])
      }
    } catch (err: unknown) {
      if (progressRef.current) clearInterval(progressRef.current)
      setProgress(0); setStatus('idle')
      alert(`Could not reach the analysis server: ${(err as Error).message}`)
    }
  }, [tab, audioFile, audioBlob, selectedPatient, patients, setSessions])

  const hasAudio = tab === 'upload' ? !!audioFile : !!audioBlob
  const fmt = (s: number) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  return (
    <div className="analysis-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Voice Analysis</h2>
          <p className="page-sub">Upload or record a voice sample to detect Parkinson's indicators</p>
        </div>
      </div>

      <div className="analysis-grid">
        {/* Left: input */}
        <div className="analysis-left">
          {/* Patient selector */}
          <div className="card" style={{ padding: '20px', marginBottom: '16px' }}>
            <label className="form-label">Select Patient</label>
            <select className="form-input" value={selectedPatient} onChange={e => setSelectedPatient(e.target.value)}>
              <option value="">— Choose a patient —</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name} (Age {p.age})</option>
              ))}
            </select>
          </div>

          <div className="card">
            <div className="an-tabs">
              <button className={`an-tab ${tab==='upload'?'active':''}`} onClick={() => { reset(); setTab('upload') }}>
                <IconUpload/> Upload Audio
              </button>
              <button className={`an-tab ${tab==='record'?'active':''}`} onClick={() => { reset(); setTab('record') }}>
                <IconMic/> Record Voice
              </button>
            </div>

            <div className="an-body">
              {tab === 'upload' && (
                <>
                  {/* Drop zone — always visible for adding more */}
                  <div
                    className={`drop-zone ${dragOver ? 'drag-over' : ''} ${fileQueue.length > 0 ? 'compact' : ''}`}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
                    onClick={() => !batchRunning && fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: 'none' }}
                      onChange={e => e.target.files && handleFiles(e.target.files)}/>
                    <div className="drop-prompt">
                      <div className="drop-icon"><IconUpload/></div>
                      <p className="drop-text">{fileQueue.length > 0 ? 'Add more files' : 'Drop audio files here'}</p>
                      <p className="drop-sub">WAV · MP3 · FLAC · M4A — multiple files supported</p>
                    </div>
                  </div>

                  {/* File queue */}
                  {fileQueue.length > 0 && (
                    <div className="file-queue">
                      {fileQueue.map((item, idx) => (
                        <div key={item.id} className={`fq-item ${item.status}`}>
                          <div className="fq-icon-wrap"><IconMic/></div>
                          <div className="fq-info">
                            <span className="fq-name">{item.file.name}</span>
                            <span className="fq-size">{(item.file.size / 1024).toFixed(1)} KB</span>
                          </div>
                          <div className="fq-status-wrap">
                            {item.status === 'pending'    && <span className="fq-badge pending">Waiting</span>}
                            {item.status === 'processing' && <span className="fq-badge processing"><span className="spinner-sm"/>Analyzing…</span>}
                            {item.status === 'done'       && <span className={`fq-badge ${item.result?.prediction}`}>{item.result?.prediction === 'healthy' ? '✓ Healthy' : '⚠ PD'}</span>}
                            {item.status === 'error'      && <span className="fq-badge error">Error</span>}
                          </div>
                          {!batchRunning && item.status === 'pending' && (
                            <button className="fq-remove" onClick={() => removeFromQueue(item.id)}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          )}
                          {/* suppress unused idx warning */}
                          <span style={{ display: 'none' }}>{idx}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {tab === 'record' && (
                <div className="record-zone">
                  <div className={`mic-visual ${recording ? 'active' : ''}`}>
                    <div className="mic-rings"><span/><span/><span/></div>
                    <button className={`mic-btn ${recording ? 'recording' : ''}`}
                      onClick={recording ? stopRecording : startRecording}>
                      {recording
                        ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        : <IconMic/>}
                    </button>
                  </div>
                  {recording && (
                    <div className="rec-status"><span className="rec-dot"/><span>Recording — {fmt(recSeconds)}</span></div>
                  )}
                  {!recording && !audioBlob && <p className="rec-hint">Press to start recording</p>}
                  {audioBlob && !recording && (
                    <div className="rec-done">
                      <IconCheck/> Ready — {fmt(recSeconds)}
                      <button className="redo-btn" onClick={reset}><IconRefresh/> Re-record</button>
                    </div>
                  )}
                </div>
              )}

              {audioUrl && tab === 'record' && (
                <div className="audio-player">
                  <audio controls src={audioUrl}/>
                </div>
              )}
            </div>

            <div className="an-footer">
              {tab === 'upload' ? (
                <div className="batch-footer-row">
                  <button className="btn-primary full-w"
                    disabled={!fileQueue.some(q => q.status === 'pending') || batchRunning}
                    onClick={analyzeBatch}>
                    {batchRunning ? (
                      <><span className="spinner"/>&nbsp;Processing {fileQueue.filter(q=>q.status==='done'||q.status==='error').length}/{fileQueue.length}…</>
                    ) : (
                      <><IconSearch/>&nbsp;Analyze All{fileQueue.length > 0 ? ` (${fileQueue.filter(q=>q.status==='pending').length})` : ''}</>
                    )}
                  </button>
                  {fileQueue.length > 0 && !batchRunning && (
                    <button className="btn-ghost" onClick={reset} title="Clear all">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  )}
                </div>
              ) : (
                <button className="btn-primary full-w" disabled={!hasAudio || status==='loading'} onClick={analyze}>
                  {status === 'loading' ? (
                    <><span className="spinner"/>&nbsp;Analyzing voice patterns...</>
                  ) : (
                    <><IconSearch/>&nbsp;Analyze Voice</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: batch results OR placeholder+info */}
        <div className="analysis-right">
          {tab === 'upload' && fileQueue.length > 0 ? (
            <div className="batch-results-panel">
              {/* Summary bar */}
              <div className="batch-summary">
                <span className="batch-sum-title">Results</span>
                <div className="batch-sum-chips">
                  {fileQueue.filter(q=>q.status==='done'&&q.result?.prediction==='healthy').length > 0 && (
                    <span className="fq-badge healthy">{fileQueue.filter(q=>q.status==='done'&&q.result?.prediction==='healthy').length} Healthy</span>
                  )}
                  {fileQueue.filter(q=>q.status==='done'&&q.result?.prediction==='parkinson').length > 0 && (
                    <span className="fq-badge parkinson">{fileQueue.filter(q=>q.status==='done'&&q.result?.prediction==='parkinson').length} PD</span>
                  )}
                  {fileQueue.filter(q=>q.status==='pending').length > 0 && (
                    <span className="fq-badge pending">{fileQueue.filter(q=>q.status==='pending').length} Waiting</span>
                  )}
                  {fileQueue.filter(q=>q.status==='processing').length > 0 && (
                    <span className="fq-badge processing"><span className="spinner-sm"/>Analyzing</span>
                  )}
                </div>
              </div>

              {/* Collapsible result cards */}
              <div className="batch-cards">
                {fileQueue.map(item => (
                  <div key={item.id} className={`batch-card ${item.status === 'done' ? item.result?.prediction : item.status}`}>
                    {/* Card header — always visible */}
                    <button
                      className="batch-card-hdr"
                      onClick={() => item.status === 'done' && toggleExpanded(item.id)}
                      disabled={item.status !== 'done'}
                    >
                      <div className={`bc-verdict-dot ${item.status === 'done' ? item.result?.prediction : item.status}`}>
                        {item.status === 'done' && item.result?.prediction === 'healthy' && <IconCheck/>}
                        {item.status === 'done' && item.result?.prediction === 'parkinson' && <IconAlert/>}
                        {item.status === 'processing' && <span className="spinner-sm"/>}
                        {item.status === 'pending' && <IconMic/>}
                        {item.status === 'error' && <span style={{fontSize:'12px'}}>✕</span>}
                      </div>
                      <div className="bc-info">
                        <span className="bc-filename">{item.file.name}</span>
                        <span className="bc-meta">
                          {item.status === 'pending'    && 'Waiting…'}
                          {item.status === 'processing' && 'Analyzing…'}
                          {item.status === 'done'       && `${item.result?.prediction === 'healthy' ? 'No PD Detected' : 'PD Indicators Found'} · ${((item.result?.confidence ?? 0)*100).toFixed(1)}%`}
                          {item.status === 'error'      && (item.errorMsg ?? 'Analysis failed')}
                        </span>
                      </div>
                      {item.status === 'done' && (
                        <svg className={`bc-chevron ${item.expanded ? 'open' : ''}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      )}
                    </button>

                    {/* Expanded body — two model boxes */}
                    {item.status === 'done' && item.expanded && item.result && (
                      <div className="batch-card-body">
                        <div className="conf-row">
                          <span className="conf-label">Overall Confidence</span>
                          <span className="conf-value">{(item.result.confidence * 100).toFixed(1)}%</span>
                        </div>
                        <div className="conf-bar-bg">
                          <div className={`conf-bar-fill ${item.result.prediction}`} style={{ width: `${item.result.confidence * 100}%` }}/>
                        </div>

                        <div className="rm-models" style={{ padding: '12px 0 0', gap: '10px' }}>
                          {/* Voice Model */}
                          <div className={`rm-model-box ${item.result.voice_model?.error ? 'unavailable' : (item.result.voice_model?.prediction ?? 'unavailable')}`}>
                            <div className="rm-model-header">
                              <div className="rm-model-icon"><IconMic/></div>
                              <div>
                                <p className="rm-model-name">Voice Model <span className="rm-nb-tag">NB2&3</span></p>
                                <p className="rm-model-desc">59 features</p>
                              </div>
                              <span className={`rm-model-badge ${item.result.voice_model?.error ? 'unavailable' : (item.result.voice_model?.prediction ?? 'unavailable')}`}>
                                {item.result.voice_model?.error ? 'N/A' : item.result.voice_model?.prediction === 'healthy' ? 'Healthy' : 'PD'}
                              </span>
                            </div>
                            {item.result.voice_model && !item.result.voice_model.error && (
                              <div className="rm-model-conf">
                                <span className="rm-conf-label">Conf.</span>
                                <div className="conf-bar-bg" style={{ flex: 1 }}>
                                  <div className={`conf-bar-fill ${item.result.voice_model.prediction}`}
                                    style={{ width: `${(item.result.voice_model.confidence ?? 0) * 100}%` }}/>
                                </div>
                                <span className="rm-conf-pct">{((item.result.voice_model.confidence ?? 0) * 100).toFixed(1)}%</span>
                              </div>
                            )}
                          </div>

                          {/* Research Model */}
                          <div className={`rm-model-box ${item.result.research_model?.error ? 'unavailable' : (item.result.research_model?.prediction ?? 'unavailable')}`}>
                            <div className="rm-model-header">
                              <div className="rm-model-icon"><IconBrain/></div>
                              <div>
                                <p className="rm-model-name">Research Model <span className="rm-nb-tag">NB1</span></p>
                                <p className="rm-model-desc">59 features · voice recordings</p>
                              </div>
                              <span className={`rm-model-badge ${item.result.research_model?.error ? 'unavailable' : (item.result.research_model?.prediction ?? 'unavailable')}`}>
                                {item.result.research_model?.error ? 'N/A' : item.result.research_model?.prediction === 'healthy' ? 'Healthy' : 'PD'}
                              </span>
                            </div>
                            {item.result.research_model && !item.result.research_model.error ? (
                              <div className="rm-model-conf">
                                <span className="rm-conf-label">Conf.</span>
                                <div className="conf-bar-bg" style={{ flex: 1 }}>
                                  <div className={`conf-bar-fill ${item.result.research_model.prediction}`}
                                    style={{ width: `${(item.result.research_model.confidence ?? 0) * 100}%` }}/>
                                </div>
                                <span className="rm-conf-pct">{((item.result.research_model.confidence ?? 0) * 100).toFixed(1)}%</span>
                              </div>
                            ) : (
                              <p className="rm-model-err">{item.result.research_model?.error ?? 'Requires clinical-quality recording'}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="card result-placeholder">
                {status === 'loading' ? (
                  <div className="progress-placeholder">
                    <div className="progress-spinner-wrap">
                      <span className="progress-spinner-lg"/>
                    </div>
                    <p className="progress-label">Analyzing voice patterns…</p>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${progress}%` }}/>
                    </div>
                    <p className="progress-pct">{Math.round(progress)}%</p>
                  </div>
                ) : (
                  <>
                    <div className="placeholder-icon"><IconMic/></div>
                    <p className="placeholder-text">Analysis results will appear here</p>
                    <p className="placeholder-sub">Select a patient and provide an audio sample to begin</p>
                  </>
                )}
              </div>
              <RecentSessionsList/>
            </>
          )}
        </div>

      </div>
 
      {/* ── Results Modal ───────────────────────────────────────────────────── */}
      {showModal && result && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="results-modal" onClick={e => e.stopPropagation()}>
            <div className={`rm-header ${result.prediction}`}>
              <div className={`rm-icon ${result.prediction}`}>
                {result.prediction === 'healthy' ? <IconCheck/> : <IconAlert/>}
              </div>
              <div className="rm-header-text">
                <h2 className="rm-title">
                  {result.prediction === 'healthy' ? "No Parkinson's Detected" : "Parkinson's Indicators Found"}
                </h2>
                <p className="rm-sub">{result.message}</p>
              </div>
              <button className="rm-close" onClick={() => setShowModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
 
            <div className="rm-conf-section">
              <div className="conf-row">
                <span className="conf-label">Overall Confidence</span>
                <span className="conf-value">{(result.confidence * 100).toFixed(1)}%</span>
              </div>
              <div className="conf-bar-bg">
                <div className={`conf-bar-fill ${result.prediction}`} style={{ width: `${result.confidence * 100}%` }}/>
              </div>
            </div>
 
            <div className="rm-models">
              <div className={`rm-model-box ${result.voice_model?.error ? 'unavailable' : (result.voice_model?.prediction ?? 'unavailable')}`}>
                <div className="rm-model-header">
                  <div className="rm-model-icon"><IconMic/></div>
                  <div>
                    <p className="rm-model-name">Voice Recording Model <span className="rm-nb-tag">NB2&3</span></p>
                    <p className="rm-model-desc">Real voice recordings · 59 features</p>
                  </div>
                  <span className={`rm-model-badge ${result.voice_model?.error ? 'unavailable' : (result.voice_model?.prediction ?? 'unavailable')}`}>
                    {result.voice_model?.error ? 'N/A' : result.voice_model?.prediction === 'healthy' ? 'Healthy' : "Parkinson's"}
                  </span>
                </div>
                {result.voice_model && !result.voice_model.error ? (
                  <div className="rm-model-conf">
                    <span className="rm-conf-label">Confidence</span>
                    <div className="conf-bar-bg" style={{ flex: 1 }}>
                      <div className={`conf-bar-fill ${result.voice_model.prediction}`}
                        style={{ width: `${(result.voice_model.confidence ?? 0) * 100}%` }}/>
                    </div>
                    <span className="rm-conf-pct">{((result.voice_model.confidence ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                ) : (
                  <p className="rm-model-err">{result.voice_model?.error ?? 'Model unavailable'}</p>
                )}
              </div>
 
              <div className={`rm-model-box ${result.research_model?.error ? 'unavailable' : (result.research_model?.prediction ?? 'unavailable')}`}>
                <div className="rm-model-header">
                  <div className="rm-model-icon"><IconBrain/></div>
                  <div>
                    <p className="rm-model-name">Research Model <span className="rm-nb-tag">NB1</span></p>
                    <p className="rm-model-desc">768 features · 20k patients</p>
                  </div>
                  <span className={`rm-model-badge ${result.research_model?.error ? 'unavailable' : (result.research_model?.prediction ?? 'unavailable')}`}>
                    {result.research_model?.error ? 'N/A' : result.research_model?.prediction === 'healthy' ? 'Healthy' : "Parkinson's"}
                  </span>
                </div>
                {result.research_model && !result.research_model.error ? (
                  <div className="rm-model-conf">
                    <span className="rm-conf-label">Confidence</span>
                    <div className="conf-bar-bg" style={{ flex: 1 }}>
                      <div className={`conf-bar-fill ${result.research_model.prediction}`}
                        style={{ width: `${(result.research_model.confidence ?? 0) * 100}%` }}/>
                    </div>
                    <span className="rm-conf-pct">{((result.research_model.confidence ?? 0) * 100).toFixed(1)}%</span>
                  </div>
                ) : (
                  <p className="rm-model-err">{result.research_model?.error ?? 'Model unavailable'}</p>
                )}
              </div>
            </div>
 
            {result.prediction === 'parkinson' && (
              <div className="disclaimer" style={{ margin: '0 24px' }}>
                <IconAlert/>
                AI-assisted screening — not a medical diagnosis. Consult a qualified neurologist.
              </div>
            )}
 
            <div className="rm-actions">
              <button className="btn-ghost" onClick={() => setShowModal(false)}>Close</button>
              <button className="btn-primary" onClick={reset}><IconRefresh/> New Analysis</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Test Samples ────────────────────────────────────────────────────── */}
      <TestSamplesSection/>
    </div>
  )
}

// ── TRAINING PAGE ──────────────────────────────────────────────────────────────
function TrainingPage({ patients }: { patients: Patient[] }) {
  const [training,    setTraining]   = useState(false)
  const [progress,    setProgress]   = useState(0)
  const [trained,     setTrained]    = useState(false)
  const [_runId,      setRunId]      = useState<string|null>(null)
  const [accuracy,    setAccuracy]   = useState<string>('—')
  const [visibleRows, setVisibleRows] = useState(8)
  const trainingSet  = patients.filter(p => p.inTraining)
  const totalSamples = trainingSet.reduce((a, p) => a + p.sessionsCount, 0)
  const shownSet     = trainingSet.slice(0, visibleRows)
  const hasMoreRows  = visibleRows < trainingSet.length

  const startTraining = async () => {
    setTraining(true); setProgress(0); setTrained(false)

    if (!DOCTOR_ID) {
      // Demo mode — fake progress bar
      const iv = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) { clearInterval(iv); setTraining(false); setTrained(true); setAccuracy('94.2%'); return 100 }
          return prev + Math.random() * 8
        })
      }, 300)
      return
    }

    try {
      const run = await api.training.start(DOCTOR_ID)
      setRunId(run.id)

      // Simulate progress bar while polling backend for status
      const progressIv = setInterval(() => {
        setProgress(prev => Math.min(prev + Math.random() * 5, 90))
      }, 500)

      // Poll every 3 seconds for up to 5 minutes
      let attempts = 0
      const pollIv = setInterval(async () => {
        attempts++
        if (attempts > 100) { clearInterval(pollIv); clearInterval(progressIv); return }
        try {
          const latest = await api.training.get(run.id)
          if (latest.status === 'completed') {
            clearInterval(pollIv); clearInterval(progressIv)
            setProgress(100); setTraining(false); setTrained(true)
            setAccuracy(latest.accuracy ? `${(latest.accuracy * 100).toFixed(1)}%` : '—')
          } else if (latest.status === 'failed') {
            clearInterval(pollIv); clearInterval(progressIv)
            setTraining(false); setProgress(0)
            alert(`Training failed: ${latest.error_message}`)
          }
        } catch { /* silent poll error */ }
      }, 3000)

    } catch (err: unknown) {
      setTraining(false); setProgress(0)
      alert(`Could not start training: ${(err as Error).message}`)
    }
  }

  return (
    <div className="training-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Model Training</h2>
          <p className="page-sub">Train the Parkinson's detection model on patient voice data</p>
        </div>
      </div>

      <div className="training-grid">
        {/* Dataset info */}
        <div className="card training-info-card">
          <div className="card-header">
            <h3 className="card-title">Training Dataset</h3>
            <span className="panel-count">{trainingSet.length} patients</span>
          </div>
          <div className="training-stats-row">
            <div className="tr-stat">
              <p className="tr-num">{totalSamples}</p>
              <p className="tr-label">Voice Samples</p>
            </div>
            <div className="tr-stat">
              <p className="tr-num">{trainingSet.filter(p=>p.stage==='advanced').length + trainingSet.filter(p=>p.stage==='moderate').length}</p>
              <p className="tr-label">PD Positive</p>
            </div>
            <div className="tr-stat">
              <p className="tr-num">{trainingSet.filter(p=>p.stage==='early').length}</p>
              <p className="tr-label">Early Stage</p>
            </div>
            <div className="tr-stat">
              <p className="tr-num">{trained ? accuracy : (totalSamples > 0 ? '—' : '—')}</p>
              <p className="tr-label">Last Accuracy</p>
            </div>
          </div>

          <div className="training-patient-list">
            {trainingSet.length === 0 && (
              <div className="empty-state">
                <p>No patients selected for training.</p>
                <p>Go to Patients page and toggle patients into the training dataset.</p>
              </div>
            )}
            {shownSet.map(p => (
              <div key={p.id} className="tr-patient">
                <div className="ti-avatar" style={{ background: p.color }}>{p.initials}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span className="ti-name">{p.name}</span>
                    <span className="t-muted" style={{ fontSize:'12px' }}>{p.sessionsCount} samples</span>
                  </div>
                  <div className="ti-bar-bg" style={{ marginTop: 6 }}>
                    <div className="ti-bar-fill" style={{ width:`${Math.min(100,(p.sessionsCount/20)*100)}%`, background: scoreColor(p.score) }}/>
                  </div>
                </div>
              </div>
            ))}
            {hasMoreRows && (
              <div style={{ padding: '10px 0', textAlign: 'center' }}>
                <button className="btn-ghost" style={{ width: '100%', fontSize: '13px' }}
                  onClick={() => setVisibleRows(v => v + 8)}>
                  Load More ({visibleRows} of {trainingSet.length})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Training controls */}
        <div className="training-controls">
          <div className="card">
            <div className="card-header"><h3 className="card-title">Model Configuration</h3></div>
            <div className="config-list">
              <div className="config-item">
                <span className="config-label">Algorithm</span>
                <span className="config-value">Random Forest + SVM Ensemble</span>
              </div>
              <div className="config-item">
                <span className="config-label">Features</span>
                <span className="config-value">MFCC, Jitter, Shimmer, HNR</span>
              </div>
              <div className="config-item">
                <span className="config-label">Validation Split</span>
                <span className="config-value">80 / 20 %</span>
              </div>
              <div className="config-item">
                <span className="config-label">Cross-validation</span>
                <span className="config-value">5-fold</span>
              </div>
              <div className="config-item">
                <span className="config-label">Target Feature</span>
                <span className="config-value">Parkinson's vs Healthy</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Training Control</h3></div>
            <div style={{ padding: '16px 20px 20px' }}>
              {training && (
                <div className="training-progress">
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                    <span className="conf-label">Training in progress...</span>
                    <span className="conf-value">{Math.min(100, Math.round(progress))}%</span>
                  </div>
                  <div className="conf-bar-bg">
                    <div className="conf-bar-fill parkinson" style={{ width:`${Math.min(100,progress)}%`, background: '#3B82F6' }}/>
                  </div>
                  <p className="placeholder-sub" style={{ marginTop:8 }}>Extracting features from {totalSamples} voice samples...</p>
                </div>
              )}
              {trained && (
                <div className="trained-success">
                  <div className="s-badge healthy" style={{ marginBottom:10, fontSize:14, padding:'8px 14px' }}>
                    <IconCheck/> Model trained successfully — Accuracy: {accuracy}
                  </div>
                  <p className="placeholder-sub">Model is ready for voice analysis. Navigate to Voice Analysis to test it.</p>
                </div>
              )}
              {!training && (
                <button
                  className="btn-primary full-w"
                  onClick={startTraining}
                  disabled={trainingSet.length === 0 || totalSamples === 0}
                >
                  <IconBrain/> {trained ? 'Re-train Model' : 'Start Training'}
                </button>
              )}
              {training && (
                <button className="btn-ghost full-w" style={{ marginTop:10 }} onClick={() => { setTraining(false); setProgress(0) }}>
                  Cancel Training
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">Training History</h3></div>
            <div style={{ padding: '0 20px 16px' }}>
              {[
                { date: 'May 10, 2026', acc: '94.2%', samples: 73, status: 'success' },
                { date: 'Apr 28, 2026', acc: '91.8%', samples: 58, status: 'success' },
                { date: 'Apr 14, 2026', acc: '89.3%', samples: 42, status: 'success' },
              ].map((h, i) => (
                <div key={i} className="history-item">
                  <div className="s-badge healthy" style={{ padding:'3px 8px', fontSize:11 }}><IconCheck/> {h.acc}</div>
                  <div style={{ flex:1, marginLeft:10 }}>
                    <p style={{ fontSize:13, fontWeight:500, color:'var(--text)' }}>{h.date}</p>
                    <p className="t-muted" style={{ fontSize:12 }}>{h.samples} samples used</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SETTINGS PAGE ──────────────────────────────────────────────────────────────
function SettingsPage() {
  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="page-sub">Configure your platform preferences</p>
        </div>
      </div>
      <div className="settings-grid">
        {[
          { title: 'Doctor Profile', fields: [['Full Name','Doctor Park'],['Email','yahyadev33@gmail.com'],['Specialization','Neurology / Movement Disorders'],['Hospital','Starlight Health']] },
          { title: 'Notification Preferences', fields: [['Email Alerts','Enabled'],['Session Reminders','24h before'],['Model Retraining Alerts','When accuracy drops below 85%'],['New Patient Notifications','Enabled']] },
        ].map(section => (
          <div key={section.title} className="card">
            <div className="card-header"><h3 className="card-title">{section.title}</h3></div>
            <div style={{ padding:'4px 20px 20px' }}>
              {section.fields.map(([label, value]) => (
                <div key={label} className="setting-row">
                  <label className="setting-label">{label}</label>
                  <input className="form-input" defaultValue={value} style={{ maxWidth:280 }}/>
                </div>
              ))}
              <button className="btn-primary" style={{ marginTop:16 }}>Save Changes</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [patients, setPatients]   = useState<Patient[]>(INIT_PATIENTS)
  const [sessions, setSessions]   = useState<SessionRecord[]>(INIT_SESSIONS)
  const [dashData, setDashData]   = useState<DashboardData | null>(null)

  // Load initial data from Supabase via backend
  useEffect(() => {
    if (!DOCTOR_ID) return

    api.dashboard.get(DOCTOR_ID)
      .then(d => {
        setDashData(d)
        if (d.patients?.length)      setPatients(d.patients.map(mapApiPatient))
        if (d.recentSessions?.length) setSessions(d.recentSessions.map(mapApiSession))
      })
      .catch(err => {
        console.warn('[dashboard] API unavailable, falling back to local data:', err.message)
        // fallback: still load patients + sessions separately
        api.patients.list(DOCTOR_ID, 20, 0)
          .then(res => { if (res.data?.length) setPatients(res.data.map(mapApiPatient)) })
          .catch(() => {})
        api.sessions.list(DOCTOR_ID)
          .then(list => { if (list?.length) setSessions(list.map(mapApiSession)) })
          .catch(() => {})
      })
  }, [])

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage sessions={sessions} patients={patients} dashData={dashData} onNavigate={setPage}/>
      case 'patients':  return <PatientsPage patients={patients} setPatients={setPatients}/>
      case 'analysis':  return <AnalysisPage patients={patients} setSessions={setSessions}/>
      case 'training':  return <TrainingPage patients={patients}/>
      case 'settings':  return <SettingsPage/>
    }
  }

  return (
    <div className="platform">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon-wrap">
            <IconBrain/>
          </div>
          <div>
            <p className="logo-name">NeuroTrack</p>
            <p className="logo-sub">Parkinson's Platform</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => setPage(id)}
            >
              <Icon/>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="doctor-card">
            <div className="doc-avatar">AY</div>
            <div className="doc-info">
              <p className="doc-name">Dr. Ahmad Yahya</p>
              <p className="doc-role">Neurologist</p>
            </div>
          </div>
          <div className="free-consult">
            <p className="consult-label">Free Consultation</p>
            <p className="consult-sub">Next slot: Today, 3:00 PM</p>
            <button className="btn-primary" style={{ width:'100%', marginTop:10 }} onClick={() => setPage('analysis')}>
              Schedule Now
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="main-area">
        <header className="topbar">
          <div>
            <h1 className="topbar-greeting">
              Hello, Dr. Yahya{' '}
              <span role="img" aria-label="wave">👋</span>
            </h1>
            <p className="topbar-sub">Here's your Parkinson's care update for today, May 14 2026</p>
          </div>
          <div className="topbar-right">
            <button className="icon-btn"><IconSearch/></button>
            <button className="icon-btn notif"><IconBell/><span className="notif-dot"/></button>
            <div className="topbar-avatar">AY</div>
          </div>
        </header>

        <main className="content">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
