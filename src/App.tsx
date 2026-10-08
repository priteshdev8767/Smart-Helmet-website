import { Component, Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { hooks } from './hooks'
import { clearDatabasePath, deleteDatabaseNode, login, logout, readLatest, register, writeAudit, writeUserProfile } from './services'
import { downloadCsv, downloadJson, fmtAgo, fmtTime, humanState, num, safetyScore } from './utils'
import type { HelmetLiveData } from './types'
import { Activity, AlertTriangle, Bell, Bike, BookOpen, CheckCircle2, ChevronRight, Copy, Database, Download, Gauge, History, Home, KeyRound, LayoutDashboard, LifeBuoy, LogIn, LogOut, MapPin, Menu, Moon, RefreshCw, Shield, ShieldCheck, Siren, Smartphone, Sparkles, Sun, Trash2, User, Users, XCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import AdminPanel from './admin/AdminPanel'

function App() {
  const { user, loading, admin, adminLoading, adminError, rawAdminValue } = hooks.useAuthState()
  if (loading) return <div className="screen-center"><div className="spinner" /><span>Starting Smart Helmet…</span></div>
  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
    <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage register />} />
    <Route path="*" element={user ? <AuthenticatedErrorBoundary><Shell user={user} admin={admin} adminLoading={adminLoading} adminError={adminError} rawAdminValue={rawAdminValue} /></AuthenticatedErrorBoundary> : <Navigate to="/login" replace />} />
  </Routes>
}

type BoundaryState = { error: Error | null; retryKey: number }

class AuthenticatedErrorBoundary extends Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, retryKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const message = error.message.replace(/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    console.error('Authenticated application render error:', message, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const message = this.state.error.message.replace(/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
      return <main className="screen-center"><div className="card error-boundary"><h2>Dashboard failed to load</h2><p>{message || 'An unexpected rendering error occurred.'}</p><div className="button-row"><button className="primary-btn" onClick={() => this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }))}>Retry</button><button className="secondary-btn" onClick={async () => { try { await logout(); window.location.assign('/login') } catch { this.setState({ error: new Error('Sign out failed. Please try again.') }) } }}>Return to login</button></div></div></main>
    }
    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>
  }
}

class MapErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <div className="map-empty"><MapPin size={26}/><strong>Location unavailable</strong></div> : this.props.children
  }
}

