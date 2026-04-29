# kun-v2 — Runner Checkin/Checkout (mobile-first)

This folder contains a minimal Web-App prototype (HTML + Tailwind + single `app.js`) to perform checkin/checkout by scanning QR codes.

Quick start
- Open `kun-v2/index.html` in a static server or directly in browser (recommended via local http server).

API contract (expected)
- POST `/auth/login` — body: `{ username, password }`. Server MUST set session cookie via `Set-Cookie` in response. CORS: server must allow credentials.
- GET `/auth/session` — returns 200 + JSON user info if cookie valid.
- POST `/scan` — body: `{ bib, action }` (action = "checkin" | "checkout"). Cookie will be sent automatically by browser.

Notes
- Client uses `fetch(..., { credentials: 'include' })` so server must set `Access-Control-Allow-Credentials: true` and allow origin.
- The app uses `zxing-wasm@3.0.1` (IIFE build) via CDN. The code attempts to use `BrowserMultiFormatReader` if present.
- All client logic is consolidated in `app.js` as requested.

Next steps
- Improve error handling and show user-friendly alerts.
- Add unit tests / e2e tests and CI.
- Optional: switch to bundler and split JS modules when project grows.
