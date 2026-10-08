import { useState, useEffect } from 'react'
import { Gauge, Moon, Sun, Shield } from 'lucide-react'

interface SettingsPageProps {
  simple: boolean
  setSimple: React.Dispatch<React.SetStateAction<boolean>> | ((simple: boolean) => void)
}

export function SettingsPage({ simple, setSimple }: SettingsPageProps) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  return (
    <div>
      <div className="hero-row">
        <div>
          <p className="eyebrow">PREFERENCES</p>
          <h1>Settings &amp; Calibration</h1>
          <p className="muted">Control dashboard modes, themes, and monitor hardware thresholds.</p>
        </div>
      </div>

      <div className="card settings-list" style={{ marginBottom: 14 }}>
        <div className="setting">
          <div>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Gauge size={16} color="var(--cyan)" /> Simple View Mode
            </strong>
            <span>Show plain-language status cards and summary information by default.</span>
          </div>
          <button
            type="button"
            className={`switch ${simple ? 'on' : ''}`}
            onClick={() => setSimple(!simple)}
          >
            {simple ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="setting">
          <div>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {dark ? <Moon size={16} color="var(--cyan)" /> : <Sun size={16} color="var(--amber)" />}
              Theme Color
            </strong>
            <span>Toggle between high-contrast dark cockpit theme and clean light theme.</span>
          </div>
          <button
            type="button"
            className={`switch ${dark ? 'on' : ''}`}
            onClick={() => setDark(!dark)}
          >
            {dark ? 'DARK' : 'LIGHT'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Shield size={16} color="var(--cyan)" /> ESP32 Firmware Calibration
            </h3>
            <p className="muted">Standard thresholds configured on the helmet controller.</p>
          </div>
        </div>
        <div className="tech-grid">
          <div>
            <span>Alcohol Threshold</span>
            <strong>&gt; 40% (MQ-3)</strong>
          </div>
          <div>
            <span>Accident Trigger</span>
            <strong>&gt; 2.5G Peak (ADXL335)</strong>
          </div>
          <div>
            <span>Accident Countdown</span>
            <strong>15s Cancel Window</strong>
          </div>
          <div>
            <span>GPS Speed Filter</span>
            <strong>&gt; 2.0 km/h Live</strong>
          </div>
        </div>
      </div>
    </div>
  )
}
export default SettingsPage
