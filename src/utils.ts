import type { HelmetLiveData, SafetyScoreResult } from './types'

export function num(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function bool(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

export function fmtTime(ts?: number) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

export function fmtAgo(ts?: number) {
  if (!ts) return 'Never'
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function humanState(state?: unknown) {
  const map: Record<string, string> = {
    VERIFY: 'Waiting for Rider Verification',
    WARMUP: 'Helmet Sensors Starting',
    PRESTART: 'Helmet Ready — Checking Safety',
    RIDING: 'Rider is Riding',
    ALCOHOL_WARN: 'Alcohol Warning',
    ACC_COUNTDOWN: 'Possible Accident — Confirm Safety',
    ACC_ALERT: 'Accident Alert',
  }
  if (typeof state !== 'string') return 'Unknown'
  return (map[state] ?? state) || 'Unknown'
}

export function safetyScore(live: HelmetLiveData | null, online: boolean): SafetyScoreResult {
  if (!live) return { score: 0, label: 'CRITICAL', reasons: ['No live helmet data is available.'] }
  let score = 100
  const reasons: string[] = []
  const alcohol = num(live.alcoholPercent)
  if (bool(live.accident)) {
    score -= 80
    reasons.push('Accident alert is active.')
  }
  if (bool(live.alcoholDetected)) {
    score -= 45
    reasons.push('Alcohol warning is active.')
  } else if (alcohol >= 70) {
    score -= 35
    reasons.push('Alcohol sensor level is high.')
  } else if (alcohol >= 40) {
    score -= 15
    reasons.push('Alcohol sensor level is elevated.')
  }
  if (!online) {
    score -= 25
    reasons.push('Helmet is not sending recent live data.')
  }
  if (live.hasLocation === false) {
    score -= 8
    reasons.push('Location is currently unavailable.')
  }
  if (reasons.length === 0) reasons.push('Helmet connected and no active safety warning reported.')
  const bounded = Math.max(0, Math.min(100, score))
  const label = bounded >= 90 ? 'EXCELLENT' : bounded >= 75 ? 'GOOD' : bounded >= 50 ? 'ATTENTION' : bounded >= 25 ? 'WARNING' : 'CRITICAL'
  return { score: bounded, label, reasons }
}

export function csvEscape(value: unknown) {
  const s = value === undefined || value === null ? '' : String(value)
  return `"${s.replaceAll('"', '""')}"`
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const lines = [keys.map(csvEscape).join(','), ...rows.map((r) => keys.map((k) => csvEscape(r[k])).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
