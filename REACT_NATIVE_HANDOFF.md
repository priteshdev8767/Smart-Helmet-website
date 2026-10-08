# React Native handoff

This web app keeps the Firebase data model independent from UI. Later, build a React Native client against the same Firebase project and reuse these contracts:

- `src/types.ts` -> move to a shared package.
- `src/services.ts` -> reimplement Firebase listeners using the React Native Firebase SDK or Firebase JS SDK supported by the chosen RN setup.
- Database paths are under `smartHelmet/*`.
- User profile path is `users/{uid}`.
- Admin flag is `admins/{uid}`.

Recommended mobile tabs:
1. Home
2. Live
3. Alerts
4. History
5. Profile

Do not copy browser-only APIs (Leaflet, DOM downloads, Vite env handling) directly into React Native. Keep the same TypeScript data types and business rules, but use native map, file export/share, secure storage, and notification libraries.
