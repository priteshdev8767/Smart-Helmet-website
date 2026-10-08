import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { auth } from '../firebase'
import { hooks } from '../hooks'
import { paths, subscribeLive, readLatest } from '../services'
import { downloadCsv, downloadJson, fmtAgo, fmtTime, humanState, num, safetyScore } from '../utils'
import type { HelmetLiveData } from '../types'
import {
  Activity, AlertTriangle, BarChart3, Bell, ChevronRight, Clock, Copy, Database, Download,
  Eye, FileJson, Globe, HardDrive, KeyRound, LayoutDashboard, LogIn, MapPin, Monitor,
  Presentation, RefreshCw, Search, Server, Settings, Shield, ShieldCheck, Siren, Smartphone,
  Trash2, TrendingUp, User, Users, Wifi, WifiOff, X, XCircle, Zap, Lock, Unlock, FileText,
  ChevronDown, ChevronUp, CheckCircle2, Radio, Cpu
} from 'lucide-react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import {
  readAllUsers, readAllAdmins, setAdminRole, writeAdminAudit, readPaginated,
  estimateBranchSize, readBranchData, subscribeBranch, deleteRecords,
  deleteRecordsBefore, clearBranch, readAuditLogs, searchDatabase
} from './adminServices'
import './admin.css'

// ═══════════════════════════════════════════════════════════
// Toast System
// ═══════════════════════════════════════════════════════════
type ToastType = 'success' | 'error' | 'info'
let toastTimeout: ReturnType<typeof setTimeout> | null = null

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null)
  const show = useCallback((msg: string, type: ToastType = 'info') => {
    if (toastTimeout) clearTimeout(toastTimeout)
    setToast({ msg, type })
    toastTimeout = setTimeout(() => setToast(null), 4000)
  }, [])
  return { toast, show }
}

function Toast({ toast }: { toast: { msg: string; type: ToastType } | null }) {
  if (!toast) return null
  return <div className={`admin-toast ${toast.type}`}>
    {toast.type === 'success' && <CheckCircle2 size={16} />}
    {toast.type === 'error' && <XCircle size={16} />}
    {toast.type === 'info' && <Zap size={16} />}
    {toast.msg}
  </div>
}

// ═══════════════════════════════════════════════════════════
// Confirmation Modal
// ═══════════════════════════════════════════════════════════
function ConfirmModal({ title, description, dangerText, confirmWord, onConfirm, onCancel, busy }: {
  title: string; description: string; dangerText?: string; confirmWord: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean
}) {
  const [typed, setTyped] = useState('')
  const canConfirm = typed.trim().toUpperCase() === confirmWord.toUpperCase()
  return <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
    <div className="modal-content">
      <h2>{title}</h2>
      <p className="modal-desc">{description}</p>
      {dangerText && <div className="modal-danger-zone">
        <strong>⚠ Destructive Action</strong>
        <p>{dangerText}</p>
      </div>}
      <div className="modal-confirm-input">
        <label>Type <strong style={{ color: 'var(--red)', fontFamily: 'monospace' }}>{confirmWord}</strong> to confirm</label>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={confirmWord} autoFocus />
      </div>
      <div className="modal-buttons">
        <button className="secondary-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="danger-btn" onClick={onConfirm} disabled={!canConfirm || busy}>
          <Trash2 size={14} />{busy ? 'Processing…' : 'Confirm Delete'}
        </button>
      </div>
    </div>
  </div>
}

