# Login OAuth Hardening Plan

## Goal

Move application login OAuth state ownership and validation to the backend before implementing calendar connections.

The current desktop login flow generates OAuth `state` in Electron and validates it after the backend has already processed the Google callback. The hardened flow should have the backend generate, store, validate, and consume `state` before exchanging the authorization code, creating/updating users, creating Firebase tokens, or issuing a desktop one-time code.

This keeps app login and future integration OAuth flows aligned around the same security model:

- backend-owned OAuth state
- explicit state purpose
- short state TTL
- one-time state consumption
- no code exchange until state is valid

## Current State

Relevant files:

- `desktop/electron/auth-handlers.ts`
- `desktop/electron/protocol-handler.ts`
- `desktop/electron/preload.ts`
- `desktop/src/contexts/AuthContext.tsx`
- `backend/internal/handlers/oauth.go`
- `backend/cmd/api/main.go`

Current behavior:

1. Desktop generates a random OAuth `state`.
2. Desktop stores the state in memory in `pendingStates`.
3. Desktop opens:

   ```txt
   GET /auth/start?state={state}&platform=desktop
   ```

4. Backend stores `oauth_state:{state}` only as callback-routing metadata.
5. Backend redirects to Google.
6. Google redirects to:

   ```txt
   GET /auth/callback?code={code}&state={state}
   ```

7. Backend reads platform metadata but does not enforce server-side state validation.
8. Backend exchanges the code, fetches Google user info, creates/updates the app user, creates a Firebase custom token, stores Google OAuth tokens, and creates a one-time desktop auth code.
9. Frontend/deep link returns the one-time code and state to desktop.
10. Desktop validates the state locally in `protocol-handler.ts`.
11. Desktop calls `/auth/complete` and receives the Firebase token.

Problem:

The backend performs sensitive callback work before proving that the callback belongs to an OAuth login it initiated. Desktop-side state validation happens too late to protect the backend callback boundary.

## Target Behavior

Backend owns login OAuth state.

1. Desktop asks backend to start login.
2. Backend generates secure random `state`.
3. Backend stores a Redis payload under `oauth_state:{state}`.
4. Backend returns or redirects to the Google authorization URL.
5. Google redirects to `/auth/callback`.
6. Backend validates and consumes the Redis state.
7. Backend rejects missing, expired, reused, wrong-purpose, or malformed state before exchanging the authorization code.
8. Backend exchanges the code only after state is valid.
9. Backend creates/updates user and Firebase token.
10. Backend issues the existing one-time desktop code.
11. Desktop completes auth using `/auth/complete`.

Firebase remains in place. This plan hardens OAuth CSRF/session binding only; it does not replace Firebase Auth, Firebase custom tokens, or Firebase ID token middleware.

## API Shape

Prefer keeping route names stable to reduce frontend churn.

### Start Login

Change `/auth/start` so the backend can generate state.

Recommended request:

```txt
GET /auth/start?platform=desktop
```

Backend behavior:

- Validate `platform`; allowed values: `desktop`, `web`.
- Generate a cryptographically secure random state.
- Store Redis state payload for 10 minutes.
- Redirect to Google authorization URL.

State payload:

```json
{
  "purpose": "app_login",
  "platform": "desktop",
  "ip": "request-ip",
  "user_agent": "request-user-agent",
  "created_at": "2026-05-01T00:00:00Z"
}
```

Redis key:

```txt
oauth_state:{state}
```

Keep this key prefix for app login only. Calendar/integration OAuth should later use a separate prefix such as:

```txt
integration_oauth_state:{state}
```

### Callback

Keep:

```txt
GET /auth/callback
```

Callback behavior:

- Read `code`, `state`, and provider error params.
- If provider returned an error, redirect to frontend/deep link with a safe error.
- Require both `code` and `state`.
- `GETDEL oauth_state:{state}` from Redis.
- Reject if state is missing or expired.
- Decode payload.
- Reject if `purpose != "app_login"`.
- Reject if `platform` is not allowed.
- Only then exchange the authorization code with Google.

Do not log full callback URLs, authorization codes, access tokens, refresh tokens, or one-time codes.

### Complete Auth

Keep existing:

```txt
POST /auth/complete
```

No major API change needed. It should continue to validate and consume the one-time code and return the Firebase token.

## Desktop Flow

### Main Process Start

Update `desktop/electron/auth-handlers.ts`.

Current behavior:

- Generate `state`.
- Store `state` locally.
- Open `/auth/start?state={state}&platform=desktop`.

New behavior:

- Do not generate OAuth state in Electron.
- Open `/auth/start?platform=desktop`.
- Remove `pendingStates`, `generateOAuthState`, `storeTemporaryState`, and `validateState` once protocol callback no longer uses them.

### Protocol Callback

Update `desktop/electron/protocol-handler.ts`.

Current behavior:

- `handleAuthComplete` requires `state`.
- Calls `validateState(state)`.
- Requires one-time `code`.
- Calls `/auth/complete`.

New behavior:

- `handleAuthComplete` should require the one-time desktop `code`.
- It should not require OAuth `state`; state was already validated by the backend.
- Validate only the one-time code format before calling `/auth/complete`.
- Continue sending `auth-session-updated` to the renderer.

Recommended deep link:

```txt
orionly://auth-complete?code={oneTimeCode}
```

Optional transition support:

- During rollout, tolerate a `state` query param if present, but do not require it.
- Remove desktop state validation after backend validation is live and verified.

## Backend Implementation Details

### Secure State Generation

Add or reuse a helper that uses `crypto/rand`, not `math/rand`.

