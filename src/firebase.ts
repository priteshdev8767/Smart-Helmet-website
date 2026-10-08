import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

const RTDB_URL = (import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://smart-helmet-by-prtesh-patil-default-rtdb.firebaseio.com').trim()

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCn_xSXw-wK9l8tNxEAYVybjHKZQ04AnGk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'smart-helmet-by-prtesh-patil.firebaseapp.com',
  databaseURL: RTDB_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'smart-helmet-by-prtesh-patil',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'smart-helmet-by-prtesh-patil.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '399755334974',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:399755334974:web:fba97d8ed79eab69f1c86f',
}

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getDatabase(firebaseApp, RTDB_URL)

if (import.meta.env.DEV) {
  console.log('[Firebase RTDB Initialized]', {
    projectId: firebaseConfig.projectId,
    databaseURL: RTDB_URL,
    authDomain: firebaseConfig.authDomain,
  })
}
