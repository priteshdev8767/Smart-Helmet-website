import { ref, get, set, remove, query, orderByKey, limitToLast, limitToFirst, startAfter, endBefore, onValue, push } from 'firebase/database'
import { db, auth } from '../firebase'
import { paths } from '../services'
import type { AuditLog } from '../types'

// ─── Read all users ─────────────────────────────────────────
export async function readAllUsers(): Promise<Record<string, any>> {
  const snap = await get(ref(db, paths.users))
  return snap.exists() ? snap.val() : {}
}

// ─── Read all admins ────────────────────────────────────────
export async function readAllAdmins(): Promise<Record<string, boolean>> {
  const snap = await get(ref(db, paths.admins))
  return snap.exists() ? snap.val() : {}
}

// ─── Set admin role ─────────────────────────────────────────
export async function setAdminRole(uid: string, isAdmin: boolean) {
  if (isAdmin) {
    await set(ref(db, `${paths.admins}/${uid}`), true)
  } else {
    await remove(ref(db, `${paths.admins}/${uid}`))
  }
}

// ─── Write audit log ────────────────────────────────────────
export async function writeAdminAudit(action: string, path: string, result: string, details?: string) {
  const log: AuditLog = {
    adminUid: auth.currentUser?.uid,
    adminEmail: auth.currentUser?.email,
    action,
    path,
    timestamp: Date.now(),
    result,
    details,
  }
  await set(push(ref(db, paths.audits)), log)
}

// ─── Paginated read ─────────────────────────────────────────
export async function readPaginated(path: string, limit: number, startAfterKey?: string) {
  let q
  if (startAfterKey) {
    q = query(ref(db, path), orderByKey(), startAfter(startAfterKey), limitToFirst(limit))
  } else {
    q = query(ref(db, path), orderByKey(), limitToLast(limit))
  }
  const snap = await get(q)
  const value = snap.val() as Record<string, unknown> | null
  if (!value) return []
  return Object.entries(value).map(([id, record]) => ({ ...(record as object), __id: id }))
}

// ─── Read branch keys count estimate ────────────────────────
export async function estimateBranchSize(path: string): Promise<{ exists: boolean; count: number; oldestKey?: string; newestKey?: string }> {
  const snap = await get(ref(db, path))
  if (!snap.exists()) return { exists: false, count: 0 }
  const val = snap.val()
  if (typeof val !== 'object' || val === null) return { exists: true, count: 1 }
  const keys = Object.keys(val)
  return { exists: true, count: keys.length, oldestKey: keys[0], newestKey: keys[keys.length - 1] }
}

// ─── Read a single branch's full data ───────────────────────
export async function readBranchData(path: string): Promise<any> {
  const snap = await get(ref(db, path))
  return snap.exists() ? snap.val() : null
}

// ─── Subscribe to a branch ──────────────────────────────────
export function subscribeBranch(path: string, cb: (data: any) => void, onError?: (e: Error) => void) {
  return onValue(ref(db, path), (snap) => cb(snap.val()), (e) => onError?.(e))
}

// ─── Delete specific records ────────────────────────────────
export async function deleteRecords(path: string, ids: string[]) {
  for (const id of ids) {
    await remove(ref(db, `${path}/${id}`))
  }
}

// ─── Delete records before timestamp ────────────────────────
export async function deleteRecordsBefore(path: string, beforeTimestamp: number): Promise<number> {
  const snap = await get(ref(db, path))
  if (!snap.exists()) return 0
  const val = snap.val() as Record<string, any>
  let count = 0
  for (const [key, record] of Object.entries(val)) {
    if (record?.timestamp && record.timestamp < beforeTimestamp) {
      await remove(ref(db, `${path}/${key}`))
      count++
    }
  }
  return count
}

// ─── Clear entire branch ────────────────────────────────────
export async function clearBranch(path: string) {
  await remove(ref(db, path))
}

// ─── Read audit logs ────────────────────────────────────────
export async function readAuditLogs(limit = 500): Promise<any[]> {
  const q = query(ref(db, paths.audits), orderByKey(), limitToLast(limit))
  const snap = await get(q)
  const value = snap.val() as Record<string, unknown> | null
  if (!value) return []
  return Object.entries(value).map(([id, record]) => ({ ...(record as object), __id: id })).reverse()
}

// ─── Search across branches ─────────────────────────────────
export async function searchDatabase(searchTerm: string, branches: { label: string; path: string }[], limit = 200): Promise<any[]> {
  const results: any[] = []
  const term = searchTerm.toLowerCase()
  for (const branch of branches) {
    try {
      const q = query(ref(db, branch.path), orderByKey(), limitToLast(limit))
      const snap = await get(q)
      if (!snap.exists()) continue
      const val = snap.val() as Record<string, any>
      for (const [key, record] of Object.entries(val)) {
        if (typeof record !== 'object' || record === null) continue
        for (const [field, value] of Object.entries(record)) {
          if (String(value).toLowerCase().includes(term) || field.toLowerCase().includes(term)) {
            results.push({
              __id: key,
              __branch: branch.label,
              __path: branch.path,
              __matchField: field,
              __matchValue: String(value),
              ...record,
            })
            break
          }
        }
      }
    } catch { /* skip inaccessible branches */ }
  }
  return results
}