Suggested behavior:

- Generate 32 random bytes.
- Encode with URL-safe base64 without padding.

Example output length: around 43 characters.

### State Storage

Create a typed payload for login OAuth state in `backend/internal/handlers/oauth.go` or a small auth helper file.

Suggested struct:

```go
type LoginOAuthState struct {
	Purpose   string `json:"purpose"`
	Platform  string `json:"platform"`
	IP        string `json:"ip"`
	UserAgent string `json:"user_agent"`
	CreatedAt string `json:"created_at"`
}
```

Use:

```go
SetEx(ctx, "oauth_state:"+state, payload, 10*time.Minute)
GetDel(ctx, "oauth_state:"+state)
```

If Redis is unavailable during `/auth/start`, fail the request instead of starting OAuth without state storage. This is stricter than the current flow and is the correct tradeoff for login security.

### Callback Routing

The callback should derive platform only from the validated state payload.

Do not default missing Redis state to `desktop`. A missing state should fail.

For errors before state validation:

- If no valid state is available, redirect to a generic frontend callback error URL.
- Do not try to infer desktop vs web from an untrusted query parameter.

For errors after state validation:

- Use the validated payload platform to choose the redirect behavior.

### Redirects

Current backend redirects to `FRONTEND_CALLBACK_URL` with `code` and `state`.

Recommended desktop redirect after hardening:

```txt
orionly://auth-complete?code={oneTimeCode}
```

If the current browser callback page is required for production packaging, use one of these approaches:

Option A: direct desktop deep link

- Backend redirects directly to `orionly://auth-complete?code=...`.
- Simpler desktop flow.
- Browser may show an external-app prompt.

Option B: frontend bridge page

- Backend redirects to `FRONTEND_CALLBACK_URL?code=...&platform=desktop`.
- Frontend page opens `orionly://auth-complete?code=...`.
- Keeps current browser bridge behavior.

Recommendation:

Use Option B if the current production login already depends on a frontend bridge page. Otherwise, use Option A for less moving state.

## Scope Decisions

In scope:

- Backend-generated login OAuth state.
- Redis-backed state validation and one-time consumption.
- Purpose field: `app_login`.
- Removing backend acceptance of caller-supplied login state.
- Removing desktop OAuth state requirement after backend validation.
- Removing calendar scope from login can happen after this plan or as the first step of calendar connections.

Out of scope:

- Replacing Firebase.
- Changing `/auth/complete` response shape.
- Replacing one-time desktop codes.
- Adding integration/calendar OAuth endpoints.
- Migrating `user_oauth_tokens`.
- Changing database schema.

## Security Requirements

- Generate state with cryptographic randomness.
- Store state server-side before redirecting to Google.
- Use a 10-minute TTL.
- Consume state exactly once with `GETDEL`.
- Validate `purpose`.
- Validate `platform`.
- Reject missing/expired/reused state before exchanging code.
- Never log authorization codes, access tokens, refresh tokens, one-time auth codes, or full callback URLs containing secrets.
- Do not continue OAuth login if Redis write fails during start.

## Compatibility Notes

The current frontend and desktop auth code may expect a `state` query param in the auth-complete deep link. During transition, the backend can continue including `state` in the final redirect, but desktop should stop requiring local state validation.

Recommended transition:

1. Backend validates state server-side but still includes `state` in the final redirect.
2. Desktop removes state requirement.
3. After verification, backend stops including `state` in the final auth-complete redirect.

## Testing Plan

Backend tests:

- `/auth/start` generates state and stores Redis payload.
- `/auth/start` rejects unsupported platform.
- `/auth/start` fails if Redis state storage fails.
- `/auth/callback` rejects missing state.
- `/auth/callback` rejects expired/missing Redis state.
- `/auth/callback` rejects wrong `purpose`.
- `/auth/callback` consumes state once; replay fails.
- `/auth/callback` does not exchange code when state is invalid.
- `/auth/callback` exchanges code only after valid state.
- `/auth/callback` uses validated platform for redirect behavior.

Desktop manual checks:

- Google login opens browser from desktop.
- Successful Google login returns to desktop.
- Desktop receives Firebase token and signs in.
- Reusing an old callback URL fails.
- Login cancellation shows a clear error.
- Web login still works if supported.

Security checks:

- Logs do not include full callback URL, auth code, tokens, or one-time code.
- Redis keys expire.
- State cannot be reused.
- Login state cannot be accepted as integration state later, and integration state cannot be accepted as login state.

## Suggested Implementation Order

1. Add backend helper for cryptographic state generation.
2. Add typed login OAuth state payload.
3. Change `/auth/start` to generate/store state and stop requiring caller-supplied `state`.
4. Change `/auth/callback` to validate and consume Redis state before code exchange.
5. Remove unsafe default-to-desktop behavior on missing state.
6. Stop logging full redirect URLs and one-time codes.
7. Update Electron `auth-handlers.ts` to stop generating/storing OAuth state.
8. Update Electron `protocol-handler.ts` to stop requiring local OAuth state validation.
9. Update TypeScript types only if exposed APIs change.
10. Run backend build/tests and desktop typecheck.
11. Manually verify desktop Google login.

## Follow-Up Into Calendar Connections

After this plan is complete, the calendar connections implementation should use the same pattern with different purpose and Redis key prefix:

```txt
integration_oauth_state:{state}
purpose: integration_connect
```

The important difference is that integration OAuth start is authenticated with Firebase and stores `user_id` in the state payload, while app login OAuth start is unauthenticated and creates or links the app user only after Google identity is verified.
