# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status**: This app is still in active development and is not yet live or production-deployed.

## Commands

### Backend (Go)
```bash
cd backend
go build ./cmd/api/...          # Build API server
go run ./cmd/api/main.go        # Run dev server
go vet ./...                    # Lint
```

### Desktop (Electron + Vite + React)
```bash
cd desktop
npm run dev      # Start Vite dev server with HMR
npm run build    # TypeScript compile + Vite build + Electron Builder
npm run lint     # ESLint (strict, max-warnings 0)
```

### Web (Next.js)
```bash
cd web
npm run dev      # Dev server on port 3000 (Turbopack)
npm run build    # Production build
npm run lint     # ESLint
```

## Architecture

Orion is an AI-powered meeting assistant with three sub-projects in a monorepo:

**`desktop/`** — Electron app (the primary user-facing product). Two React roots:
- `App.tsx` — real-time overlay UI shown during meetings (transcription, HUD)
- `DashboardApp.tsx` — full dashboard for notes, recordings, settings
- `electron/` — main process (`main.ts`) and IPC handlers (`ipc-handlers.ts`); preload bridge (`preload.ts`) exposes a typed API to the renderer

**`backend/`** — Go REST + WebSocket API (Gin framework):
- `cmd/api/main.go` — entrypoint, wires all routes
- `internal/handlers/` — HTTP route handlers (one file per domain)
- `internal/repository/` — data access layer against PostgreSQL
- `internal/models/` — domain structs
- `internal/auth/` — managed Supabase session validation and Orion principal lifecycle enforcement
- `internal/ai/` — OpenAI integration (completions, embeddings)
- `internal/calendar/` — Google Calendar / Outlook sync
- `internal/retrieval/` — Pinecone vector search
- `internal/storage/` — Backblaze B2 file uploads (gated through user token)
- `internal/queue/` — Redis-backed job queue
- `internal/memory/` — note chunking and persistence

**`web/`** — Next.js 16 App Router site used for marketing pages plus minimal authentication and calendar callback bridges (not the main app UI).

## Key Integrations

| Service | Purpose |
|---|---|
| Supabase Auth | Managed Google/Microsoft login; Electron main owns PKCE and encrypted sessions |
| PostgreSQL | Primary database (lib/pq, max 25 conns, 5s statement timeout) |
| OpenAI | LLM completions + embeddings |
| Pinecone | Vector search over note embeddings |
| Redis | Job queue and caching |
| Backblaze B2 | File/image storage (uploads gated through backend) |
| Deepgram | Real-time audio transcription |
| Google Calendar / Outlook | Calendar event sync |

## Database Access

You have live database access via two MCP servers:
- **Supabase MCP** — use `list_tables`, `execute_sql`, `apply_migration`, etc. (project ref: `njzmleaestfbhdamyitd`)

Prefer these over manual SQL when inspecting schema or verifying data during development. Prepared statement caching is disabled intentionally (Postgres compatibility).

## IPC (Desktop)

The Electron main process exposes APIs to the renderer through `electron/preload.ts`. IPC handlers live in `electron/ipc-handlers.ts` and are registered in `electron/main.ts`. When adding a new IPC channel, register it in `ipc-handlers.ts` and expose it in `preload.ts`.

Authentication is a strict Electron trust boundary: `electron/auth-handlers.ts` owns the sole Supabase client, PKCE verifier, refresh token, encrypted persistence, bootstrap validation, and sign-out. Renderers may receive validated user snapshots and request short-lived access tokens through sender-validated IPC; they must never store or receive refresh tokens.

The Go process must authenticate to PostgreSQL directly as `orion_backend`; startup verifies both `session_user` and `current_user`. Do not restore the previous owner credential plus `SET ROLE` pattern.

## Conventions

- Desktop and web both use Tailwind CSS v4 + Radix UI + shadcn/ui component patterns.
- No test suite is configured; there are no `test` scripts in any `package.json`.
- Desktop ESLint is strict (`max-warnings 0`); keep the renderer warning-free.
