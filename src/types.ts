export type HelmetState = 'VERIFY' | 'WARMUP' | 'PRESTART' | 'RIDING' | 'ALCOHOL_WARN' | 'ACC_COUNTDOWN' | 'ACC_ALERT' | string

export interface HelmetLiveData {
  state?: HelmetState
  secondsLeft?: number
  alcoholRaw?: number
  alcoholPercent?: number
  alcoholDetected?: boolean
  accident?: boolean
  accelX?: number
  accelY?: number
  accelZ?: number
  accelMagnitude?: number
  accelBaseline?: number
  impact?: number
  peakImpact?: number
  jerk?: number
  impactEvents?: number
  motor?: boolean
  buzzer?: boolean
  gpsFix?: boolean
  hasLocation?: boolean
  latitude?: number
  longitude?: number
  satellites?: number
  emailEnabled?: boolean
  notificationBusy?: boolean
  speedKmph?: number
  maxSpeedKmph?: number
  speedValid?: boolean
  timestamp?: number
  deviceMillis?: number
}

export interface HistoryRecord extends HelmetLiveData {
  timestamp?: number
}

export interface AlcoholEvent extends HelmetLiveData {
  eventType?: string
}

export interface AccidentEvent extends HelmetLiveData {
  eventType?: string
}

export interface UserProfile {
  name?: string
  email: string
  emergencyContact?: string
  emergencyPhone?: string
  helmetName?: string
  createdAt?: number
}

export interface AuditLog {
  adminUid?: string
  adminEmail?: string | null
  action?: string
  path?: string
  timestamp?: number
  result?: string
  details?: string
}

export interface NotificationItem {
  id: string
  type: 'Alcohol' | 'Accident' | 'Device' | 'GPS' | 'System'
  title: string
  message: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  timestamp: number
}

export interface SafetyScoreResult {
  score: number
  label: string
  reasons: string[]
}