function Shell({ user, admin, adminLoading, adminError, rawAdminValue }: { user: any; admin: boolean; adminLoading: boolean; adminError: string | null; rawAdminValue: any }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [simple, setSimple] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dark, setDark] = useState(true)
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light' }, [dark])
  const nav = [
    { to: '/dashboard', label: 'Dashboard', icon: Home },
    { to: '/history', label: 'History', icon: History },
    { to: '/alcohol-events', label: 'Alcohol Alerts', icon: AlertTriangle },
    { to: '/accident-events', label: 'Accidents', icon: Siren },
    { to: '/rides', label: 'Ride Sessions', icon: Bike },
    { to: '/analytics', label: 'Analytics', icon: Activity },
    { to: '/safety-report', label: 'Safety Report', icon: Shield },
    { to: '/notifications', label: 'Alerts', icon: Bell },
    { to: '/replay', label: 'Telemetry Replay', icon: Activity },
    { to: '/help', label: 'How It Works', icon: BookOpen },
  ]
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={20} /></div><div><strong>SMART HELMET</strong><small>Rider Safety System</small></div></div>
      <div className="nav-section"><span>MONITOR</span>{nav.map(({to,label,icon:Icon}) => <NavLink key={to} onClick={() => setMobileOpen(false)} className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`} to={to}><Icon size={18}/><span>{label}</span></NavLink>)}</div>
      {admin && <div className="nav-section"><span>ADMIN</span><NavLink className={({isActive}) => `nav-link ${isActive ? 'active' : ''}`} to="/admin"><Database size={18}/><span>Admin Center</span></NavLink></div>}
      <div className="sidebar-bottom">
        <button className="mode-toggle" onClick={() => setSimple(v => !v)}><Gauge size={18}/><span>{simple ? 'Simple Mode' : 'Advanced Mode'}</span><span className="toggle-dot">{simple ? 'S' : 'A'}</span></button>
        <button className="nav-link" onClick={() => setDark(v => !v)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}<span>{dark ? 'Light Theme' : 'Dark Theme'}</span></button>
        <button className="nav-link danger" onClick={async () => { try { await logout(); navigate('/login') } catch { window.alert('Sign out failed. Please try again.') } }}><LogOut size={18}/><span>Sign out</span></button>
      </div>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close menu"/>}
    <main className="main">
      <header className="topbar">
        <button className="icon-btn mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20}/></button>
        <div className="crumb">{location.pathname.split('/').filter(Boolean).map(x => x.replaceAll('-', ' ')).join(' / ') || 'dashboard'}</div>
        <div className="top-actions"><span className="pill success"><span className="live-dot"/>Realtime</span><span className="pill">{simple ? 'Simple' : 'Advanced'}</span><div className="avatar">{(auth.currentUser?.email?.[0] ?? 'U').toUpperCase()}</div></div>
      </header>
      <div className="page-wrap">
        <Routes>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard simple={simple} />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="alcohol-events" element={<EventsPage type="alcohol" />} />
          <Route path="accident-events" element={<EventsPage type="accident" />} />
          <Route path="rides" element={<RidesPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="safety-report" element={<SafetyReportPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="replay" element={<ReplayPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="settings" element={<SettingsPage simple={simple} setSimple={setSimple} />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="admin/*" element={adminLoading ? <div className="screen-center"><div className="spinner"/><span>Verifying administrator permissions…</span></div> : admin ? <AdminPanel /> : <AdminAccessDiagnostic user={user} adminError={adminError} rawAdminValue={rawAdminValue} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </main>
  </div>
}

function AuthPage({ register: isRegister = false }: { register?: boolean }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState(isRegister)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true)
    try { if (mode) await register(email.trim(), password, name.trim()); else await login(email.trim(), password); navigate('/dashboard') }
    catch (err: any) { setError(err?.message?.replace('Firebase: ', '') ?? 'Something went wrong.') }
    finally { setBusy(false) }
  }
  return <div className="auth-screen">
    <div className="auth-visual"><div className="auth-orb"/><div className="auth-copy"><div className="brand-mark large"><ShieldCheck size={32}/></div><h1>Smart Helmet</h1><p>Understand rider safety in seconds. Realtime monitoring powered by your ESP32 and Firebase.</p><div className="auth-feature"><CheckCircle2 size={18}/> Live helmet monitoring</div><div className="auth-feature"><CheckCircle2 size={18}/> Clear safety explanations</div><div className="auth-feature"><CheckCircle2 size={18}/> GPS and incident history</div></div></div>
    <div className="auth-card-wrap"><div className="auth-card"><div className="mobile-brand"><div className="brand-mark"><ShieldCheck size={22}/></div><strong>SMART HELMET</strong></div><h2>{mode ? 'Create account' : 'Welcome back'}</h2><p className="muted">{mode ? 'Create your rider account.' : 'Sign in to view your helmet.'}</p><form onSubmit={submit}>
      {mode && <label>Name<input value={name} onChange={e => setName(e.target.value)} required placeholder="Your name"/></label>}
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"/></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="At least 6 characters"/></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-btn wide" disabled={busy}>{busy ? 'Please wait…' : mode ? 'Create account' : 'Sign in'}<ChevronRight size={18}/></button>
    </form><button className="text-btn" onClick={() => setMode(v => !v)}>{mode ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></div></div>
  </div>
}

function Dashboard({ simple }: { simple: boolean }) {
  const { live, firebaseOnline, deviceOnline, lastDataAt, loading: liveLoading, error: liveError } = hooks.useLiveHelmet()
  const historyState = hooks.useLatestHistoryState(120)
  const history = historyState.data
  const connection = hooks.useConnectionData()
  const recent = hooks.useRecentEvents()
  const score = safetyScore(live, deviceOnline)
  const chart = history.slice(-60).map((r: any) => ({ time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }) : '', alcohol: num(r.alcoholPercent), impact: num(r.impact), jerk: num(r.jerk), magnitude: num(r.accelMagnitude) }))
  const gpsValid = !!live?.hasLocation && Number.isFinite(live?.latitude) && Number.isFinite(live?.longitude) && live!.latitude! >= -90 && live!.latitude! <= 90 && live!.longitude! >= -180 && live!.longitude! <= 180
  return <>
    <div className="hero-row"><div><p className="eyebrow">REALTIME RIDER MONITORING</p><h1>Good {new Date().getHours() < 12 ? 'morning' : 'day'}.</h1><p className="muted">The dashboard explains the current helmet status in plain language.</p></div><div className={`status-chip ${deviceOnline ? 'ok' : 'bad'}`}><span className="live-dot"/> {deviceOnline ? 'Helmet Online' : 'Helmet Offline'}</div></div>
    {!deviceOnline && <div className="alert-banner danger"><AlertTriangle size={20}/><div><strong>Helmet is not sending recent data</strong><span>Check that the ESP32 is powered and connected to Wi‑Fi.</span></div></div>}
    <div className="grid-4">
      <SafetyScoreCard score={score}/>
      <StatusCard title="Current status" value={liveError ? 'Data unavailable' : humanState(live?.state)} icon={Shield} accent={live?.accident ? 'danger' : 'info'} subtitle={liveError ? 'Data unavailable' : liveLoading ? 'Loading helmet data…' : live?.state === 'RIDING' ? 'Rider is currently riding.' : 'The system is not reporting active riding.'}/>
      <GaugeCard title="Alcohol sensor" percent={num(live?.alcoholPercent)} danger={!!live?.alcoholDetected} footer={liveError ? 'Data unavailable' : liveLoading ? 'Loading sensor data…' : live?.alcoholDetected ? 'Warning detected' : 'No active alcohol warning'}/>
      <StatusCard title="Accident status" value={liveError ? 'Data unavailable' : live?.accident ? 'Possible accident detected' : 'No accident detected'} icon={Siren} accent={live?.accident ? 'danger' : 'success'} subtitle={liveError ? 'Data unavailable' : liveLoading ? 'Loading helmet data…' : live?.accident ? 'Check the rider and location now.' : 'No accident alert is active.'}/>
    </div>
    <div className="grid-3">
      <div className="card chart-card span-2"><div className="card-head"><div><h3>Live movement</h3><p className="muted">How strongly the helmet is moving right now.</p></div><span className="tiny-pill">Realtime</span></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" opacity={0.12}/><XAxis dataKey="time" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Line type="monotone" dataKey="magnitude" dot={false} stroke="var(--cyan)" strokeWidth={2}/><Line type="monotone" dataKey="impact" dot={false} stroke="var(--red)" strokeWidth={2}/></LineChart></ResponsiveContainer>{historyState.error ? <div className="chart-message"><DataUnavailable/></div> : historyState.loading ? <div className="chart-message">Loading telemetry…</div> : !chart.length ? <div className="chart-message">No telemetry history yet.</div> : null}</div></div>
      <div className="card"><div className="card-head"><div><h3>Helmet readiness</h3><p className="muted">A quick health check.</p></div><ShieldCheck size={18}/></div><ReadinessRow ok={firebaseOnline} label="Cloud connection" detail={liveError ? 'Data unavailable' : firebaseOnline ? 'Firebase is receiving data.' : 'Firebase connection unavailable.'}/><ReadinessRow ok={deviceOnline} label="Helmet connection" detail={deviceOnline ? 'Recent live data received.' : liveLoading ? 'Loading live data…' : 'No recent live update.'}/><ReadinessRow ok={gpsValid} label="Location" detail={gpsValid ? 'GPS has a valid fix.' : 'Location unavailable'}/><ReadinessRow ok={!live?.alcoholDetected} label="Alcohol warning" detail={liveError ? 'Data unavailable' : live?.alcoholDetected ? 'Sensor warning is active.' : 'No active warning.'}/></div>
    </div>
    <div className="grid-3">
      <SpeedometerCard speed={live?.speedKmph} maxSpeed={live?.maxSpeedKmph} valid={!!live?.speedValid && !!live?.gpsFix} satellites={live?.satellites} />
      <div className="card"><div className="card-head"><div><h3>Motor & alarm</h3><p className="muted">What the safety controller reports.</p></div><Bike size={18}/></div><InfoRow label="Motor" value={live?.motor ? 'RUNNING' : 'STOPPED'} good={!!live?.motor}/><InfoRow label="Buzzer" value={live?.buzzer ? 'ON' : 'OFF'} good={!live?.buzzer}/><InfoRow label="State" value={humanState(live?.state)}/></div>
      <div className="card"><div className="card-head"><div><h3>GPS Telemetry</h3><p className="muted">Fix & satellite status.</p></div><MapPin size={18}/></div><InfoRow label="GPS Fix" value={live?.gpsFix ? 'LOCKED' : 'SEARCHING'} good={!!live?.gpsFix}/><InfoRow label="Satellites" value={String(live?.satellites ?? 0)} good={num(live?.satellites) >= 4}/><InfoRow label="Ground Speed" value={`${(live?.speedKmph ?? 0).toFixed(1)} km/h`}/></div>
    </div>
    <div className="card map-card" style={{ marginBottom: 14 }}>
      <div className="card-head"><div><h3>Helmet Live Location (Google Maps)</h3><p className="muted">Live map coordinates with Google Maps interface.</p></div><MapPin size={18}/></div>
      {gpsValid ? <MapErrorBoundary key={`${live!.latitude},${live!.longitude}`}><MapView lat={live!.latitude!} lng={live!.longitude!}/></MapErrorBoundary> : <div className="map-empty"><MapPin size={26}/><strong>Location unavailable</strong><span>Waiting for a valid GPS fix from helmet.</span></div>}
    </div>
    <div className="grid-3">
      <div className="card"><div className="card-head"><div><h3>Recent alerts</h3><p className="muted">Important events from the helmet.</p></div><Bell size={18}/></div>{recent.accidents.slice(0,2).map((e: any) => <EventMini key={e.__id} title="Accident event" detail={`Impact ${num(e.impact)}`} timestamp={e.timestamp} severity="critical"/>)}{recent.accidentsError && <DataUnavailable/>}{recent.alcohol.slice(0,2).map((e: any) => <EventMini key={e.__id} title="Alcohol event" detail={`Sensor ${num(e.alcoholPercent)}%`} timestamp={e.timestamp} severity="warning"/>)}{recent.alcoholError && <DataUnavailable/>}{!recent.loading && !recent.accidentsError && !recent.alcoholError && !recent.accidents.length && !recent.alcohol.length && <Empty text="No recent incident events."/>}</div>
      <div className="card"><div className="card-head"><div><h3>Safety explanation</h3><p className="muted">Why the score looks this way.</p></div><Sparkles size={18}/></div>{score.reasons.map((r, i) => <div className="reason" key={i}><span className={i === 0 && score.score < 50 ? 'reason-dot bad' : 'reason-dot'}>{i === 0 && score.score < 50 ? '!' : '✓'}</span><span>{r}</span></div>)}<Link className="inline-link" to="/safety-report">View full safety report <ChevronRight size={15}/></Link></div>
      <div className="card"><div className="card-head"><div><h3>Quick tools</h3><p className="muted">Jump to common actions.</p></div><Smartphone size={18}/></div><div className="quick-grid"><Link to="/history" className="quick-tool"><History size={18}/>History</Link><Link to="/accident-events" className="quick-tool"><Siren size={18}/>Accidents</Link><Link to="/alcohol-events" className="quick-tool"><AlertTriangle size={18}/>Alcohol</Link><Link to="/analytics" className="quick-tool"><Activity size={18}/>Analytics</Link></div></div>
    </div>
    {!simple && <div className="card technical"><div className="card-head"><div><h3>Advanced telemetry</h3><p className="muted">Raw values from Firebase.</p></div><Database size={18}/></div><div className="tech-grid">{Object.entries(live ?? {}).map(([k,v]) => <div key={k}><span>{k}</span><strong>{String(v)}</strong></div>)}</div></div>}
    <div className="footer-note">Last live update: {lastDataAt ? fmtTime(lastDataAt) : 'No update yet'} · Connection test: {connection.error ? 'Data unavailable' : connection.data ? 'reported' : 'not available'}</div>
  </>
}

function SafetyScoreCard({ score }: { score: ReturnType<typeof safetyScore> }) { return <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className={`card safety-card score-${score.label.toLowerCase()}`} style={{['--score' as string]: score.score} as React.CSSProperties}><div className="card-head"><div><p className="eyebrow">INFORMATIONAL</p><h3>Helmet Safety Score</h3></div><ShieldCheck size={19}/></div><div className="score-circle"><div><strong>{score.score}</strong><span>/ 100</span></div></div><div className="score-label">{score.label}</div><p className="score-note">Based on the current helmet signals. Not a medical assessment or certification.</p><div className="score-reasons"><span>Why?</span>{score.reasons.slice(0,2).map(r => <small key={r}>{r}</small>)}</div></motion.div> }
function GaugeCard({title,percent,danger,footer}:{title:string,percent:number,danger:boolean,footer:string}) { return <div className={`card gauge-card ${danger?'danger-card':''}`}><div className="card-head"><div><h3>{title}</h3><p className="muted">Relative sensor level</p></div><AlertTriangle size={18}/></div><div className="gauge"><div className="gauge-inner"><strong>{Math.round(percent)}</strong><span>%</span></div></div><div className={`gauge-footer ${danger?'danger-text':''}`}>{footer}</div></div> }
function StatusCard({title,value,icon:Icon,accent,subtitle}:{title:string,value:string,icon:any,accent:string,subtitle:string}) { return <div className={`card status-card accent-${accent}`}><div className="status-icon"><Icon size={21}/></div><p className="muted">{title}</p><h3>{value}</h3><span>{subtitle}</span></div> }
function ReadinessRow({ok,label,detail}:{ok:boolean,label:string,detail:string}) { return <div className="ready-row"><span className={ok?'ready-dot':'ready-dot bad'}>{ok?'✓':'!'}</span><div><strong>{label}</strong><small>{detail}</small></div></div> }
function InfoRow({label,value,good}:{label:string,value:string,good?:boolean}) { return <div className="info-row"><span>{label}</span><strong className={good===undefined?'':good?'text-green':'text-red'}>{value}</strong></div> }
function EventMini({title,detail,timestamp,severity}:{title:string,detail:string,timestamp?:number,severity:string}) { return <div className="event-mini"><span className={`event-dot ${severity}`}/><div><strong>{title}</strong><span>{detail} · {fmtAgo(timestamp)}</span></div></div> }
function Empty({text}:{text:string}) { return <div className="empty">{text}</div> }
function DataUnavailable() { return <small className="data-unavailable" style={{color:'var(--muted)',display:'block',marginTop:8}}>Data unavailable</small> }

function SpeedometerCard({ speed = 0, maxSpeed = 0, valid = false, satellites = 0 }: { speed?: number; maxSpeed?: number; valid?: boolean; satellites?: number }) {
  const current = Math.max(0, Number(speed) || 0)
  const max = 120
  const pct = Math.min(100, (current / max) * 100)
  const color = current > 80 ? 'var(--red)' : current > 50 ? 'var(--amber)' : current > 0 ? 'var(--cyan)' : '#6f849d'
  const strokeDash = 2 * Math.PI * 40
  const strokeOffset = strokeDash * (1 - (pct * 0.75) / 100)

  return (
    <div className="card speed-card">
      <div className="card-head">
        <div>
          <h3>Rider Speedometer</h3>
          <p className="muted">Live GPS ground speed</p>
        </div>
        <Gauge size={18} color={color} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '4px 0 10px' }}>
        <div style={{ position: 'relative', width: 140, height: 110, display: 'grid', placeItems: 'center' }}>
          <svg viewBox="0 0 100 80" style={{ width: '100%', height: '100%' }}>
            <path d="M 15 70 A 40 40 0 1 1 85 70" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" strokeLinecap="round" />
            <path
              d="M 15 70 A 40 40 0 1 1 85 70"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeDasharray={strokeDash}
              strokeDashoffset={strokeOffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.4s ease' }}
            />
          </svg>
          <div style={{ position: 'absolute', bottom: 6, textAlign: 'center' }}>
            <strong style={{ fontSize: 30, display: 'block', lineHeight: 1, color: valid ? 'var(--text)' : 'var(--muted)' }}>
              {valid ? current.toFixed(1) : '--'}
            </strong>
            <small style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', fontWeight: 700 }}>KM/H</small>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 11, padding: '0 4px', color: 'var(--muted)' }}>
          <span>Peak: <strong style={{ color: 'var(--text)' }}>{(maxSpeed || 0).toFixed(1)} km/h</strong></span>
          <span style={{ color: valid ? 'var(--green)' : 'var(--amber)' }}>{valid ? `● ${satellites} Sats` : '○ Searching GPS'}</span>
        </div>
      </div>
    </div>
  )
}

function MapView({lat,lng}:{lat:number,lng:number}) {
  const [mapEngine, setMapEngine] = useState<'google' | 'osm'>('google')
  const gmapEmbedUrl = `https://maps.google.com/maps?q=${lat},${lng}&hl=en&z=16&output=embed`
  const gmapExternal = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  const gmapDirections = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

  return (
    <div className="map-wrap" style={{ position: 'relative', height: 340, width: '100%' }}>
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="tiny-pill"
          style={{ background: mapEngine === 'google' ? 'var(--cyan)' : 'rgba(10,17,29,0.85)', color: mapEngine === 'google' ? '#070b14' : 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700 }}
          onClick={() => setMapEngine(mapEngine === 'google' ? 'osm' : 'google')}
        >
          {mapEngine === 'google' ? 'Google Maps Mode' : 'OpenStreetMap Mode'}
        </button>
        <a
          href={gmapExternal}
          target="_blank"
          rel="noopener noreferrer"
          className="tiny-pill"
          style={{ background: 'rgba(10,17,29,0.85)', color: 'var(--cyan)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Open in Google Maps ↗
        </a>
        <a
          href={gmapDirections}
          target="_blank"
          rel="noopener noreferrer"
          className="tiny-pill"
          style={{ background: 'rgba(10,17,29,0.85)', color: 'var(--green)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          Directions ↗
        </a>
      </div>

      {mapEngine === 'google' ? (
        <iframe
          title="Google Maps Live Interface"
          src={gmapEmbedUrl}
          style={{ width: '100%', height: '100%', border: 0, borderRadius: 14 }}
          loading="lazy"
          allowFullScreen
        />
      ) : (
        <MapContainer center={[lat,lng]} zoom={15} scrollWheelZoom={false} style={{height:'100%',width:'100%'}}>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
          <Marker position={[lat,lng]}>
            <Popup>
              Smart Helmet Location<br/>
              {lat.toFixed(6)}, {lng.toFixed(6)}<br/>
              <a href={gmapDirections} target="_blank" rel="noopener noreferrer">Navigate via Google Maps</a>
            </Popup>
          </Marker>
          <Recenter lat={lat} lng={lng}/>
        </MapContainer>
      )}
    </div>
  )
}
function Recenter({lat,lng}:{lat:number,lng:number}) { const map = useMap(); useEffect(()=>{map.setView([lat,lng])},[map,lat,lng]); return null }

function TablePage({ title, subtitle, rows, columns, path, exportName, loading = false, dataUnavailable = false }: { title:string; subtitle:string; rows:any[]; columns:string[]; path?:string; exportName:string; loading?:boolean; dataUnavailable?:boolean }) {
  const [q,setQ]=useState('')
  const filtered = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
  return <div><div className="hero-row"><div><p className="eyebrow">HISTORY</p><h1>{title}</h1><p className="muted">{subtitle}</p></div><div className="button-row"><button className="secondary-btn" onClick={()=>downloadCsv(exportName+'.csv',filtered)}><Download size={16}/> CSV</button><button className="secondary-btn" onClick={()=>downloadJson(exportName+'.json',filtered)}><Download size={16}/> JSON</button></div></div><div className="card"><div className="table-tools"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search records…"/><span className="muted">Showing {filtered.length} of {rows.length}</span></div><div className="table-scroll"><table><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{filtered.length ? filtered.map((r,i)=><tr key={r.__id ?? i}>{columns.map(c=><td key={c}>{renderCell(r,c)}</td>)}</tr>) : <tr><td colSpan={columns.length}>{loading ? 'Loading…' : dataUnavailable ? <DataUnavailable/> : <Empty text="No matching records."/>}</td></tr>}</tbody></table></div></div></div>
}
function renderCell(r:any,c:string) { const k = c; const v = r[k]; if (k==='timestamp') return fmtTime(v); if (typeof v==='boolean') return v ? 'Yes' : 'No'; if (v===undefined || v===null) return '—'; return typeof v==='object' ? JSON.stringify(v) : v }
function HistoryPage(){ const state=hooks.useLatestHistoryState(500); const cols=['timestamp','state','alcoholPercent','alcoholDetected','accident','accelX','accelY','accelZ','accelMagnitude','impact','peakImpact','jerk','motor','buzzer','latitude','longitude','satellites']; return <TablePage title="Telemetry History" subtitle="Historical helmet readings stored by the ESP32." rows={state.data} columns={cols} exportName="helmet-history" loading={state.loading} dataUnavailable={state.error}/> }
function EventsPage({type}:{type:'alcohol'|'accident'}) { const [rows,setRows]=useState<any[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(false); useEffect(()=>{let active=true; setRows([]); setLoading(true); setError(false); void readLatest(type==='alcohol'?'smartHelmet/alcoholEvents':'smartHelmet/accidentEvents',500).then(value=>{if(active)setRows(value)}).catch(()=>{if(active)setError(true)}).finally(()=>{if(active)setLoading(false)}); return()=>{active=false}},[type]); const cols=type==='alcohol'?['timestamp','state','alcoholPercent','alcoholRaw','deviceMillis']:['timestamp','impact','peakImpact','jerk','accelMagnitude','accelX','accelY','accelZ','latitude','longitude','satellites']; return <TablePage title={type==='alcohol'?'Alcohol Alerts':'Accident Events'} subtitle={type==='alcohol'?'Every stored alcohol event from the helmet.':'Every stored accident event from the helmet.'} rows={rows} columns={cols} exportName={type==='alcohol'?'alcohol-events':'accident-events'} loading={loading} dataUnavailable={error}/> }
function RidesPage(){ const history=hooks.useLatestHistory(1000) as any[]; const rides=useMemo(()=>groupRides(history),[history]); return <div><div className="hero-row"><div><p className="eyebrow">ACTIVITY</p><h1>Ride Sessions</h1><p className="muted">Logical riding sessions grouped from the stored telemetry.</p></div></div><div className="cards-list">{rides.length?rides.map(r=><div className="card ride-card" key={r.id}><div><strong>{r.id}</strong><span>{fmtTime(r.start)} → {fmtTime(r.end)}</span></div><div><strong>{Math.max(1,Math.round((r.end-r.start)/60000))} min</strong><span>Duration</span></div><div><strong>{r.maxImpact}</strong><span>Peak impact</span></div><div><strong>{r.alcoholAlerts}</strong><span>Alcohol alerts</span></div><div><strong>{r.accidents}</strong><span>Accidents</span></div></div>):<div className="card"><Empty text="No riding sessions can be derived from current history."/></div>}</div></div> }
function groupRides(rows:any[]){ const out:any[]=[]; let current:any=null; for(const r of [...rows].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0))){ if(r.state==='RIDING'){ if(!current || (r.timestamp-current.last)>120000){current={id:`Ride ${out.length+1}`,start:r.timestamp??Date.now(),end:r.timestamp??Date.now(),last:r.timestamp??Date.now(),maxImpact:num(r.peakImpact),alcoholAlerts:r.alcoholDetected?1:0,accidents:r.accident?1:0}; out.push(current)} else {current.end=r.timestamp??current.end; current.last=r.timestamp??current.last; current.maxImpact=Math.max(current.maxImpact,num(r.peakImpact)); current.alcoholAlerts+=r.alcoholDetected?1:0; current.accidents+=r.accident?1:0}} } return out.reverse() }
function AnalyticsPage(){ const rows=hooks.useLatestHistory(600) as any[]; const points=rows.slice(-120).map(r=>({t:r.timestamp?new Date(r.timestamp).toLocaleTimeString([], {minute:'2-digit',second:'2-digit'}):'',alcohol:num(r.alcoholPercent),impact:num(r.impact),safety:safetyScore(r, true).score})); const maxImpact=Math.max(0,...rows.map(r=>num(r.peakImpact))); const avgAlcohol=rows.length?rows.reduce((s,r)=>s+num(r.alcoholPercent),0)/rows.length:0; const accidentCount=rows.filter(r=>r.accident).length; return <div><div className="hero-row"><div><p className="eyebrow">INSIGHTS</p><h1>Analytics</h1><p className="muted">Calculated from the stored telemetry currently loaded.</p></div></div><div className="grid-4"><Metric label="Records loaded" value={rows.length}/><Metric label="Average sensor level" value={`${avgAlcohol.toFixed(1)}%`}/><Metric label="Highest peak impact" value={maxImpact}/><Metric label="Accident-marked readings" value={accidentCount}/></div><div className="grid-2"><ChartBlock title="Alcohol trend" data={points} dataKey="alcohol"/><ChartBlock title="Impact trend" data={points} dataKey="impact"/></div><div className="grid-2"><ChartBlock title="Informational safety trend" data={points} dataKey="safety"/></div></div> }
function ChartBlock({title,data,dataKey}:{title:string,data:any[],dataKey:string}){return <div className="card chart-card"><div className="card-head"><div><h3>{title}</h3><p className="muted">Based on loaded realtime/history data.</p></div></div><div className="chart" style={{position:'relative'}}><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid strokeDasharray="3 3" opacity={.12}/><XAxis dataKey="t" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip/><Line type="monotone" dataKey={dataKey} dot={false} stroke="var(--cyan)" strokeWidth={2}/></LineChart></ResponsiveContainer>{!data.length&&<div className="chart-message" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',pointerEvents:'none'}}>No telemetry history yet.</div>}</div></div>}
function Metric({label,value}:{label:string,value:any}){return <div className="card metric"><span>{label}</span><strong>{value}</strong></div>}
function SafetyReportPage(){const {live,deviceOnline}=hooks.useLiveHelmet(); const score=safetyScore(live,deviceOnline); return <div><div className="hero-row"><div><p className="eyebrow">REPORT</p><h1>Safety Report</h1><p className="muted">A human-readable summary of the current helmet state.</p></div><button className="primary-btn" onClick={()=>downloadJson('safety-report.json',{createdAt:new Date().toISOString(),score,live})}><Download size={16}/> Export report</button></div><div className="card report-head"><div className="big-score">{score.score}<span>/100</span></div><div><p className="eyebrow">CURRENT INFORMATIONAL SCORE</p><h2>{score.label}</h2><p className="muted">This score is an app-defined indicator based on available device signals. It is not a safety certification.</p></div></div><div className="grid-2"><div className="card"><h3>Why?</h3>{score.reasons.map(r=><div className="reason" key={r}><span className="reason-dot">✓</span><span>{r}</span></div>)}</div><div className="card"><h3>Current signals</h3><InfoRow label="Helmet" value={deviceOnline?'Online':'Offline'}/><InfoRow label="Alcohol" value={live?.alcoholDetected?'Warning':'No warning'}/><InfoRow label="Accident" value={live?.accident?'Detected':'None'}/><InfoRow label="GPS" value={live?.gpsFix?'Available':'Waiting'}/><InfoRow label="Motor" value={live?.motor?'Running':'Stopped'}/></div></div></div> }

function ReplayPage(){
  const rows=hooks.useLatestHistory(300) as any[]
  const [index,setIndex]=useState(Math.max(0, rows.length-1))
  useEffect(()=>setIndex(Math.max(0, rows.length-1)),[rows.length])
  const current=rows[index]
  const chart=rows.slice(Math.max(0,index-60),index+1).map((r:any)=>({t:r.timestamp?new Date(r.timestamp).toLocaleTimeString([], {minute:'2-digit',second:'2-digit'}):'',alcohol:num(r.alcoholPercent),impact:num(r.impact),magnitude:num(r.accelMagnitude),jerk:num(r.jerk)}))
  return <div>
    <div className="hero-row"><div><p className="eyebrow">DEMONSTRATION TOOL</p><h1>Telemetry Replay</h1><p className="muted">Replay real stored readings without generating fake sensor data.</p></div><span className="pill">{rows.length} loaded</span></div>
    {!rows.length ? <div className="card"><Empty text="No historical telemetry has been loaded yet."/></div> : <>
      <div className="card replay-controls"><div className="table-tools"><strong>{current?.timestamp ? fmtTime(current.timestamp) : 'Selected reading'}</strong><span className="muted">Reading {index+1} of {rows.length}</span></div><input type="range" min="0" max={Math.max(0,rows.length-1)} value={index} onChange={e=>setIndex(Number(e.target.value))}/><div className="replay-grid"><InfoRow label="State" value={humanState(current?.state)}/><InfoRow label="Alcohol" value={`${num(current?.alcoholPercent)}%`} good={!current?.alcoholDetected}/><InfoRow label="Impact" value={String(num(current?.impact))} good={!current?.accident}/><InfoRow label="Motor" value={current?.motor?'RUNNING':'STOPPED'} good={!current?.motor || current?.state==='RIDING'}/></div></div>
      <div className="grid-2"><ChartBlock title="Recent alcohol" data={chart} dataKey="alcohol"/><ChartBlock title="Recent impact" data={chart} dataKey="impact"/></div>
    </>}
  </div>
}

function NotificationsPage(){const {live}=hooks.useLiveHelmet(); const list=[...(live?.accident?[{t:'Accident',m:'A possible accident is currently reported.',s:'CRITICAL'}]:[]),...(live?.alcoholDetected?[{t:'Alcohol',m:'The alcohol sensor is reporting a warning.',s:'WARNING'}]:[])]; return <div><div className="hero-row"><div><p className="eyebrow">ALERT CENTER</p><h1>Notifications</h1><p className="muted">Simple explanations of important current conditions.</p></div></div><div className="cards-list">{list.length?list.map((x,i)=><div className="card notification" key={i}><span className={`event-dot ${x.s==='CRITICAL'?'critical':'warning'}`}/><div><strong>{x.t}</strong><span>{x.m}</span></div><span className="muted">Now</span></div>):<div className="card"><Empty text="No active alerts."/></div>}</div></div>}
function ProfilePage(){const user=auth.currentUser; const profile=hooks.useUserProfile(user?.uid); const [name,setName]=useState(profile?.name??user?.displayName??''); const [ec,setEc]=useState(profile?.emergencyContact??''); const [ep,setEp]=useState(profile?.emergencyPhone??''); const [helmet,setHelmet]=useState(profile?.helmetName??'smartHelmet-01'); const [saved,setSaved]=useState(false); const [saveError,setSaveError]=useState(false); useEffect(()=>{setName(profile?.name??user?.displayName??'');setEc(profile?.emergencyContact??'');setEp(profile?.emergencyPhone??'');setHelmet(profile?.helmetName??'smartHelmet-01')},[profile,user]); async function save(){if(!user)return;setSaveError(false);try{await writeUserProfile(user.uid,{email:user.email??'',name,emergencyContact:ec,emergencyPhone:ep,helmetName:helmet,createdAt:profile?.createdAt??Date.now()});setSaved(true);setTimeout(()=>setSaved(false),1500)}catch{setSaveError(true)}} return <div><div className="hero-row"><div><p className="eyebrow">ACCOUNT</p><h1>My Profile</h1><p className="muted">Personal and emergency information used by your account.</p></div></div><div className="card form-card"><label>Name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Email<input value={user?.email??''} disabled/></label><label>Emergency Contact<input value={ec} onChange={e=>setEc(e.target.value)}/></label><label>Emergency Phone<input value={ep} onChange={e=>setEp(e.target.value)}/></label><label>Helmet Name<input value={helmet} onChange={e=>setHelmet(e.target.value)}/></label>{saveError&&<DataUnavailable/>}<button className="primary-btn" onClick={save}>{saved?'Saved ✓':'Save profile'}</button></div></div>}
function SettingsPage({simple,setSimple}:{simple:boolean,setSimple:(x:boolean)=>void}){return <div><div className="hero-row"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p className="muted">Control how the dashboard feels and reads.</p></div></div><div className="card settings-list"><div className="setting"><div><strong>Simple Mode</strong><span>Show plain-language safety information by default.</span></div><button className={`switch ${simple?'on':''}`} onClick={()=>setSimple(!simple)}>{simple?'ON':'OFF'}</button></div><div className="setting"><div><strong>Advanced information</strong><span>Open Advanced Mode from the sidebar to see raw telemetry.</span></div><span className="tiny-pill">Developer view</span></div></div></div>}
function HelpPage(){const cards=[['Alcohol Detection','The helmet watches the relative reading from the alcohol sensor. A warning means the configured threshold has been reached; it is not a BAC measurement.'],['Accident Detection','The ESP32 applies its configured impact/jerk logic and reports an accident state here.'],['GPS Tracking','The map shows a live or last-known position when the GPS provides a valid fix.'],['Firebase','Firebase stores the latest live reading and historical event records for your dashboard.'],['Safety Score','This is an app-defined indicator that summarizes current reported conditions. It is not an official safety rating.']]; return <div><div className="hero-row"><div><p className="eyebrow">LEARN</p><h1>How Smart Helmet Works</h1><p className="muted">Designed so non-technical users can understand the system.</p></div></div><div className="grid-2">{cards.map(([t,d])=><div className="card" key={t}><div className="card-head"><h3>{t}</h3><BookOpen size={17}/></div><p className="muted big-text">{d}</p></div>)}</div></div>}
function NotFound(){return <div className="card"><h2>Page not found</h2><Link className="inline-link" to="/dashboard">Back to dashboard</Link></div>}

function AdminAccessDiagnostic({ user, adminError, rawAdminValue }: { user: any; adminError: string | null; rawAdminValue: any }) {
  const [copied, setCopied] = useState(false)
  const EXPECTED_ADMIN_UID = 'qgbgbzoWAxd0z8EE43x3XJt61Ro1'
  const currentUid = user?.uid ?? ''
  const isExpectedUid = currentUid === EXPECTED_ADMIN_UID

  const copyUid = () => {
    if (currentUid) {
      void navigator.clipboard.writeText(currentUid)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const renderAdminValue = () => {
    if (rawAdminValue === true) return <code style={{ color: 'var(--green)' }}>true</code>
    if (rawAdminValue === false) return <code style={{ color: 'var(--red)' }}>false</code>
    if (rawAdminValue === null) return <code style={{ color: 'var(--amber)' }}>null</code>
    if (rawAdminValue === undefined) return <code style={{ color: 'var(--text-muted)' }}>undefined</code>
    if (typeof rawAdminValue === 'string') return <code style={{ color: 'var(--amber)' }}>&quot;{rawAdminValue}&quot; (String, expected Boolean)</code>
    return <code style={{ color: 'var(--amber)' }}>{JSON.stringify(rawAdminValue)}</code>
  }

  const renderAdminStatus = () => {
    if (rawAdminValue === true) return <strong style={{ color: 'var(--green)' }}>GRANTED</strong>
    if (adminError) return <strong style={{ color: 'var(--red)' }}>ERROR ({adminError})</strong>
    if (rawAdminValue === null) return <strong style={{ color: 'var(--red)' }}>DENIED (Value is null / no entry in RTDB)</strong>
    if (rawAdminValue === false) return <strong style={{ color: 'var(--red)' }}>DENIED (Value is false)</strong>
    return <strong style={{ color: 'var(--red)' }}>DENIED (Value is not boolean true)</strong>
  }

  return (
    <div style={{ maxWidth: 760, margin: '20px auto', padding: '0 16px' }}>
      <div className="hero-row" style={{ marginBottom: 20 }}>
        <div>
          <p className="eyebrow" style={{ color: 'var(--amber)' }}>ACCESS RESTRICTED</p>
          <h1>Admin Access Verification</h1>
          <p className="muted">This account does not currently have active administrator permissions in Firebase Realtime Database.</p>
        </div>
        <span className="pill warning"><KeyRound size={14}/> Non-Admin</span>
      </div>

      {!isExpectedUid && (
        <div className="card admin-warning" style={{ marginBottom: 16, borderLeft: '4px solid var(--amber)' }}>
          <AlertTriangle size={24} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <div>
            <strong style={{ display: 'block', fontSize: 14, color: 'var(--amber)' }}>Account UID Mismatch Detected</strong>
            <p style={{ margin: '4px 0 8px', fontSize: 12, lineHeight: 1.5 }}>
              The expected admin UID is <code style={{ color: 'var(--cyan)' }}>{EXPECTED_ADMIN_UID}</code>, but you are currently signed in as <code style={{ color: 'var(--amber)' }}>{currentUid || 'Guest / Not signed in'}</code>.
            </p>
            <p style={{ fontSize: 12, margin: 0, color: 'var(--text-muted)' }}>
              To access the Admin Center, either sign in with the expected admin user or add <code style={{ color: 'var(--cyan)' }}>{currentUid}</code> to <code style={{ color: 'var(--cyan)' }}>/helmet/admins/{'{uid}'}: true</code> in Firebase Console.
            </p>
          </div>
        </div>
      )}

      {adminError && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--red)', background: 'rgba(239, 68, 68, 0.08)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <XCircle size={20} style={{ color: 'var(--red)' }} />
            <div>
              <strong style={{ color: 'var(--red)', fontSize: 13 }}>Firebase Realtime Database Error</strong>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{adminError}</p>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={18} style={{ color: 'var(--cyan)' }} />
          <span>Authentication & Database Diagnostics</span>
        </h3>
        
        <div className="info-row">
          <span>Firebase Auth signed-in</span>
          <strong>{user ? `YES (${user.email || 'No email'})` : 'NO'}</strong>
        </div>

        <div className="info-row">
          <span>Current Firebase UID</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ fontSize: 12, color: 'var(--cyan)' }}>{currentUid || 'None'}</code>
            {currentUid && (
              <button className="secondary-btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={copyUid}>
                {copied ? <CheckCircle2 size={12}/> : <Copy size={12}/>}
                {copied ? 'Copied' : 'Copy UID'}
              </button>
            )}
          </div>
        </div>

        <div className="info-row">
          <span>Admin database path</span>
          <code style={{ fontSize: 12 }}>/helmet/admins/{currentUid || '{uid}'}</code>
        </div>

        <div className="info-row">
          <span>Database Target URL</span>
          <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>https://smart-helmet-by-prtesh-patil-default-rtdb.firebaseio.com</code>
        </div>

        <div className="info-row">
          <span>Admin value in database</span>
          <strong>{renderAdminValue()}</strong>
        </div>

        <div className="info-row">
          <span>Admin status</span>
          {renderAdminStatus()}
        </div>
      </div>

      <div className="button-row" style={{ display: 'flex', gap: 10 }}>
        <Link to="/dashboard" className="primary-btn">
          Return to Dashboard
        </Link>
        <button className="secondary-btn" onClick={() => window.location.reload()}>
          <RefreshCw size={14} /> Retry Verification
        </button>
      </div>
    </div>
  )
}

export { App }


