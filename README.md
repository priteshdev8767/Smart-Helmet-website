# Smart Helmet Web App

Realtime React dashboard for the Smart Helmet ESP32 + Firebase Realtime Database project.

## Features

- Realtime `/smartHelmet/live` dashboard
- Full historical telemetry via `/smartHelmet/history`
- Alcohol and accident event history
- Informational Safety Score with plain-language reasons
- Simple Mode and Advanced Mode
- Realtime charts and telemetry replay
- GPS map with OpenStreetMap
- User authentication and profile
- Admin console with protected destructive actions
- Database manager, data retention tools, audit logs
- CSV/JSON export
- Presentation Mode
- Telemetry Replay
- Mobile responsive and React Native handoff guide
- Informational Safety Score with plain-language reasons

## Setup

1. Install Node.js LTS.
2. Copy `.env.example` to `.env.local`.
3. Add your Firebase web app configuration.
4. In Firebase Authentication enable Email/Password.
5. Apply `firebase.rules.json` in Realtime Database.
6. Create the first admin manually by adding `admins/<USER_UID>: true` in Realtime Database (while logged in as a trusted project owner in the Firebase console). Never allow end users to write this path.
7. Run:

```bash
npm install
npm run dev
```

## Database layout

```text
admins/{uid}: true
users/{uid}: profile
adminAuditLogs/{pushId}: audit record
smartHelmet/live: latest realtime reading
smartHelmet/history/{pushId}: historical telemetry
smartHelmet/alcoholEvents/{pushId}: alcohol events
smartHelmet/accidentEvents/{pushId}: accident events
smartHelmet/connectionTest: connection status
```

## Important security note

The browser must never contain Firebase Admin SDK service-account credentials, Telegram bot tokens, Gmail passwords, or other private secrets. Privileged admin operations here are protected by RTDB rules using the `admins/{uid}` flag. For a public production deployment, consider Firebase Admin SDK / Cloud Functions for high-trust actions and user disabling/role management.

## Existing ESP32 compatibility

This web app is designed around the existing field names and keeps the firmware accident thresholds unchanged. It does not directly control the motor or relay from the browser.
