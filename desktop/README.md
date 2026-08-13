# Orion Desktop

Electron, React, and Vite client for Orion.

## Authentication

The Electron main process owns the sole Supabase Auth client, PKCE flow, refresh token, encrypted session storage, and bounded pending-login transaction. This allows packaged cold-start deep links to finish without exposing verifier material. Renderer code consumes validated application-user snapshots and requests access tokens over sender-validated IPC. Do not add Supabase clients, refresh-token persistence, or direct provider OAuth handling to renderers.

Local development requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `AUTH_CALLBACK_URL=http://localhost:3000/auth/callback` in `.env.local`. Use a modern `sb_publishable_...` key. Never place secret or service-role keys in desktop configuration. Production must use the deployed HTTPS Orion callback and an exact matching Supabase redirect allow-list entry.

Calendar authorization remains separate and starts through the authenticated Orion backend.

## Development

```bash
npm install
npm run dev
npm run lint
```
