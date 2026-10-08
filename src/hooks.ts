import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { authListener, isAdmin, readLatest, readUserProfile, subscribeAdmin, subscribeConnection, subscribeLatestHistory, subscribeLive } from './services'
import type { HelmetLiveData, HistoryRecord, UserProfile } from './types'

export function useAuthState() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [admin, setAdmin] = useState(false)
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [rawAdminValue, setRawAdminValue] = useState<any>(undefined)

  useEffect(() => {
    let active = true
    let unsubAdmin: (() => void) | null = null

    const unsubscribe = authListener((nextUser) => {
      if (!active) return

      if (unsubAdmin) {
        unsubAdmin()
        unsubAdmin = null
      }

      setUser(nextUser)
      setLoading(false)

      if (!nextUser) {
        setAdmin(false)
        setAdminLoading(false)
        setAdminError(null)
        setRawAdminValue(null)
        return
      }

      setAdminLoading(true)
      setAdminError(null)

      // Realtime subscription to /admins/{uid}
      unsubAdmin = subscribeAdmin(
        nextUser.uid,
        (res) => {
          if (!active) return
          setRawAdminValue(res.rawValue)
          setAdmin(res.isAdmin)
          setAdminError(res.error)
          setAdminLoading(false)
        }
      )
    }, (authErr) => {
      if (!active) return
      console.error('[Auth Listener Error]:', authErr)
      setUser(null)
      setLoading(false)
      setAdmin(false)
      setAdminLoading(false)
      setAdminError(authErr.message)
    })

    return () => {
      active = false
      unsubscribe()
      if (unsubAdmin) unsubAdmin()
    }
  }, [])

  return { user, loading, admin, adminLoading, adminError, rawAdminValue }
}

export function useLiveHelmet() {
  const [live, setLive] = useState<HelmetLiveData | null>(null)
  const [firebaseOnline, setFirebaseOnline] = useState(false)
  const [lastDataAt, setLastDataAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    const unsub = subscribeLive((data) => {
      setLive((data ?? null) as HelmetLiveData | null)
      setFirebaseOnline(true)
      setLoading(false)
      setError(false)
      if (data) { setFirebaseOnline(true); setLastDataAt(Date.now()) }
    }, () => { setFirebaseOnline(false); setLoading(false); setError(true) })
    return () => unsub()
  }, [])
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [])
  const deviceOnline = !!lastDataAt && now - lastDataAt < 5000
  return { live, firebaseOnline, deviceOnline, lastDataAt, loading, error }
}

export function useLatestHistory(limit = 300) {
  return useLatestHistoryState(limit).data
}

export function useLatestHistoryState(limit = 300) {
  const [data, setData] = useState<HistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    const unsubscribe = subscribeLatestHistory(limit, (rows) => {
      if (!active) return
      setData(rows)
      setLoading(false)
      setError(false)
    }, () => {
      if (!active) return
      setData([])
      setLoading(false)
      setError(true)
    })
    return () => { active = false; unsubscribe() }
  }, [limit])
  return { data, loading, error }
}

export function useUserProfile(uid?: string) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  useEffect(() => {
    let active = true
    setProfile(null)
    if (uid) void readUserProfile(uid).then((value) => { if (active) setProfile(value) }).catch(() => { if (active) setProfile(null) })
    return () => { active = false }
  }, [uid])
  return profile
}

export function useRecentEvents() {
  const [alcohol, setAlcohol] = useState<Record<string, any>[]>([])
  const [accidents, setAccidents] = useState<Record<string, any>[]>([])
  const [alcoholError, setAlcoholError] = useState(false)
  const [accidentsError, setAccidentsError] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    const alcoholRead = readLatest('smartHelmet/alcoholEvents', 50)
      .then((rows) => { if (active) setAlcohol(rows) })
      .catch(() => { if (active) setAlcoholError(true) })
    const accidentRead = readLatest('smartHelmet/accidentEvents', 50)
      .then((rows) => { if (active) setAccidents(rows) })
      .catch(() => { if (active) setAccidentsError(true) })
    void Promise.all([alcoholRead, accidentRead]).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  return useMemo(() => ({
    alcohol: [...alcohol].sort((a,b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
    accidents: [...accidents].sort((a,b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
    alcoholError,
    accidentsError,
    loading,
  }), [alcohol, accidents, alcoholError, accidentsError, loading])
}

export function useConnectionData() {
  const [data, setData] = useState<Record<string, any> | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const unsubscribe = subscribeConnection((value) => { setData(value); setError(false); setLoading(false) }, () => { setError(true); setLoading(false) })
    return () => unsubscribe()
  }, [])
  return { data, error, loading }
}

export const hooks = { useAuthState, useLiveHelmet, useLatestHistory, useLatestHistoryState, useUserProfile, useRecentEvents, useConnectionData }