// ═══════════════════════════════════════════════════════════
// Record Detail Slide Panel
// ═══════════════════════════════════════════════════════════
function RecordDetail({ record, onClose }: { record: any; onClose: () => void }) {
  if (!record) return null
  const entries = Object.entries(record).filter(([k]) => !k.startsWith('__'))
  return <div className="record-detail-panel">
    <button className="record-detail-close" onClick={onClose}><X size={16} /></button>
    <h3>Record Detail</h3>
    <p className="muted" style={{ fontSize: 10, marginBottom: 14 }}>ID: {record.__id || '—'}</p>
    {entries.map(([k, v]) => (
      <div className="info-row" key={k}>
        <span style={{ color: 'var(--cyan)', fontFamily: 'monospace', fontSize: 11 }}>{k}</span>
        <strong style={{ fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {k === 'timestamp' ? fmtTime(v as number) : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
        </strong>
      </div>
    ))}
    <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
      <button className="secondary-btn" onClick={() => { navigator.clipboard.writeText(JSON.stringify(record, null, 2)); }}><Copy size={14} />Copy JSON</button>
    </div>
  </div>
}

// ═══════════════════════════════════════════════════════════
// MAIN ADMIN PANEL
// ═══════════════════════════════════════════════════════════
export default function AdminPanel() {
  const [tab, setTab] = useState('overview')
  const { toast, show: showToast } = useToast()
  const [presentation, setPresentation] = useState(false)

  const tabs: [string, string, any][] = [
    ['overview', 'Overview', LayoutDashboard],
    ['monitor', 'System Monitor', Monitor],
    ['database', 'Database', Database],
    ['history', 'History', Clock],
    ['alcohol', 'Alcohol Events', AlertTriangle],
    ['accidents', 'Accidents', Siren],
    ['users', 'Users', Users],
    ['devices', 'Devices', Smartphone],
    ['alerts', 'Alert Monitor', Bell],
    ['analytics', 'Analytics', BarChart3],
    ['export', 'Export Center', Download],
    ['audit', 'Audit Logs', FileText],
    ['retention', 'Retention', RefreshCw],
    ['security', 'Security', Shield],
    ['settings', 'Settings', Settings],
  ]

  return <div className="admin-shell">
    {/* ─── Header ──────────────────────────────────────── */}
    <div className="admin-header">
      <div className="admin-header-top">
        <div className="admin-title-group">
          <p className="eyebrow">SMART HELMET</p>
          <h1>Admin Control Center</h1>
          <p className="admin-subtitle">Manage stored data, inspect realtime system activity, and administer users.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="secondary-btn" onClick={() => setPresentation(true)}>
            <Presentation size={14} />Presentation
          </button>
          <span className="pill warning"><KeyRound size={12} /> Admin</span>
        </div>
      </div>
      <div className="admin-meta-row">
        <div className="admin-meta-item"><User size={13} /><strong>{auth.currentUser?.email || '—'}</strong></div>
        <div className="admin-meta-item"><Shield size={13} />Role: <strong>ADMIN</strong></div>
        <div className="admin-meta-item"><Wifi size={13} />Firebase: <strong>Connected</strong></div>
        <div className="admin-meta-item"><Clock size={13} /><strong>{new Date().toLocaleString()}</strong></div>
      </div>
    </div>

    {/* ─── Navigation ──────────────────────────────────── */}
    <div className="admin-nav">
      {tabs.map(([id, label, Icon]) => (
        <button key={id} className={`admin-nav-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
          <Icon size={15} />{label}
        </button>
      ))}
    </div>

    {/* ─── Tab Content ─────────────────────────────────── */}
    <div className="admin-tab-content" key={tab}>
      {tab === 'overview' && <AdminOverview />}
      {tab === 'monitor' && <SystemMonitor />}
      {tab === 'database' && <DatabaseExplorer showToast={showToast} />}
      {tab === 'history' && <HistoryManager showToast={showToast} />}
      {tab === 'alcohol' && <EventManager type="alcohol" showToast={showToast} />}
      {tab === 'accidents' && <EventManager type="accident" showToast={showToast} />}
      {tab === 'users' && <UserManager showToast={showToast} />}
      {tab === 'devices' && <DeviceManager />}
      {tab === 'alerts' && <AlertMonitor />}
      {tab === 'analytics' && <AdminAnalytics />}
      {tab === 'export' && <ExportCenter showToast={showToast} />}
      {tab === 'audit' && <AuditLogsPanel />}
      {tab === 'retention' && <RetentionManager showToast={showToast} />}
      {tab === 'security' && <SecurityCenter />}
      {tab === 'settings' && <AdminSettings />}
    </div>

    <Toast toast={toast} />
    {presentation && <PresentationMode onClose={() => setPresentation(false)} />}
  </div>
}

// ═══════════════════════════════════════════════════════════
// ADMIN OVERVIEW
// ═══════════════════════════════════════════════════════════
function AdminOverview() {
  const { live, firebaseOnline, deviceOnline, lastDataAt } = hooks.useLiveHelmet()
  const [userCount, setUserCount] = useState(0)
  const [alcoholCount, setAlcoholCount] = useState(0)
  const [accidentCount, setAccidentCount] = useState(0)
  const [historyCount, setHistoryCount] = useState(0)
  const [todayEvents, setTodayEvents] = useState(0)
  const [recentAudits, setRecentAudits] = useState<any[]>([])

  useEffect(() => {
    readAllUsers().then(u => setUserCount(Object.keys(u).length)).catch(() => { })
    estimateBranchSize(paths.alcohol).then(r => setAlcoholCount(r.count)).catch(() => { })
    estimateBranchSize(paths.accidents).then(r => setAccidentCount(r.count)).catch(() => { })
    estimateBranchSize(paths.history).then(r => setHistoryCount(r.count)).catch(() => { })
    readAuditLogs(10).then(setRecentAudits).catch(() => { })
    // today events
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const ts = todayStart.getTime()
    Promise.all([
      readLatest(paths.alcohol, 200),
      readLatest(paths.accidents, 200),
    ]).then(([alc, acc]) => {
      setTodayEvents([...alc, ...acc].filter((e: any) => e.timestamp && e.timestamp >= ts).length)
    }).catch(() => { })
  }, [])

  const score = safetyScore(live, deviceOnline)

  return <>
    {/* KPI Cards */}
    <div className="grid-4">
      <KpiCard icon={Users} value={userCount} label="Total Users" accent="cyan" />
      <KpiCard icon={HardDrive} value={1} label="Total Devices" accent="green" trend="1 registered" />
      <KpiCard icon={Database} value={historyCount} label="History Records" accent="cyan" />
      <KpiCard icon={AlertTriangle} value={alcoholCount} label="Alcohol Events" accent="amber" />
      <KpiCard icon={Siren} value={accidentCount} label="Accident Events" accent="red" />
      <KpiCard icon={Zap} value={todayEvents} label="Today's Events" accent="cyan" />
      <KpiCard icon={ShieldCheck} value={score.score} label="Safety Score" accent="green" trend={score.label} />
      <KpiCard icon={Wifi} value={deviceOnline ? 'Online' : 'Offline'} label="Device Status" accent={deviceOnline ? 'green' : 'red'} />
    </div>

    {/* Realtime System Status */}
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Realtime System Status</h2>
        <div className="section-badge">
          <span className={`live-indicator ${deviceOnline ? 'online' : 'offline'}`}>
            {deviceOnline && <span className="live-pulse" />}
            {deviceOnline ? '● LIVE' : '● OFFLINE'}
          </span>
        </div>
      </div>
      <div className="card">
        <div className="system-status-grid">
          <StatusItem ok={deviceOnline} label="Helmet Status" detail={deviceOnline ? 'Receiving live data' : 'No recent data'} />
          <StatusItem ok={firebaseOnline} label="Firebase Status" detail={firebaseOnline ? 'Connected and receiving' : 'Disconnected'} />
          <StatusItem ok={!!live?.state} label="Current State" detail={humanState(live?.state)} />
          <StatusItem ok={!!lastDataAt} label="Last Telemetry" detail={lastDataAt ? fmtAgo(lastDataAt) : 'Never'} />
          <StatusItem ok={!!live?.gpsFix} label="GPS Status" detail={live?.gpsFix ? `Fix (${live.satellites ?? 0} sats)` : 'No fix'} />
          <StatusItem ok={live?.motor !== undefined} label="Motor Status" detail={live?.motor ? 'RUNNING' : 'STOPPED'} warn={!live?.motor && live?.state === 'RIDING'} />
          <StatusItem ok={live?.buzzer !== undefined} label="Buzzer Status" detail={live?.buzzer ? 'ACTIVE' : 'Silent'} warn={!!live?.buzzer} />
          <StatusItem ok={live?.emailEnabled !== undefined} label="Notifications" detail={live?.notificationBusy ? 'Sending…' : live?.emailEnabled ? 'Enabled' : 'Disabled'} />
        </div>
        <div style={{ marginTop: 12, fontSize: 10, color: '#4d6580' }}>
          Last update: {lastDataAt ? `${Math.round((Date.now() - lastDataAt) / 1000)}s ago` : 'No data received'}
        </div>
      </div>
    </div>

    {/* Admin Activity */}
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Recent Admin Activity</h2>
        <span className="section-badge">{recentAudits.length} recent</span>
      </div>
      <div className="card">
        {recentAudits.length > 0 ? (
          <div className="audit-timeline">
            {recentAudits.slice(0, 8).map((a, i) => (
              <div key={i} className={`audit-entry ${a.action?.includes('CLEAR') || a.action?.includes('DELETE') ? 'audit-danger' : a.action?.includes('ROLE') ? 'audit-warning' : ''}`}>
                <div className="audit-action">{a.adminEmail} — {a.action}</div>
                <div className="audit-detail">{a.path} · {a.result} {a.details ? `· ${a.details}` : ''}</div>
                <div className="audit-time">{fmtTime(a.timestamp)}</div>
              </div>
            ))}
          </div>
        ) : <div className="empty">No admin activity recorded yet.</div>}
      </div>
    </div>

    {/* Destructive Actions Warning */}
    <div className="card admin-warning">
      <AlertTriangle size={18} />
      <div>
        <strong>Destructive actions are permanent.</strong>
        <span>Always preview and confirm before clearing Firebase data. All admin actions are recorded in the audit log.</span>
      </div>
    </div>
  </>
}

function KpiCard({ icon: Icon, value, label, accent, trend }: { icon: any; value: any; label: string; accent: string; trend?: string }) {
  return <div className={`card kpi-card kpi-${accent}`}>
    <div className="kpi-icon"><Icon size={20} /></div>
    <p className="kpi-value">{value}</p>
    <div className="kpi-label">{label}</div>
    {trend && <div className="kpi-trend neutral">{trend}</div>}
  </div>
}

function StatusItem({ ok, label, detail, warn }: { ok: boolean; label: string; detail: string; warn?: boolean }) {
  return <div className="sys-status-item">
    <span className={`sys-status-dot ${warn ? 'warn' : ok ? 'ok' : 'off'}`} />
    <div className="sys-status-info">
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  </div>
}

// ═══════════════════════════════════════════════════════════
// SYSTEM MONITOR
// ═══════════════════════════════════════════════════════════
function SystemMonitor() {
  const { live, firebaseOnline, deviceOnline, lastDataAt } = hooks.useLiveHelmet()
  const [prevLive, setPrevLive] = useState<HelmetLiveData | null>(null)
  const [changedKeys, setChangedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (live && prevLive) {
      const changed = new Set<string>()
      for (const key of Object.keys(live)) {
        if ((live as any)[key] !== (prevLive as any)[key]) changed.add(key)
      }
      setChangedKeys(changed)
      const t = setTimeout(() => setChangedKeys(new Set()), 800)
      return () => clearTimeout(t)
    }
    setPrevLive(live)
  }, [live])

  useEffect(() => { setPrevLive(live) }, [live])

  const score = safetyScore(live, deviceOnline)

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Realtime System Status</h2>
        <span className={`live-indicator ${deviceOnline ? 'online' : 'offline'}`}>
          {deviceOnline && <span className="live-pulse" />}
          {deviceOnline ? '● LIVE' : '● OFFLINE'}
        </span>
      </div>

      {/* Live Telemetry Detail */}
      <div className="card" style={{ marginBottom: 14 }}>
        <TelemetrySection title="RIDER STATE" items={[
          { label: 'State', value: humanState(live?.state), cls: live?.state === 'ACC_ALERT' ? 'danger' : live?.state === 'ALCOHOL_WARN' ? 'warning' : '' },
          { label: 'Seconds Left', value: String(live?.secondsLeft ?? '—') },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="ALCOHOL" items={[
          { label: 'Percent', value: `${num(live?.alcoholPercent)}%`, cls: live?.alcoholDetected ? 'danger' : '' },
          { label: 'Raw', value: String(num(live?.alcoholRaw)) },
          { label: 'Detected', value: live?.alcoholDetected ? 'YES' : 'NO', cls: live?.alcoholDetected ? 'danger' : 'success' },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="ACCIDENT" items={[
          { label: 'Active', value: live?.accident ? 'DETECTED' : 'SAFE', cls: live?.accident ? 'danger' : 'success' },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="ACCELEROMETER" items={[
          { label: 'X', value: String(num(live?.accelX)) },
          { label: 'Y', value: String(num(live?.accelY)) },
          { label: 'Z', value: String(num(live?.accelZ)) },
          { label: 'Magnitude', value: String(num(live?.accelMagnitude)) },
          { label: 'Baseline', value: String(num(live?.accelBaseline)) },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="IMPACT" items={[
          { label: 'Current', value: String(num(live?.impact)) },
          { label: 'Peak', value: String(num(live?.peakImpact)) },
          { label: 'Jerk', value: String(num(live?.jerk)) },
          { label: 'Events', value: String(num(live?.impactEvents)) },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="GPS" items={[
          { label: 'Fix', value: live?.gpsFix ? 'YES' : 'NO', cls: live?.gpsFix ? 'success' : '' },
          { label: 'Latitude', value: live?.latitude?.toFixed(6) ?? '—' },
          { label: 'Longitude', value: live?.longitude?.toFixed(6) ?? '—' },
          { label: 'Satellites', value: String(live?.satellites ?? 0) },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="MOTOR & ALARM" items={[
          { label: 'Motor', value: live?.motor ? 'RUNNING' : 'STOPPED', cls: live?.motor ? 'success' : '' },
          { label: 'Buzzer', value: live?.buzzer ? 'ON' : 'OFF', cls: live?.buzzer ? 'warning' : '' },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="NOTIFICATIONS" items={[
          { label: 'Email Enabled', value: live?.emailEnabled ? 'YES' : 'NO' },
          { label: 'Busy', value: live?.notificationBusy ? 'Sending' : 'Idle' },
        ]} changedKeys={changedKeys} />

        <TelemetrySection title="TIMING" items={[
          { label: 'Timestamp', value: fmtTime(live?.timestamp) },
          { label: 'Device Millis', value: String(live?.deviceMillis ?? '—') },
        ]} changedKeys={changedKeys} />
      </div>

      {/* Safety Score */}
      <div className="card">
        <div className="card-head">
          <div><h3>Safety Score</h3><p className="muted">Current informational score based on live signals</p></div>
          <ShieldCheck size={18} />
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--cyan)' }}>{score.score}<span style={{ fontSize: 14, color: 'var(--muted)' }}>/100</span></div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', color: 'var(--cyan)', marginBottom: 6 }}>{score.label}</div>
            {score.reasons.map(r => <div key={r} style={{ fontSize: 11, color: '#7d93aa', lineHeight: 1.6 }}>• {r}</div>)}
            <p style={{ fontSize: 9, color: '#4d6580', marginTop: 8 }}>App-defined indicator. Not medical or safety certification.</p>
          </div>
        </div>
      </div>
    </div>
  </>
}

function TelemetrySection({ title, items, changedKeys }: { title: string; items: { label: string; value: string; cls?: string }[]; changedKeys: Set<string> }) {
  return <div className="telemetry-section">
    <div className="telemetry-section-title">{title}</div>
    <div className="telemetry-grid">
      {items.map(item => {
        const fieldKey = item.label.toLowerCase().replace(/\s+/g, '')
        const changed = changedKeys.has(fieldKey) || changedKeys.has(item.label)
        return <div key={item.label} className={`telemetry-item ${changed ? 'db-value-changed' : ''}`}>
          <div className="telemetry-item-label">{item.label}</div>
          <div className={`telemetry-item-value ${item.cls || ''}`}>{item.value}</div>
        </div>
      })}
    </div>
  </div>
}

// ═══════════════════════════════════════════════════════════
// DATABASE EXPLORER
// ═══════════════════════════════════════════════════════════
function DatabaseExplorer({ showToast }: { showToast: (msg: string, type: ToastType) => void }) {
  const [liveData, setLiveData] = useState<any>(null)
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set(['smartHelmet']))
  const [branchData, setBranchData] = useState<Record<string, any>>({})
  const [loadingBranch, setLoadingBranch] = useState<string | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [confirmModal, setConfirmModal] = useState<{ path: string; label: string } | null>(null)
  const [clearBusy, setClearBusy] = useState(false)
  const [branchSizes, setBranchSizes] = useState<Record<string, { count: number; exists: boolean }>>({})
  const [prevLiveData, setPrevLiveData] = useState<any>(null)
  const [changedLiveKeys, setChangedLiveKeys] = useState<Set<string>>(new Set())

  // Subscribe to live data
  useEffect(() => {
    const unsub = subscribeLive((data) => { setLiveData(data) }, () => { })
    return () => unsub()
  }, [])

  // Track live data changes
  useEffect(() => {
    if (liveData && prevLiveData) {
      const changed = new Set<string>()
      for (const key of Object.keys(liveData)) {
        if (liveData[key] !== prevLiveData[key]) changed.add(key)
      }
      setChangedLiveKeys(changed)
      const t = setTimeout(() => setChangedLiveKeys(new Set()), 800)
      return () => clearTimeout(t)
    }
    setPrevLiveData(liveData)
  }, [liveData])
  useEffect(() => { setPrevLiveData(liveData) }, [liveData])

  // Load branch sizes
  useEffect(() => {
    const branches = [paths.live, paths.history, paths.alcohol, paths.accidents, paths.connection]
    branches.forEach(p => {
      estimateBranchSize(p).then(r => setBranchSizes(prev => ({ ...prev, [p]: r }))).catch(() => { })
    })
  }, [])

  const toggleBranch = async (path: string) => {
    const next = new Set(expandedBranches)
    if (next.has(path)) { next.delete(path) } else {
      next.add(path)
      if (!branchData[path] && path !== paths.live) {
        setLoadingBranch(path)
        try {
          const data = await readPaginated(path, 50)
          setBranchData(prev => ({ ...prev, [path]: data }))
        } catch { showToast('Failed to load branch data', 'error') }
        setLoadingBranch(null)
      }
    }
    setExpandedBranches(next)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const branches = [
        { label: 'History', path: paths.history },
        { label: 'Alcohol Events', path: paths.alcohol },
        { label: 'Accident Events', path: paths.accidents },
      ]
      const results = await searchDatabase(searchQuery, branches, 100)
      setSearchResults(results)
      showToast(`Found ${results.length} results`, 'info')
    } catch { showToast('Search failed', 'error') }
    setSearching(false)
  }

  const handleClear = async () => {
    if (!confirmModal) return
    setClearBusy(true)
    try {
      await clearBranch(confirmModal.path)
      await writeAdminAudit('CLEAR_BRANCH', confirmModal.path, 'SUCCESS')
      showToast(`${confirmModal.label} cleared successfully`, 'success')
      setBranchData(prev => { const n = { ...prev }; delete n[confirmModal.path]; return n })
      setBranchSizes(prev => ({ ...prev, [confirmModal.path]: { count: 0, exists: false } }))
    } catch (e) {
      await writeAdminAudit('CLEAR_BRANCH', confirmModal.path, 'FAILED', String(e)).catch(() => { })
      showToast('Failed to clear branch. Check Firebase rules.', 'error')
    }
    setClearBusy(false)
    setConfirmModal(null)
  }

  const branches = [
    { label: 'Live data', path: paths.live, danger: false, icon: Radio },
    { label: 'History', path: paths.history, danger: true, icon: Clock },
    { label: 'Alcohol events', path: paths.alcohol, danger: true, icon: AlertTriangle },
    { label: 'Accident events', path: paths.accidents, danger: true, icon: Siren },
    { label: 'Connection test', path: paths.connection, danger: true, icon: Wifi },
  ]

  return <>
    {/* Database Health */}
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Database Health</h2>
        <span className="section-badge"><Database size={14} /> Firebase Realtime DB</span>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="system-status-grid">
          {branches.map(b => {
            const size = branchSizes[b.path]
            return <StatusItem key={b.path} ok={!!size?.exists} label={b.label} detail={size ? (size.exists ? `${size.count} records` : 'Branch not found') : 'Checking…'} />
          })}
        </div>
      </div>
    </div>

    {/* Search */}
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Database Search</h2>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search across all branches…" onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          <button className="primary-btn" onClick={handleSearch} disabled={searching}>
            <Search size={14} />{searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {searchResults.length > 0 && <div style={{ marginTop: 14 }}>
          <div className="admin-table-scroll" style={{ maxHeight: 300 }}>
            <table className="admin-table">
              <thead><tr><th>Branch</th><th>Record ID</th><th>Matching Field</th><th>Value</th><th>Timestamp</th><th></th></tr></thead>
              <tbody>
                {searchResults.map((r, i) => (
                  <tr key={i}><td><span className="severity-badge info">{r.__branch}</span></td><td style={{ fontFamily: 'monospace', fontSize: 9 }}>{r.__id}</td><td>{r.__matchField}</td><td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.__matchValue}</td><td>{fmtTime(r.timestamp)}</td><td><button className="copy-btn" onClick={() => setSelectedRecord(r)}>View</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>}
      </div>
    </div>

    {/* Database Tree */}
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Database Explorer</h2>
      </div>
      <div className="card">
        <div className="db-tree">
          <div className="db-tree-root">
            <div className="db-tree-row" onClick={() => toggleBranch('smartHelmet')}>
              <button className={`db-tree-toggle ${expandedBranches.has('smartHelmet') ? 'open' : ''}`}>▶</button>
              <span className="db-tree-key">smartHelmet</span>
              <span className="db-tree-type">Object</span>
            </div>
            {expandedBranches.has('smartHelmet') && (
              <div className="db-tree-node">
                {branches.map(b => (
                  <Fragment key={b.path}>
                    <div className="db-tree-row" onClick={() => toggleBranch(b.path)}>
                      <button className={`db-tree-toggle ${expandedBranches.has(b.path) ? 'open' : ''}`}>▶</button>
                      <span className="db-tree-key">{b.path.split('/').pop()}</span>
                      <span className="db-tree-count">{branchSizes[b.path]?.count ?? '…'}</span>
                      {b.danger && <button className="danger-btn" style={{ padding: '3px 8px', fontSize: 9 }} onClick={(e) => { e.stopPropagation(); setConfirmModal({ path: b.path, label: b.label }) }}><Trash2 size={11} /></button>}
                    </div>
                    {expandedBranches.has(b.path) && (
                      <div className="db-tree-node">
                        {b.path === paths.live && liveData ? (
                          Object.entries(liveData).map(([k, v]) => (
                            <div key={k} className={`db-tree-row ${changedLiveKeys.has(k) ? 'db-value-changed' : ''}`}>
                              <span style={{ width: 18 }} />
                              <span className="db-tree-key">{k}</span>
                              <span className="db-tree-value" title={String(v)}>{String(v)}</span>
                              <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(String(v)); showToast('Copied', 'info') }}>Copy</button>
                            </div>
                          ))
                        ) : loadingBranch === b.path ? (
                          <div style={{ padding: '8px 20px', color: '#4d6580', fontSize: 11 }}>Loading…</div>
                        ) : branchData[b.path]?.length ? (
                          branchData[b.path].slice(0, 30).map((record: any) => (
                            <div key={record.__id} className="db-tree-row" onClick={() => setSelectedRecord(record)}>
                              <span style={{ width: 18 }} />
                              <span className="db-tree-key" style={{ fontSize: 10 }}>{record.__id}</span>
                              <span className="db-tree-value">{record.timestamp ? fmtTime(record.timestamp) : '—'}</span>
                              <button className="copy-btn" onClick={(e) => { e.stopPropagation(); setSelectedRecord(record) }}><Eye size={10} /></button>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: '8px 20px', color: '#4d6580', fontSize: 11 }}>No records found in this branch.</div>
                        )}
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {selectedRecord && <RecordDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    {confirmModal && <ConfirmModal
      title={`Clear ${confirmModal.label}`}
      description={`This will permanently delete all records in /${confirmModal.path}.`}
      dangerText={`This action permanently deletes all data in this branch. ${branchSizes[confirmModal.path]?.count ?? 'Unknown number of'} records will be removed. This cannot be undone.`}
      confirmWord={`DELETE ${confirmModal.label.toUpperCase().replace(/\s+/g, ' ')}`}
      onConfirm={handleClear}
      onCancel={() => setConfirmModal(null)}
      busy={clearBusy}
    />}
  </>
}

// ═══════════════════════════════════════════════════════════
// HISTORY MANAGER
// ═══════════════════════════════════════════════════════════
function HistoryManager({ showToast }: { showToast: (msg: string, type: ToastType) => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [limit, setLimit] = useState(100)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [alcoholFilter, setAlcoholFilter] = useState('')
  const [accidentFilter, setAccidentFilter] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<any>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const data = await readPaginated(paths.history, limit)
      setRows(data.reverse())
    } catch { setError(true) }
    setLoading(false)
  }, [limit])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (search && !JSON.stringify(r).toLowerCase().includes(search.toLowerCase())) return false
      if (stateFilter && r.state !== stateFilter) return false
      if (alcoholFilter === 'detected' && !r.alcoholDetected) return false
      if (alcoholFilter === 'none' && r.alcoholDetected) return false
      if (accidentFilter === 'yes' && !r.accident) return false
      if (accidentFilter === 'no' && r.accident) return false
      return true
    })
  }, [rows, search, stateFilter, alcoholFilter, accidentFilter])

  const handleDeleteSelected = async () => {
    setDeleteBusy(true)
    try {
      await deleteRecords(paths.history, [...selected])
      await writeAdminAudit('DELETE_RECORDS', paths.history, 'SUCCESS', `${selected.size} records`)
      showToast(`Deleted ${selected.size} records`, 'success')
      setSelected(new Set())
      loadData()
    } catch (e) {
      await writeAdminAudit('DELETE_RECORDS', paths.history, 'FAILED', String(e)).catch(() => { })
      showToast('Delete failed', 'error')
    }
    setDeleteBusy(false)
    setConfirmDelete(false)
  }

  const cols = ['timestamp', 'state', 'alcoholPercent', 'alcoholDetected', 'accident', 'impact', 'peakImpact', 'motor', 'gpsFix', 'latitude', 'longitude']

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Telemetry History Manager</h2>
        <span className="section-badge">/{paths.history}</span>
      </div>
      <div className="admin-table-wrap">
        <div className="admin-table-toolbar">
          <div className="admin-table-filters">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search records…" />
            <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              <option value="">All States</option>
              <option value="RIDING">RIDING</option>
              <option value="VERIFY">VERIFY</option>
              <option value="WARMUP">WARMUP</option>
              <option value="PRESTART">PRESTART</option>
              <option value="ALCOHOL_WARN">ALCOHOL_WARN</option>
              <option value="ACC_COUNTDOWN">ACC_COUNTDOWN</option>
              <option value="ACC_ALERT">ACC_ALERT</option>
            </select>
            <select value={alcoholFilter} onChange={e => setAlcoholFilter(e.target.value)}>
              <option value="">Alcohol: All</option>
              <option value="detected">Detected</option>
              <option value="none">None</option>
            </select>
            <select value={accidentFilter} onChange={e => setAccidentFilter(e.target.value)}>
              <option value="">Accident: All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
              <option value={100}>Latest 100</option>
              <option value={500}>Latest 500</option>
              <option value={1000}>Latest 1000</option>
            </select>
          </div>
          <div className="admin-table-actions">
            <button className="secondary-btn" onClick={() => { downloadCsv('helmet-history.csv', filtered); writeAdminAudit('EXPORT', paths.history, 'SUCCESS', `CSV ${filtered.length} records`).catch(() => { }) }}><Download size={14} />CSV</button>
            <button className="secondary-btn" onClick={() => { downloadJson('helmet-history.json', filtered); writeAdminAudit('EXPORT', paths.history, 'SUCCESS', `JSON ${filtered.length} records`).catch(() => { }) }}><FileJson size={14} />JSON</button>
            {selected.size > 0 && <button className="danger-btn" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{selected.size} selected</button>}
          </div>
        </div>
        <div className="admin-table-scroll">
          {loading ? <div className="empty">Loading telemetry history…</div> : error ? <div className="empty" style={{ color: 'var(--red)' }}>Failed to load history. Check Firebase rules.</div> : (
            <table className="admin-table">
              <thead><tr><th><input type="checkbox" onChange={e => { if (e.target.checked) setSelected(new Set(filtered.map(r => r.__id))); else setSelected(new Set()) }} /></th>{cols.map(c => <th key={c}>{c}</th>)}<th></th></tr></thead>
              <tbody>
                {filtered.length ? filtered.map(r => (
                  <tr key={r.__id} className={selected.has(r.__id) ? 'row-selected' : ''}>
                    <td><input type="checkbox" checked={selected.has(r.__id)} onChange={e => { const s = new Set(selected); if (e.target.checked) s.add(r.__id); else s.delete(r.__id); setSelected(s) }} /></td>
                    {cols.map(c => <td key={c}>{c === 'timestamp' ? fmtTime(r[c]) : typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : 'No') : r[c] ?? '—'}</td>)}
                    <td><button className="copy-btn" onClick={() => setSelectedRecord(r)}><Eye size={10} /> View</button></td>
                  </tr>
                )) : <tr><td colSpan={cols.length + 2}><div className="empty">No matching records.</div></td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <div className="table-pagination">
          <span>Showing {filtered.length} of {rows.length} loaded records (latest {limit})</span>
          <button className="secondary-btn" onClick={loadData}><RefreshCw size={13} />Refresh</button>
        </div>
      </div>
    </div>
    {selectedRecord && <RecordDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    {confirmDelete && <ConfirmModal title="Delete Selected Records" description={`This will permanently delete ${selected.size} selected history records.`} dangerText={`${selected.size} telemetry records will be permanently removed from /smartHelmet/history. This cannot be undone.`} confirmWord="DELETE HISTORY" onConfirm={handleDeleteSelected} onCancel={() => setConfirmDelete(false)} busy={deleteBusy} />}
  </>
}

// ═══════════════════════════════════════════════════════════
// EVENT MANAGER (Alcohol + Accident)
// ═══════════════════════════════════════════════════════════
function EventManager({ type, showToast }: { type: 'alcohol' | 'accident'; showToast: (msg: string, type: ToastType) => void }) {
  const path = type === 'alcohol' ? paths.alcohol : paths.accidents
  const title = type === 'alcohol' ? 'Alcohol Events Manager' : 'Accident Events Manager'
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<any>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [limit, setLimit] = useState(100)
  const [investigateRecord, setInvestigateRecord] = useState<any>(null)

  const loadData = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const data = await readPaginated(path, limit)
      setRows(data.reverse())
    } catch { setError(true) }
    setLoading(false)
  }, [path, limit])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => {
    if (!search) return rows
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
  }, [rows, search])

  const handleDeleteSelected = async () => {
    setDeleteBusy(true)
    try {
      await deleteRecords(path, [...selected])
      await writeAdminAudit('DELETE_RECORDS', path, 'SUCCESS', `${selected.size} ${type} events`)
      showToast(`Deleted ${selected.size} ${type} events`, 'success')
      setSelected(new Set())
      loadData()
    } catch (e) {
      await writeAdminAudit('DELETE_RECORDS', path, 'FAILED', String(e)).catch(() => { })
      showToast('Delete failed', 'error')
    }
    setDeleteBusy(false)
    setConfirmDelete(false)
  }

  const cols = type === 'alcohol'
    ? ['timestamp', 'state', 'alcoholPercent', 'alcoholRaw', 'alcoholDetected', 'deviceMillis']
    : ['timestamp', 'impact', 'peakImpact', 'jerk', 'accelMagnitude', 'accelX', 'accelY', 'accelZ', 'latitude', 'longitude', 'satellites', 'motor', 'buzzer']

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>{title}</h2>
        <span className="section-badge">/{path}</span>
      </div>
      <div className="admin-table-wrap">
        <div className="admin-table-toolbar">
          <div className="admin-table-filters">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${type} events…`} />
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
              <option value={100}>Latest 100</option>
              <option value={500}>Latest 500</option>
              <option value={1000}>Latest 1000</option>
            </select>
          </div>
          <div className="admin-table-actions">
            <button className="secondary-btn" onClick={() => { downloadCsv(`${type}-events.csv`, filtered); writeAdminAudit('EXPORT', path, 'SUCCESS', `CSV ${filtered.length}`).catch(() => { }) }}><Download size={14} />CSV</button>
            <button className="secondary-btn" onClick={() => { downloadJson(`${type}-events.json`, filtered); writeAdminAudit('EXPORT', path, 'SUCCESS', `JSON ${filtered.length}`).catch(() => { }) }}><FileJson size={14} />JSON</button>
            {selected.size > 0 && <button className="danger-btn" onClick={() => setConfirmDelete(true)}><Trash2 size={14} />{selected.size} selected</button>}
          </div>
        </div>
        <div className="admin-table-scroll">
          {loading ? <div className="empty">Loading {type} events…</div> : error ? <div className="empty" style={{ color: 'var(--red)' }}>Failed to load events.</div> : (
            <table className="admin-table">
              <thead><tr><th><input type="checkbox" onChange={e => { if (e.target.checked) setSelected(new Set(filtered.map(r => r.__id))); else setSelected(new Set()) }} /></th>{cols.map(c => <th key={c}>{c}</th>)}<th></th></tr></thead>
              <tbody>
                {filtered.length ? filtered.map(r => (
                  <tr key={r.__id} className={selected.has(r.__id) ? 'row-selected' : ''}>
                    <td><input type="checkbox" checked={selected.has(r.__id)} onChange={e => { const s = new Set(selected); if (e.target.checked) s.add(r.__id); else s.delete(r.__id); setSelected(s) }} /></td>
                    {cols.map(c => <td key={c}>{c === 'timestamp' ? fmtTime(r[c]) : typeof r[c] === 'boolean' ? (r[c] ? 'Yes' : 'No') : r[c] ?? '—'}</td>)}
                    <td>
                      <button className="copy-btn" onClick={() => setSelectedRecord(r)}><Eye size={10} /> View</button>
                      {type === 'accident' && <button className="copy-btn" style={{ marginLeft: 4 }} onClick={() => setInvestigateRecord(r)}>Investigate</button>}
                    </td>
                  </tr>
                )) : <tr><td colSpan={cols.length + 2}><div className="empty">No {type} events recorded.</div></td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <div className="table-pagination">
          <span>Showing {filtered.length} of {rows.length} loaded (latest {limit})</span>
          <button className="secondary-btn" onClick={loadData}><RefreshCw size={13} />Refresh</button>
        </div>
      </div>
    </div>
    {selectedRecord && <RecordDetail record={selectedRecord} onClose={() => setSelectedRecord(null)} />}
    {investigateRecord && <AccidentInvestigation record={investigateRecord} onClose={() => setInvestigateRecord(null)} />}
    {confirmDelete && <ConfirmModal title={`Delete Selected ${type === 'alcohol' ? 'Alcohol' : 'Accident'} Events`} description={`Permanently delete ${selected.size} selected events.`} dangerText={`${selected.size} events will be permanently removed. This cannot be undone.`} confirmWord={`DELETE ${type.toUpperCase()}`} onConfirm={handleDeleteSelected} onCancel={() => setConfirmDelete(false)} busy={deleteBusy} />}
  </>
}

// ═══════════════════════════════════════════════════════════
// ACCIDENT INVESTIGATION VIEW
// ═══════════════════════════════════════════════════════════
function AccidentInvestigation({ record, onClose }: { record: any; onClose: () => void }) {
  const [nearbyHistory, setNearbyHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Try to find nearby history records
    readPaginated(paths.history, 500).then(data => {
      const ts = record.timestamp || 0
      const nearby = data.filter((r: any) => Math.abs((r.timestamp || 0) - ts) < 120000) // within 2 minutes
        .sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0))
      setNearbyHistory(nearby)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [record])

  const gpsValid = record.latitude && record.longitude && Math.abs(record.latitude) <= 90 && Math.abs(record.longitude) <= 180

  const before = nearbyHistory.filter((r: any) => r.timestamp < record.timestamp)
  const after = nearbyHistory.filter((r: any) => r.timestamp > record.timestamp)

  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="modal-content" style={{ width: 'min(700px, 95vw)', maxHeight: '90vh', overflow: 'auto' }}>
      <div className="investigation-header">
        <div className="inv-badge"><Siren size={12} /> CRITICAL ALERT</div>
        <h2>Accident Event Investigation</h2>
        <p className="muted">Detailed analysis of accident event</p>
      </div>

      <div className="telemetry-section">
        <div className="telemetry-section-title">EVENT DETAILS</div>
        <div className="telemetry-grid">
          <div className="telemetry-item"><div className="telemetry-item-label">Time</div><div className="telemetry-item-value" style={{ fontSize: 13 }}>{fmtTime(record.timestamp)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Impact</div><div className="telemetry-item-value danger">{num(record.impact)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Peak Impact</div><div className="telemetry-item-value danger">{num(record.peakImpact)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Jerk</div><div className="telemetry-item-value warning">{num(record.jerk)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Magnitude</div><div className="telemetry-item-value">{num(record.accelMagnitude)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">X</div><div className="telemetry-item-value">{num(record.accelX)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Y</div><div className="telemetry-item-value">{num(record.accelY)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Z</div><div className="telemetry-item-value">{num(record.accelZ)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Impact Events</div><div className="telemetry-item-value">{num(record.impactEvents)}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Motor</div><div className="telemetry-item-value">{record.motor ? 'RUNNING' : 'STOPPED'}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Buzzer</div><div className="telemetry-item-value">{record.buzzer ? 'ACTIVE' : 'Silent'}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">GPS Fix</div><div className="telemetry-item-value">{record.gpsFix ? 'YES' : 'NO'}</div></div>
          <div className="telemetry-item"><div className="telemetry-item-label">Satellites</div><div className="telemetry-item-value">{record.satellites ?? 0}</div></div>
        </div>
      </div>

      {gpsValid && <div style={{ marginBottom: 16 }}>
        <div className="telemetry-section-title">LOCATION</div>
        <div style={{ height: 200, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <MapContainer center={[record.latitude, record.longitude]} zoom={15} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[record.latitude, record.longitude]}>
              <Popup>Accident Location<br />{record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}</Popup>
            </Marker>
          </MapContainer>
        </div>
        <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>Location: {record.latitude?.toFixed(6)}, {record.longitude?.toFixed(6)}</p>
      </div>}

      {/* Timeline */}
      <div className="telemetry-section-title">EVENT TIMELINE</div>
      <div className="inv-timeline">
        <div className="inv-phase before">
          <h4>Before Event</h4>
          <p>{before.length} readings</p>
          {before.length > 0 && <p style={{ fontSize: 9, marginTop: 4 }}>
            Avg impact: {Math.round(before.reduce((s: number, r: any) => s + num(r.impact), 0) / before.length)}
          </p>}
        </div>
        <div className="inv-divider">→</div>
        <div className="inv-phase during">
          <h4>Accident</h4>
          <p>Impact: {num(record.impact)}</p>
          <p style={{ fontSize: 9, marginTop: 4 }}>{fmtTime(record.timestamp)}</p>
        </div>
        <div className="inv-divider">→</div>
        <div className="inv-phase after">
          <h4>After Event</h4>
          <p>{after.length} readings</p>
          {after.length > 0 && <p style={{ fontSize: 9, marginTop: 4 }}>
            Recovery: {humanState(after[after.length - 1]?.state)}
          </p>}
        </div>
      </div>

      <div className="modal-buttons" style={{ marginTop: 20 }}>
        <button className="secondary-btn" onClick={() => { downloadJson('accident-investigation.json', { event: record, before, after }) }}>
          <Download size={14} />Export Investigation
        </button>
        <button className="secondary-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>
}

// ═══════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════
function UserManager({ showToast }: { showToast: (msg: string, type: ToastType) => void }) {
  const [users, setUsers] = useState<Record<string, any>>({})
  const [admins, setAdmins] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<{ uid: string; data: any } | null>(null)
  const [roleChangeBusy, setRoleChangeBusy] = useState(false)

  useEffect(() => {
    Promise.all([readAllUsers(), readAllAdmins()])
      .then(([u, a]) => { setUsers(u); setAdmins(a) })
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const userList = useMemo(() => {
    return Object.entries(users).map(([uid, data]) => ({
      uid, ...data, isAdmin: !!admins[uid]
    })).filter(u => {
      if (!search) return true
      return JSON.stringify(u).toLowerCase().includes(search.toLowerCase())
    })
  }, [users, admins, search])

  const handleRoleChange = async (uid: string, email: string, makeAdmin: boolean) => {
    setRoleChangeBusy(true)
    try {
      await setAdminRole(uid, makeAdmin)
      await writeAdminAudit('ROLE_CHANGE', `admins/${uid}`, 'SUCCESS', `${email}: ${makeAdmin ? 'USER → ADMIN' : 'ADMIN → USER'}`)
      setAdmins(prev => {
        const next = { ...prev }
        if (makeAdmin) next[uid] = true
        else delete next[uid]
        return next
      })
      showToast(`${email} is now ${makeAdmin ? 'ADMIN' : 'USER'}`, 'success')
    } catch (e) {
      await writeAdminAudit('ROLE_CHANGE', `admins/${uid}`, 'FAILED', String(e)).catch(() => { })
      showToast('Role change failed. Check Firebase rules.', 'error')
    }
    setRoleChangeBusy(false)
  }

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>User Management</h2>
        <span className="section-badge">{userList.length} users</span>
      </div>

      <div className="card" style={{ marginBottom: 14, padding: 14 }}>
        <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
          <Lock size={12} style={{ verticalAlign: 'middle' }} /> Firebase Auth account operations (disable/enable/delete) require a secure backend with Firebase Admin SDK. This panel manages application-level roles stored in <code>/admins</code> and user profiles stored in <code>/users</code>.
        </p>
      </div>

      <div className="admin-table-wrap">
        <div className="admin-table-toolbar">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…" />
          <button className="secondary-btn" onClick={() => { downloadCsv('users.csv', userList); writeAdminAudit('EXPORT', 'users', 'SUCCESS', `${userList.length} users`).catch(() => { }) }}><Download size={14} />Export</button>
        </div>
        <div className="admin-table-scroll">
          {loading ? <div className="empty">Loading users…</div> : (
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Email</th><th>UID</th><th>Created</th><th>Role</th><th>Helmet</th><th>Emergency</th><th>Actions</th></tr></thead>
              <tbody>
                {userList.length ? userList.map(u => (
                  <tr key={u.uid}>
                    <td>{u.name || '—'}</td>
                    <td>{u.email || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 9 }}>{u.uid.substring(0, 12)}…</td>
                    <td>{fmtTime(u.createdAt)}</td>
                    <td><span className={`role-badge ${u.isAdmin ? 'admin-role' : 'user-role'}`}>{u.isAdmin ? 'ADMIN' : 'USER'}</span></td>
                    <td>{u.helmetName || '—'}</td>
                    <td>{u.emergencyContact || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="copy-btn" onClick={() => setSelectedUser({ uid: u.uid, data: u })}><Eye size={10} /> Profile</button>
                        {u.uid !== auth.currentUser?.uid && (
                          <button className={u.isAdmin ? 'copy-btn' : 'copy-btn'} disabled={roleChangeBusy} onClick={() => handleRoleChange(u.uid, u.email, !u.isAdmin)}>
                            {u.isAdmin ? <><Unlock size={10} /> Remove Admin</> : <><Lock size={10} /> Make Admin</>}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={8}><div className="empty">No users found.</div></td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    {selectedUser && <UserProfilePanel uid={selectedUser.uid} data={selectedUser.data} isAdmin={!!admins[selectedUser.uid]} onClose={() => setSelectedUser(null)} />}
  </>
}

function UserProfilePanel({ uid, data, isAdmin, onClose }: { uid: string; data: any; isAdmin: boolean; onClose: () => void }) {
  const [recentAlcohol, setRecentAlcohol] = useState<any[]>([])
  const [recentAccidents, setRecentAccidents] = useState<any[]>([])

  useEffect(() => {
    readLatest(paths.alcohol, 10).then(setRecentAlcohol).catch(() => { })
    readLatest(paths.accidents, 10).then(setRecentAccidents).catch(() => { })
  }, [])

  return <div className="record-detail-panel">
    <button className="record-detail-close" onClick={onClose}><X size={16} /></button>
    <h3>User Profile</h3>
    <div className="user-profile-card" style={{ marginBottom: 18 }}>
      <div className="user-avatar-large">{(data.name?.[0] || data.email?.[0] || 'U').toUpperCase()}</div>
      <div className="user-profile-info">
        <h3>{data.name || 'Unknown'}</h3>
        <p>{data.email || '—'}</p>
        <span className={`role-badge ${isAdmin ? 'admin-role' : 'user-role'}`} style={{ marginTop: 6 }}>{isAdmin ? 'ADMIN' : 'USER'}</span>
      </div>
    </div>
    <div className="user-profile-meta">
      <div className="user-meta-item"><label>UID</label><span style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{uid}</span></div>
      <div className="user-meta-item"><label>Created At</label><span>{fmtTime(data.createdAt)}</span></div>
      <div className="user-meta-item"><label>Emergency Contact</label><span>{data.emergencyContact || '—'}</span></div>
      <div className="user-meta-item"><label>Emergency Phone</label><span>{data.emergencyPhone || '—'}</span></div>
      <div className="user-meta-item"><label>Helmet Name</label><span>{data.helmetName || 'smartHelmet-01'}</span></div>
    </div>
    <div style={{ marginTop: 18 }}>
      <h4 style={{ fontSize: 12, marginBottom: 8 }}>Recent Alcohol Events</h4>
      {recentAlcohol.length > 0 ? recentAlcohol.slice(0, 5).map((e, i) => (
        <div key={i} className="info-row"><span>{fmtTime(e.timestamp)}</span><strong>{num(e.alcoholPercent)}%</strong></div>
      )) : <div className="empty" style={{ padding: 10 }}>No alcohol events</div>}
    </div>
    <div style={{ marginTop: 14 }}>
      <h4 style={{ fontSize: 12, marginBottom: 8 }}>Recent Accident Events</h4>
      {recentAccidents.length > 0 ? recentAccidents.slice(0, 5).map((e, i) => (
        <div key={i} className="info-row"><span>{fmtTime(e.timestamp)}</span><strong>Impact: {num(e.impact)}</strong></div>
      )) : <div className="empty" style={{ padding: 10 }}>No accident events</div>}
    </div>
  </div>
}

// ═══════════════════════════════════════════════════════════
// DEVICE MANAGEMENT
// ═══════════════════════════════════════════════════════════
function DeviceManager() {
  const { live, firebaseOnline, deviceOnline, lastDataAt } = hooks.useLiveHelmet()
  const score = safetyScore(live, deviceOnline)

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Device Management</h2>
        <span className="section-badge">1 device</span>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div className="kpi-icon" style={{ background: 'rgba(69,216,255,.08)', color: 'var(--cyan)', width: 56, height: 56, borderRadius: 16 }}><Cpu size={28} /></div>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>smartHelmet-01</h3>
            <p className="muted" style={{ fontSize: 11 }}>ESP32-D0WD-V3 · Primary Device</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <span className={`live-indicator ${deviceOnline ? 'online' : 'offline'}`}>
                {deviceOnline && <span className="live-pulse" />}
                {deviceOnline ? 'Online' : 'Offline'}
              </span>
              <span className={`severity-badge ${score.score >= 75 ? 'info' : score.score >= 50 ? 'warning' : 'critical'}`}>
                Safety: {score.score}/100
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="card">
          <h4 style={{ fontSize: 13, marginBottom: 10 }}>Device Status</h4>
          <div className="info-row"><span>Status</span><strong className={deviceOnline ? 'text-green' : 'text-red'}>{deviceOnline ? 'Online' : 'Offline'}</strong></div>
          <div className="info-row"><span>Last Seen</span><strong>{lastDataAt ? fmtAgo(lastDataAt) : 'Never'}</strong></div>
          <div className="info-row"><span>Current State</span><strong>{humanState(live?.state)}</strong></div>
          <div className="info-row"><span>Firebase</span><strong className={firebaseOnline ? 'text-green' : 'text-red'}>{firebaseOnline ? 'Connected' : 'Disconnected'}</strong></div>
        </div>
        <div className="card">
          <h4 style={{ fontSize: 13, marginBottom: 10 }}>Sensors</h4>
          <div className="info-row"><span>GPS</span><strong>{live?.gpsFix ? `Fix (${live.satellites} sats)` : 'No Fix'}</strong></div>
          <div className="info-row"><span>Alcohol Sensor</span><strong>{num(live?.alcoholPercent)}%</strong></div>
          <div className="info-row"><span>Accelerometer</span><strong>Mag: {num(live?.accelMagnitude)}</strong></div>
          <div className="info-row"><span>Motor</span><strong>{live?.motor ? 'Running' : 'Stopped'}</strong></div>
        </div>
        <div className="card">
          <h4 style={{ fontSize: 13, marginBottom: 10 }}>Safety</h4>
          <div className="info-row"><span>Safety Score</span><strong>{score.score}/100</strong></div>
          <div className="info-row"><span>Status</span><strong>{score.label}</strong></div>
          <div className="info-row"><span>Buzzer</span><strong>{live?.buzzer ? 'Active' : 'Silent'}</strong></div>
          <div className="info-row"><span>Accident</span><strong className={live?.accident ? 'text-red' : 'text-green'}>{live?.accident ? 'Detected' : 'None'}</strong></div>
        </div>
      </div>

      <div className="card">
        <p className="muted" style={{ fontSize: 11 }}>
          <Smartphone size={12} style={{ verticalAlign: 'middle' }} /> The system is prepared for future multi-device support. Additional helmets (smartHelmet-02, smartHelmet-03, etc.) can be registered as they become available. Only currently configured devices are displayed.
        </p>
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// ALERT MONITOR
// ═══════════════════════════════════════════════════════════
function AlertMonitor() {
  const { live, deviceOnline } = hooks.useLiveHelmet()
  const [alcoholEvents, setAlcoholEvents] = useState<any[]>([])
  const [accidentEvents, setAccidentEvents] = useState<any[]>([])
  const [filter, setFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('7d')

  useEffect(() => {
    readLatest(paths.alcohol, 200).then(setAlcoholEvents).catch(() => { })
    readLatest(paths.accidents, 200).then(setAccidentEvents).catch(() => { })
  }, [])

  const alerts = useMemo(() => {
    const all: any[] = []

    // Current live alerts
    if (live?.accident) all.push({ type: 'Accident', severity: 'CRITICAL', title: 'Active accident alert', detail: `Impact: ${num(live.impact)}`, timestamp: Date.now() })
    if (live?.alcoholDetected) all.push({ type: 'Alcohol', severity: 'WARNING', title: 'Active alcohol warning', detail: `Level: ${num(live.alcoholPercent)}%`, timestamp: Date.now() })
    if (!deviceOnline) all.push({ type: 'Device', severity: 'WARNING', title: 'Device offline', detail: 'No recent telemetry received', timestamp: Date.now() })
    if (live && !live.gpsFix) all.push({ type: 'GPS', severity: 'INFO', title: 'GPS unavailable', detail: 'Waiting for GPS fix', timestamp: Date.now() })

    // Historical events
    accidentEvents.forEach(e => all.push({ type: 'Accident', severity: 'CRITICAL', title: 'Accident event', detail: `Impact: ${num(e.impact)}`, timestamp: e.timestamp }))
    alcoholEvents.forEach(e => all.push({ type: 'Alcohol', severity: 'WARNING', title: 'Alcohol event', detail: `Level: ${num(e.alcoholPercent)}%`, timestamp: e.timestamp }))

    let filtered = all
    if (filter !== 'all') filtered = filtered.filter(a => a.severity === filter)

    const now = Date.now()
    if (dateFilter === 'today') filtered = filtered.filter(a => a.timestamp && now - a.timestamp < 86400000)
    if (dateFilter === '7d') filtered = filtered.filter(a => a.timestamp && now - a.timestamp < 7 * 86400000)
    if (dateFilter === '30d') filtered = filtered.filter(a => a.timestamp && now - a.timestamp < 30 * 86400000)

    return filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  }, [live, deviceOnline, alcoholEvents, accidentEvents, filter, dateFilter])

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Global Alert Monitor</h2>
        <span className="section-badge">{alerts.length} alerts</span>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {['all', 'CRITICAL', 'WARNING', 'INFO'].map(f => (
            <button key={f} className={`copy-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)} style={filter === f ? { background: 'rgba(69,216,255,.1)', color: 'var(--cyan)' } : {}}>
              {f === 'all' ? 'All' : f}
            </button>
          ))}
          <span style={{ borderLeft: '1px solid var(--border)', margin: '0 4px' }} />
          {['today', '7d', '30d', 'all'].map(f => (
            <button key={f} className={`copy-btn ${dateFilter === f ? 'active' : ''}`} onClick={() => setDateFilter(f)} style={dateFilter === f ? { background: 'rgba(69,216,255,.1)', color: 'var(--cyan)' } : {}}>
              {f === 'today' ? 'Today' : f === '7d' ? '7 Days' : f === '30d' ? '30 Days' : 'All Time'}
            </button>
          ))}
        </div>
        {alerts.length > 0 ? alerts.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
            <span className={`severity-badge ${a.severity.toLowerCase()}`}>{a.severity}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 12, display: 'block' }}>{a.title}</strong>
              <span style={{ fontSize: 10, color: '#6d839b' }}>{a.detail}</span>
            </div>
            <span style={{ fontSize: 10, color: '#4d6580', whiteSpace: 'nowrap' }}>{fmtAgo(a.timestamp)}</span>
          </div>
        )) : <div className="empty">No alerts in selected range.</div>}
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// ADMIN ANALYTICS
// ═══════════════════════════════════════════════════════════
function AdminAnalytics() {
  const [historyCount, setHistoryCount] = useState(0)
  const [alcoholCount, setAlcoholCount] = useState(0)
  const [accidentCount, setAccidentCount] = useState(0)
  const [userCount, setUserCount] = useState(0)
  const { live, deviceOnline } = hooks.useLiveHelmet()
  const history = hooks.useLatestHistory(300) as any[]

  useEffect(() => {
    estimateBranchSize(paths.history).then(r => setHistoryCount(r.count)).catch(() => { })
    estimateBranchSize(paths.alcohol).then(r => setAlcoholCount(r.count)).catch(() => { })
    estimateBranchSize(paths.accidents).then(r => setAccidentCount(r.count)).catch(() => { })
    readAllUsers().then(u => setUserCount(Object.keys(u).length)).catch(() => { })
  }, [])

  const score = safetyScore(live, deviceOnline)
  const avgAlcohol = history.length ? history.reduce((s, r) => s + num(r.alcoholPercent), 0) / history.length : 0
  const maxImpact = Math.max(0, ...history.map(r => num(r.peakImpact)))
  const accidentMarked = history.filter(r => r.accident).length

  // Daily event counts from loaded history
  const dailyStats = useMemo(() => {
    const days: Record<string, { alcohol: number; accident: number; total: number }> = {}
    history.forEach(r => {
      if (!r.timestamp) return
      const day = new Date(r.timestamp).toLocaleDateString()
      if (!days[day]) days[day] = { alcohol: 0, accident: 0, total: 0 }
      days[day].total++
      if (r.alcoholDetected) days[day].alcohol++
      if (r.accident) days[day].accident++
    })
    return Object.entries(days).map(([day, stats]) => ({ day, ...stats })).slice(-14)
  }, [history])

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Admin Analytics</h2>
        <span className="section-badge">Based on loaded data</span>
      </div>
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <KpiCard icon={Database} value={historyCount} label="Total History Records" accent="cyan" />
        <KpiCard icon={AlertTriangle} value={alcoholCount} label="Total Alcohol Events" accent="amber" />
        <KpiCard icon={Siren} value={accidentCount} label="Total Accident Events" accent="red" />
        <KpiCard icon={Users} value={userCount} label="Registered Users" accent="green" />
      </div>
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <KpiCard icon={TrendingUp} value={`${avgAlcohol.toFixed(1)}%`} label="Avg Alcohol (loaded)" accent="amber" trend="Calculated" />
        <KpiCard icon={Zap} value={maxImpact} label="Max Peak Impact" accent="red" trend="Measured" />
        <KpiCard icon={Activity} value={accidentMarked} label="Accident Readings (loaded)" accent="red" trend="Measured" />
        <KpiCard icon={ShieldCheck} value={`${score.score}/100`} label="Current Safety Score" accent="green" trend={score.label} />
      </div>

      {/* Safety Score Analysis */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div><h3>Safety Score Analysis</h3><p className="muted">Current informational score contributors</p></div><ShieldCheck size={18} /></div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 52, fontWeight: 900, color: 'var(--cyan)' }}>{score.score}<span style={{ fontSize: 14, color: 'var(--muted)' }}>/100</span></div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', color: 'var(--cyan)', marginBottom: 6 }}>{score.label}</div>
            {score.reasons.map(r => <div key={r} style={{ fontSize: 11, color: '#7d93aa', lineHeight: 1.6 }}>• {r}</div>)}
          </div>
        </div>
        <p style={{ fontSize: 9, color: '#4d6580', marginTop: 12 }}>This is an app-defined informational indicator based on available device signals. It is NOT medical, scientifically validated, an official driving score, or a safety certification.</p>
      </div>

      {/* Daily Stats */}
      {dailyStats.length > 0 && <div className="card">
        <div className="card-head"><div><h3>Daily Activity (Loaded Period)</h3><p className="muted">Telemetry and event counts by day</p></div></div>
        <div className="admin-table-scroll" style={{ maxHeight: 300 }}>
          <table className="admin-table">
            <thead><tr><th>Day</th><th>Total Readings</th><th>Alcohol Alerts</th><th>Accident Alerts</th></tr></thead>
            <tbody>
              {dailyStats.map(d => (
                <tr key={d.day}><td>{d.day}</td><td>{d.total}</td><td>{d.alcohol}</td><td>{d.accident}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 9, marginTop: 8 }}>Statistics are calculated from loaded telemetry data, not the entire database.</p>
      </div>}
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// EXPORT CENTER
// ═══════════════════════════════════════════════════════════
function ExportCenter({ showToast }: { showToast: (msg: string, type: ToastType) => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  const doExport = async (label: string, path: string, format: 'csv' | 'json', limit = 500) => {
    setBusy(label)
    try {
      const data = await readPaginated(path, limit)
      if (format === 'csv') downloadCsv(`${label.toLowerCase().replace(/\s+/g, '-')}.csv`, data)
      else downloadJson(`${label.toLowerCase().replace(/\s+/g, '-')}.json`, data)
      await writeAdminAudit('EXPORT', path, 'SUCCESS', `${format.toUpperCase()} ${data.length} records`)
      showToast(`Exported ${data.length} ${label} records`, 'success')
    } catch {
      showToast(`Failed to export ${label}`, 'error')
    }
    setBusy(null)
  }

  const exportUsers = async (format: 'csv' | 'json') => {
    setBusy('Users')
    try {
      const users = await readAllUsers()
      const data = Object.entries(users).map(([uid, d]) => ({ uid, ...(d as object) }))
      if (format === 'csv') downloadCsv('users.csv', data)
      else downloadJson('users.json', data)
      await writeAdminAudit('EXPORT', 'users', 'SUCCESS', `${format.toUpperCase()} ${data.length}`)
      showToast(`Exported ${data.length} user profiles`, 'success')
    } catch { showToast('Failed to export users', 'error') }
    setBusy(null)
  }

  const exportAudit = async (format: 'csv' | 'json') => {
    setBusy('Audit')
    try {
      const data = await readAuditLogs(500)
      if (format === 'csv') downloadCsv('audit-logs.csv', data)
      else downloadJson('audit-logs.json', data)
      showToast(`Exported ${data.length} audit logs`, 'success')
    } catch { showToast('Failed to export audit logs', 'error') }
    setBusy(null)
  }

  const items = [
    { label: 'Telemetry History', path: paths.history, desc: 'Historical helmet readings from the ESP32' },
    { label: 'Alcohol Events', path: paths.alcohol, desc: 'All stored alcohol detection events' },
    { label: 'Accident Events', path: paths.accidents, desc: 'All stored accident alert events' },
  ]

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Admin Export Center</h2>
      </div>
      <div className="export-grid">
        {items.map(item => (
          <div className="export-item" key={item.label}>
            <h4>{item.label}</h4>
            <p>{item.desc}</p>
            <div className="export-item-btns">
              <button className="secondary-btn" disabled={busy === item.label} onClick={() => doExport(item.label, item.path, 'csv')}><Download size={13} />CSV</button>
              <button className="secondary-btn" disabled={busy === item.label} onClick={() => doExport(item.label, item.path, 'json')}><FileJson size={13} />JSON</button>
            </div>
          </div>
        ))}
        <div className="export-item">
          <h4>User Profiles</h4>
          <p>Registered application user data</p>
          <div className="export-item-btns">
            <button className="secondary-btn" disabled={busy === 'Users'} onClick={() => exportUsers('csv')}><Download size={13} />CSV</button>
            <button className="secondary-btn" disabled={busy === 'Users'} onClick={() => exportUsers('json')}><FileJson size={13} />JSON</button>
          </div>
        </div>
        <div className="export-item">
          <h4>Audit Logs</h4>
          <p>Admin action history</p>
          <div className="export-item-btns">
            <button className="secondary-btn" disabled={busy === 'Audit'} onClick={() => exportAudit('csv')}><Download size={13} />CSV</button>
            <button className="secondary-btn" disabled={busy === 'Audit'} onClick={() => exportAudit('json')}><FileJson size={13} />JSON</button>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <p className="muted" style={{ fontSize: 11 }}>Exports are limited to the latest 500 records per branch to prevent excessive browser memory usage. For larger exports, use Firebase console or a server-side script.</p>
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════
function AuditLogsPanel() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [view, setView] = useState<'timeline' | 'table'>('timeline')

  useEffect(() => {
    readAuditLogs(500).then(setLogs).catch(() => setError(true)).finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (search && !JSON.stringify(l).toLowerCase().includes(search.toLowerCase())) return false
      if (actionFilter && l.action !== actionFilter) return false
      return true
    })
  }, [logs, search, actionFilter])

  const actions = useMemo(() => [...new Set(logs.map(l => l.action).filter(Boolean))], [logs])

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Audit Logs</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`copy-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')} style={view === 'timeline' ? { background: 'rgba(69,216,255,.1)', color: 'var(--cyan)' } : {}}>Timeline</button>
          <button className={`copy-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} style={view === 'table' ? { background: 'rgba(69,216,255,.1)', color: 'var(--cyan)' } : {}}>Table</button>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search audit logs…" />
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
            <option value="">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="secondary-btn" onClick={() => { downloadCsv('audit-logs.csv', filtered) }}><Download size={14} />Export</button>
        </div>

        {loading ? <div className="empty">Loading audit logs…</div> : error ? <div className="empty" style={{ color: 'var(--red)' }}>Failed to load audit logs.</div> : (
          view === 'timeline' ? (
            filtered.length > 0 ? <div className="audit-timeline">
              {filtered.slice(0, 50).map((log, i) => (
                <div key={i} className={`audit-entry ${log.action?.includes('CLEAR') || log.action?.includes('DELETE') ? 'audit-danger' : log.action?.includes('ROLE') ? 'audit-warning' : ''}`}>
                  <div className="audit-action">{log.action}</div>
                  <div className="audit-detail">
                    {log.adminEmail} · {log.path || '—'} · <span className={`severity-badge ${log.result === 'SUCCESS' ? 'info' : 'critical'}`}>{log.result}</span>
                    {log.details && <span> · {log.details}</span>}
                  </div>
                  <div className="audit-time">{fmtTime(log.timestamp)}</div>
                </div>
              ))}
            </div> : <div className="empty">No audit logs match your filters.</div>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead><tr><th>Timestamp</th><th>Admin</th><th>Action</th><th>Path</th><th>Result</th><th>Details</th></tr></thead>
                <tbody>
                  {filtered.length ? filtered.slice(0, 100).map((l, i) => (
                    <tr key={i}><td>{fmtTime(l.timestamp)}</td><td>{l.adminEmail || '—'}</td><td>{l.action}</td><td style={{ fontFamily: 'monospace', fontSize: 9 }}>{l.path || '—'}</td><td><span className={`severity-badge ${l.result === 'SUCCESS' ? 'info' : 'critical'}`}>{l.result}</span></td><td>{l.details || '—'}</td></tr>
                  )) : <tr><td colSpan={6}><div className="empty">No audit logs.</div></td></tr>}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// DATA RETENTION MANAGER
// ═══════════════════════════════════════════════════════════
function RetentionManager({ showToast }: { showToast: (msg: string, type: ToastType) => void }) {
  const [selectedRetention, setSelectedRetention] = useState<number | null>(null)
  const [branchSizes, setBranchSizes] = useState<Record<string, any>>({})
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewBranch, setPreviewBranch] = useState<string>(paths.history)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)

  const retentionOptions = [
    { label: '1 Day', days: 1 },
    { label: '7 Days', days: 7 },
    { label: '30 Days', days: 30 },
    { label: '90 Days', days: 90 },
    { label: '1 Year', days: 365 },
    { label: 'Forever', days: -1 },
  ]

  useEffect(() => {
    const branches = [paths.history, paths.alcohol, paths.accidents]
    branches.forEach(p => {
      estimateBranchSize(p).then(r => setBranchSizes(prev => ({ ...prev, [p]: r }))).catch(() => { })
    })
  }, [])

  const handlePreview = async () => {
    if (!selectedRetention || selectedRetention < 0) return
    setPreviewLoading(true)
    try {
      const cutoff = Date.now() - selectedRetention * 86400000
      const data = await readBranchData(previewBranch)
      if (!data || typeof data !== 'object') { setPreviewCount(0); setPreviewLoading(false); return }
      const count = Object.values(data).filter((r: any) => r?.timestamp && r.timestamp < cutoff).length
      setPreviewCount(count)
    } catch { showToast('Failed to preview', 'error') }
    setPreviewLoading(false)
  }

  const handleCleanup = async () => {
    if (!selectedRetention || selectedRetention < 0) return
    setCleanupBusy(true)
    try {
      const cutoff = Date.now() - selectedRetention * 86400000
      const deleted = await deleteRecordsBefore(previewBranch, cutoff)
      await writeAdminAudit('RETENTION_CLEANUP', previewBranch, 'SUCCESS', `${deleted} records older than ${selectedRetention} days`)
      showToast(`Cleaned up ${deleted} old records`, 'success')
      setPreviewCount(null)
      // Refresh sizes
      estimateBranchSize(previewBranch).then(r => setBranchSizes(prev => ({ ...prev, [previewBranch]: r }))).catch(() => { })
    } catch (e) {
      await writeAdminAudit('RETENTION_CLEANUP', previewBranch, 'FAILED', String(e)).catch(() => { })
      showToast('Cleanup failed', 'error')
    }
    setCleanupBusy(false)
    setConfirmCleanup(false)
  }

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Data Retention</h2>
      </div>

      {/* Branch info */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div><h3>Database Summary</h3><p className="muted">Current data across managed branches</p></div></div>
        <div className="system-status-grid">
          <StatusItem ok={!!branchSizes[paths.history]?.exists} label="History" detail={branchSizes[paths.history] ? `${branchSizes[paths.history].count} records` : 'Checking…'} />
          <StatusItem ok={!!branchSizes[paths.alcohol]?.exists} label="Alcohol Events" detail={branchSizes[paths.alcohol] ? `${branchSizes[paths.alcohol].count} records` : 'Checking…'} />
          <StatusItem ok={!!branchSizes[paths.accidents]?.exists} label="Accident Events" detail={branchSizes[paths.accidents] ? `${branchSizes[paths.accidents].count} records` : 'Checking…'} />
        </div>
      </div>

      {/* Retention selector */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head"><div><h3>Retention Policy</h3><p className="muted">Select how old data should be retained</p></div></div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ marginBottom: 8, display: 'block' }}>Target Branch</label>
          <select value={previewBranch} onChange={e => { setPreviewBranch(e.target.value); setPreviewCount(null) }} style={{ background: '#0a111d', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 11, padding: '9px 12px', fontSize: 12, width: '100%', maxWidth: 300 }}>
            <option value={paths.history}>History</option>
            <option value={paths.alcohol}>Alcohol Events</option>
            <option value={paths.accidents}>Accident Events</option>
          </select>
        </div>

        <div className="retention-options" style={{ marginBottom: 14 }}>
          {retentionOptions.map(opt => (
            <button key={opt.days} className={`retention-option ${selectedRetention === opt.days ? 'selected' : ''}`} onClick={() => { setSelectedRetention(opt.days); setPreviewCount(null) }}>
              {opt.label}
            </button>
          ))}
        </div>

        {selectedRetention && selectedRetention > 0 && <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="secondary-btn" onClick={handlePreview} disabled={previewLoading}>
              <Eye size={14} />{previewLoading ? 'Previewing…' : 'Preview Cleanup'}
            </button>
            {previewCount !== null && previewCount > 0 && (
              <button className="danger-btn" onClick={() => setConfirmCleanup(true)}>
                <Trash2 size={14} />Delete {previewCount} Old Records
              </button>
            )}
          </div>
          {previewCount !== null && (
            <div className="notice" style={{ marginTop: 12 }}>
              <strong>{previewCount}</strong> records are older than {selectedRetention} days in {previewBranch.split('/').pop()}.
              {previewCount === 0 && ' No records to clean up.'}
            </div>
          )}
        </>}
        {selectedRetention === -1 && <div className="notice" style={{ marginTop: 12 }}>Forever: All data will be retained indefinitely. No cleanup action needed.</div>}
      </div>

      <div className="card admin-warning">
        <AlertTriangle size={18} />
        <div>
          <strong>Retention cleanup is explicit and audited.</strong>
          <span>Data is NOT automatically deleted when a retention option is selected. You must explicitly preview and confirm the cleanup action.</span>
        </div>
      </div>
    </div>
    {confirmCleanup && selectedRetention && selectedRetention > 0 && <ConfirmModal title="Confirm Retention Cleanup" description={`Delete records older than ${selectedRetention} days from ${previewBranch}.`} dangerText={`${previewCount ?? 0} records will be permanently deleted. This action cannot be undone.`} confirmWord="DELETE OLD RECORDS" onConfirm={handleCleanup} onCancel={() => setConfirmCleanup(false)} busy={cleanupBusy} />}
  </>
}

// ═══════════════════════════════════════════════════════════
// SECURITY CENTER
// ═══════════════════════════════════════════════════════════
function SecurityCenter() {
  const { admin } = hooks.useAuthState()
  const { firebaseOnline } = hooks.useLiveHelmet()
  const [recentAudits, setRecentAudits] = useState<any[]>([])
  const [adminCount, setAdminCount] = useState(0)

  useEffect(() => {
    readAuditLogs(20).then(setRecentAudits).catch(() => { })
    readAllAdmins().then(a => setAdminCount(Object.keys(a).length)).catch(() => { })
  }, [])

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Security Center</h2>
        <span className="section-badge"><Shield size={14} /> Security Overview</span>
      </div>

      <div className="security-grid" style={{ marginBottom: 14 }}>
        <div className={`security-item ${admin ? 'security-ok' : 'security-bad'}`}>
          <h4>Authentication</h4>
          <p>Current admin: {auth.currentUser?.email}</p>
          <p>UID: <code style={{ fontSize: 9 }}>{auth.currentUser?.uid}</code></p>
        </div>
        <div className={`security-item ${admin ? 'security-ok' : 'security-bad'}`}>
          <h4>Admin Role</h4>
          <p>Role verified: {admin ? 'YES' : 'NO'}</p>
          <p>{adminCount} admin(s) registered</p>
        </div>
        <div className={`security-item ${firebaseOnline ? 'security-ok' : 'security-warn'}`}>
          <h4>Firebase Connection</h4>
          <p>Status: {firebaseOnline ? 'Connected' : 'Disconnected'}</p>
          <p>Realtime DB active</p>
        </div>
        <div className="security-item security-ok">
          <h4>Database Rules</h4>
          <p>Rules configured in firebase.rules.json</p>
          <p>Admin operations require /admins/{'{uid}'} = true</p>
        </div>
        <div className="security-item security-warn">
          <h4>Backend Operations</h4>
          <p>Firebase Auth admin operations (disable/delete accounts) require Firebase Admin SDK on a secure server.</p>
          <p>Client-side code cannot perform privileged Auth operations.</p>
        </div>
        <div className="security-item security-ok">
          <h4>Audit Trail</h4>
          <p>{recentAudits.length > 0 ? `${recentAudits.length} recent audit entries` : 'No audit entries yet'}</p>
          <p>All admin actions are logged to /adminAuditLogs</p>
        </div>
      </div>

      {/* Recent Admin Activity */}
      <div className="card">
        <div className="card-head"><div><h3>Recent Admin Activity</h3><p className="muted">Latest security-relevant actions</p></div></div>
        {recentAudits.length > 0 ? (
          <div className="audit-timeline">
            {recentAudits.slice(0, 10).map((a, i) => (
              <div key={i} className={`audit-entry ${a.action?.includes('DELETE') || a.action?.includes('CLEAR') ? 'audit-danger' : ''}`}>
                <div className="audit-action">{a.action}</div>
                <div className="audit-detail">{a.adminEmail} · {a.result}</div>
                <div className="audit-time">{fmtTime(a.timestamp)}</div>
              </div>
            ))}
          </div>
        ) : <div className="empty">No admin activity recorded.</div>}
      </div>

      <div className="card admin-warning" style={{ marginTop: 14 }}>
        <AlertTriangle size={18} />
        <div>
          <strong>Security Reminder</strong>
          <span>Never store Firebase Admin SDK private keys, Telegram tokens, or Gmail passwords in frontend code. All privileged operations must use a secure backend.</span>
        </div>
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// ADMIN SETTINGS
// ═══════════════════════════════════════════════════════════
function AdminSettings() {
  const [historyLimit, setHistoryLimit] = useState(100)
  const [theme, setTheme] = useState('dark')

  return <>
    <div className="admin-section">
      <div className="admin-section-head">
        <h2>Admin Settings</h2>
      </div>
      <div className="card">
        <div className="admin-settings-grid">
          <div className="admin-setting-row">
            <label><strong>Default History Page Size</strong><span>Number of records loaded by default in the History Manager</span></label>
            <select value={historyLimit} onChange={e => setHistoryLimit(Number(e.target.value))} style={{ background: '#0a111d', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 11, padding: '9px 12px', fontSize: 12, minWidth: 120 }}>
              <option value={50}>50 records</option>
              <option value={100}>100 records</option>
              <option value={200}>200 records</option>
              <option value={500}>500 records</option>
            </select>
          </div>
          <div className="admin-setting-row">
            <label><strong>Theme Preference</strong><span>Visual theme for the admin panel (follows app theme toggle)</span></label>
            <span className="pill">{document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark'}</span>
          </div>
          <div className="admin-setting-row">
            <label><strong>Accident Detection Thresholds</strong><span>Configured on the ESP32 firmware. Not modifiable from this panel.</span></label>
            <span className="pill">ESP32 Managed</span>
          </div>
          <div className="admin-setting-row">
            <label><strong>Notification Configuration</strong><span>Email notification settings are managed by the ESP32 firmware</span></label>
            <span className="pill">Device Managed</span>
          </div>
        </div>
      </div>
    </div>
  </>
}

// ═══════════════════════════════════════════════════════════
// PRESENTATION MODE
// ═══════════════════════════════════════════════════════════
function PresentationMode({ onClose }: { onClose: () => void }) {
  const { live, firebaseOnline, deviceOnline, lastDataAt } = hooks.useLiveHelmet()
  const [userCount, setUserCount] = useState(0)
  const [alcoholCount, setAlcoholCount] = useState(0)
  const [accidentCount, setAccidentCount] = useState(0)
  const [historyCount, setHistoryCount] = useState(0)

  useEffect(() => {
    readAllUsers().then(u => setUserCount(Object.keys(u).length)).catch(() => { })
    estimateBranchSize(paths.alcohol).then(r => setAlcoholCount(r.count)).catch(() => { })
    estimateBranchSize(paths.accidents).then(r => setAccidentCount(r.count)).catch(() => { })
    estimateBranchSize(paths.history).then(r => setHistoryCount(r.count)).catch(() => { })
  }, [])

  const score = safetyScore(live, deviceOnline)

  return <div className="presentation-mode">
    <button className="presentation-close" onClick={onClose}><X size={14} /> Exit Presentation</button>
    <div className="presentation-header">
      <p className="eyebrow" style={{ fontSize: 12 }}>SMART HELMET</p>
      <h1>Admin Control Center</h1>
      <p>Intelligent Rider Safety & Monitoring System</p>
    </div>
    <div className="presentation-body">
      <div className="presentation-kpi">
        <div className="card kpi-card kpi-cyan">
          <div className="kpi-icon"><Wifi size={24} /></div>
          <p className="kpi-value" style={{ fontSize: 48, color: deviceOnline ? 'var(--green)' : 'var(--red)' }}>{deviceOnline ? 'ONLINE' : 'OFFLINE'}</p>
          <div className="kpi-label">Device Status</div>
        </div>
        <div className="card kpi-card kpi-green">
          <div className="kpi-icon"><ShieldCheck size={24} /></div>
          <p className="kpi-value" style={{ fontSize: 48 }}>{score.score}</p>
          <div className="kpi-label">Safety Score</div>
        </div>
        <div className="card kpi-card kpi-cyan">
          <div className="kpi-icon"><Users size={24} /></div>
          <p className="kpi-value" style={{ fontSize: 48 }}>{userCount}</p>
          <div className="kpi-label">Users</div>
        </div>
        <div className="card kpi-card kpi-cyan">
          <div className="kpi-icon"><Database size={24} /></div>
          <p className="kpi-value" style={{ fontSize: 48 }}>{historyCount}</p>
          <div className="kpi-label">History Records</div>
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 20 }}>
        <KpiCard icon={AlertTriangle} value={alcoholCount} label="Alcohol Events" accent="amber" />
        <KpiCard icon={Siren} value={accidentCount} label="Accidents" accent="red" />
        <KpiCard icon={Activity} value={humanState(live?.state)} label="Current State" accent="cyan" />
        <KpiCard icon={MapPin} value={live?.gpsFix ? 'Available' : 'Unavailable'} label="GPS" accent={live?.gpsFix ? 'green' : 'amber'} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Live Telemetry</h3>
          <div className="info-row"><span>State</span><strong>{humanState(live?.state)}</strong></div>
          <div className="info-row"><span>Alcohol</span><strong>{num(live?.alcoholPercent)}%</strong></div>
          <div className="info-row"><span>Impact</span><strong>{num(live?.impact)}</strong></div>
          <div className="info-row"><span>Motor</span><strong>{live?.motor ? 'Running' : 'Stopped'}</strong></div>
          <div className="info-row"><span>Buzzer</span><strong>{live?.buzzer ? 'Active' : 'Silent'}</strong></div>
          <div className="info-row"><span>GPS</span><strong>{live?.gpsFix ? `Fix (${live.satellites} sats)` : 'No fix'}</strong></div>
          <div className="info-row"><span>Last Update</span><strong>{lastDataAt ? fmtAgo(lastDataAt) : 'Never'}</strong></div>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>System Health</h3>
          <div className="system-status-grid">
            <StatusItem ok={firebaseOnline} label="Firebase" detail={firebaseOnline ? 'Connected' : 'Disconnected'} />
            <StatusItem ok={deviceOnline} label="Helmet" detail={deviceOnline ? 'Online' : 'Offline'} />
            <StatusItem ok={!!live?.gpsFix} label="GPS" detail={live?.gpsFix ? 'Fix acquired' : 'No fix'} />
            <StatusItem ok={!live?.alcoholDetected} label="Alcohol" detail={live?.alcoholDetected ? 'Warning' : 'Clear'} />
            <StatusItem ok={!live?.accident} label="Accident" detail={live?.accident ? 'DETECTED' : 'None'} />
            <StatusItem ok={!live?.notificationBusy} label="Notifications" detail={live?.notificationBusy ? 'Sending' : 'Idle'} />
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 40, color: '#4d6580', fontSize: 11 }}>
        <p>Smart Helmet — B.E. Computer Engineering Final Year Project</p>
        <p>ESP32-D0WD-V3 · MQ-3 · ADXL335 · NEO-6M GPS · Firebase Realtime Database · React</p>
      </div>
    </div>
  </div>
}
