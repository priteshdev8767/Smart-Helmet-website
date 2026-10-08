import { onValue, ref, query, orderByKey, limitToLast, push, remove, set, get } from 'firebase/database'
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile, User } from 'firebase/auth'
import { auth, db } from './firebase'
import type { AuditLog, HistoryRecord, UserProfile } from './types'

export const paths = {
  live: 'smartHelmet/live',
  history: 'smartHelmet/history',
  alcohol: 'smartHelmet/alcoholEvents',
  accidents: 'smartHelmet/accidentEvents',
  connection: 'smartHelmet/connectionTest',
  admins: 'helmet/admins',
  users: 'users',
  audits: 'adminAuditLogs',
}

export function subscribeLive(cb: (data: Record<string, unknown> | null) => void, onError?: (error: Error) => void) {
  return onValue(ref(db, paths.live), (snap) => cb(snap.val()), (error) => onError?.(error))
}

export function subscribeConnection(cb: (data: Record<string, unknown> | null) => void, onError?: (error: Error) => void) {
  return onValue(ref(db, paths.connection), (snap) => cb(snap.val()), (error) => onError?.(error))
}

export function subscribeLatestHistory(limit = 300, cb: (data: HistoryRecord[]) => void, onError?: (error: Error) => void) {
  const q = query(ref(db, paths.history), orderByKey(), limitToLast(limit))
  return onValue(q, (snap) => {
    const value = snap.val() as Record<string, HistoryRecord> | null
    cb(value ? Object.entries(value).map(([id, record]) => ({ ...record, __id: id } as HistoryRecord)) : [])
  }, (error) => onError?.(error))
}

export async function readLatest(path: string, limit = 300) {
  const q = query(ref(db, path), orderByKey(), limitToLast(limit))
  const snap = await get(q)
  const value = snap.val() as Record<string, unknown> | null
  return value ? Object.entries(value).map(([id, record]) => ({ ...(record as object), __id: id })) : []
}

export async function writeUserProfile(uid: string, profile: UserProfile) {
  await set(ref(db, `${paths.users}/${uid}`), profile)
}

export async function readUserProfile(uid: string) {
  const snap = await get(ref(db, `${paths.users}/${uid}`))
  return snap.exists() ? snap.val() as UserProfile : null
}

export async function isAdmin(uid: string): Promise<boolean> {
  if (!uid?.trim()) return false
  try {
    const snap = await get(ref(db, `${paths.admins}/${uid.trim()}`))
    return snap.exists() && snap.val() === true
  } catch (err) {
    console.error(`[isAdmin Error] reading ${paths.admins}/${uid}:`, err)
    return false
  }
}

export async function checkAdminStatus(uid: string): Promise<{ isAdmin: boolean; rawValue: unknown; error: string | null }> {
  if (!uid?.trim()) return { isAdmin: false, rawValue: null, error: 'No UID provided' }
  try {
    const adminRef = ref(db, `${paths.admins}/${uid.trim()}`)
    const snap = await get(adminRef)
    if (!snap.exists()) {
      return { isAdmin: false, rawValue: null, error: null }
    }
    const val = snap.val()
    return { isAdmin: val === true, rawValue: val, error: null }
  } catch (err: any) {
    console.error(`[checkAdminStatus Error] reading ${paths.admins}/${uid}:`, err)
    return { isAdmin: false, rawValue: undefined, error: err?.message || String(err) }
  }
}

export function subscribeAdmin(
  uid: string,
  cb: (res: { isAdmin: boolean; rawValue: unknown; error: string | null }) => void
) {
  const cleanUid = uid.trim()
  const adminRef = ref(db, `${paths.admins}/${cleanUid}`)

  // 1. Run direct get() for immediate resolution
  get(adminRef)
    .then((snap) => {
      const exists = snap.exists()
      const val = exists ? snap.val() : null
      cb({ isAdmin: val === true, rawValue: val, error: null })
    })
    .catch((err) => {
      console.warn(`[subscribeAdmin direct get] ${paths.admins}/${cleanUid}:`, err)
      cb({ isAdmin: false, rawValue: undefined, error: err?.message || String(err) })
    })

  // 2. Listen to live updates on value changes
  return onValue(
    adminRef,
    (snap) => {
      const exists = snap.exists()
      const val = exists ? snap.val() : null
      cb({ isAdmin: val === true, rawValue: val, error: null })
    },
    (error) => {
      console.error(`[subscribeAdmin onValue] ${paths.admins}/${cleanUid}:`, error)
      cb({ isAdmin: false, rawValue: undefined, error: error?.message || String(error) })
    }
  )
}

export async function writeAudit(log: AuditLog) {
  await set(push(ref(db, paths.audits)), log)
}

export async function clearDatabasePath(path: string) {
  await remove(ref(db, path))
}

export async function deleteDatabaseNode(path: string, id: string) {
  await remove(ref(db, `${path}/${id}`))
}

export function authListener(cb: (user: User | null) => void, onError?: (error: Error) => void) {
  return onAuthStateChanged(auth, cb, (error) => onError?.(error))
}

export async function register(email: string, password: string, name: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() })
  await writeUserProfile(credential.user.uid, { name: name.trim(), email, createdAt: Date.now() })
  return credential.user
}

export async function login(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function logout() {
  await signOut(auth)
}
