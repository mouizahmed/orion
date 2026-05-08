# Desktop and Backend Auth System Audit

Date: 2026-05-05

Scope: backend OAuth/session endpoints, one-time auth code handling, Electron main-process auth state, renderer auth state, and the web callback bridge.

## Findings

### Addressed: Custom-protocol interception can redeem desktop login

Original issue: the web bridge put both `code` and `state` into `orion://auth-complete`, and `/auth/complete` accepted exactly those two public values. A malicious local app or protocol-handler hijack that received that URL could call `/auth/complete` and get the Firebase custom token.

Status: addressed on 2026-05-05.

Resolution:

- Electron generates a high-entropy desktop-only PKCE-style `code_verifier`.
- Electron sends only `code_challenge=base64url(sha256(code_verifier))` and `code_challenge_method=S256` to `/auth/start`.
- Backend stores the challenge in `oauth_state:{state}` and copies it into the one-time auth code.
- The browser and `orion://auth-complete` URL still carry only `code` and `state`; they never carry the verifier.
- Electron redeems `/auth/complete` with `{ code, state, code_verifier }`.
- Backend hashes the verifier and rejects completion unless it matches the stored challenge.

Relevant files:

- `web/app/auth/callback/page.tsx`
- `web/components/open-app-callback.tsx`
- `desktop/electron/protocol-handler.ts`
- `desktop/electron/auth-handlers.ts`
- `backend/internal/auth/code.go`
- `backend/internal/handlers/oauth.go`

### Addressed: Microsoft login was treated as email-verified and then linked by email

Microsoft profiles are returned with `EmailVerified: true` unconditionally, then a new Microsoft identity can link into an existing user by matching email. If Microsoft's returned `mail` or `userPrincipalName` is not a verified primary email for the same person, this can become account takeover through email-linking.

Status: addressed on 2026-05-05.

Resolution:

- Microsoft profiles no longer mark `mail` or `userPrincipalName` as verified email evidence.
- Email-based account auto-linking is now allow-listed to providers with verified email evidence; currently that means Google only.
- A Microsoft login can still use an already-linked Microsoft provider subject.
- A Microsoft login can create a new app user when the email is not already present.
- If a Microsoft login returns an email that already belongs to an app user, the login is rejected instead of silently linking. The user must sign in first and link Microsoft from an authenticated account-linking flow.
- Existing app user email is preserved when the returning provider profile does not carry verified email evidence.

Relevant files:

- `backend/internal/auth/providers/microsoft.go`
- `backend/internal/handlers/oauth.go`

### Addressed: Desktop logout did not call backend token revocation

The renderer signs out locally, then calls Electron `auth:logout`, but Electron only flips local phase. The backend revocation route exists, but the desktop flow never sends the current ID token to it before local sign-out.

Status: addressed on 2026-05-05.

Resolution:

- Desktop logout now reads the current Firebase ID token before local sign-out.
- The renderer calls `POST /api/auth/logout` with `Authorization: Bearer <idToken>`.
- The backend `FirebaseAuthMiddleware` authenticates the request and `OAuthHandler.Logout` revokes Firebase refresh tokens for the authenticated user.
- Local Firebase sign-out and Electron `auth:logout` still run afterward to clear renderer and main-process desktop auth state.
- If backend revocation fails, the failure is logged and local logout still proceeds so the user is not trapped in a signed-in client state.

Relevant files:

- `desktop/src/contexts/DesktopAuthContext.tsx`
- `desktop/electron/auth-handlers.ts`
- `backend/cmd/api/main.go`
- `backend/internal/handlers/oauth.go`

### Addressed: Electron main trusted renderer-authenticated state

Renderer can send `auth:state-changed` with only `{ isAuthenticated: true }`, and main accepts it. That state gates desktop behaviors such as dashboard opening.

Status: addressed on 2026-05-05.

Resolution:

- Renderer auth-state notifications now include a Firebase ID token when reporting authenticated state.
- Electron preload forwards a structured `{ isAuthenticated, idToken }` payload instead of a bare boolean.
- Electron main verifies authenticated state by calling `GET /api/user/me` with `Authorization: Bearer <idToken>`.
- Main only moves to `signed-in` after the backend accepts the token.
- Main moves to `signed-out` when the renderer reports signed out, omits a token, or backend verification fails.
- Stale async verification responses are ignored so an older authenticated notification cannot override a newer signed-out notification.

Relevant files:

- `desktop/electron/preload.ts`
- `desktop/electron/auth-handlers.ts`
- `desktop/electron/ipc-handlers.ts`

### Addressed: Some sensitive Electron IPC was not auth-gated

Audio source and capture handlers do not check `isRendererAuthenticated()`.

Status: addressed on 2026-05-05.

Resolution:

- `audio:get-desktop-source-id` now returns no source unless Electron main has verified signed-in state.
- `audio:start-system-capture` now rejects unless Electron main has verified signed-in state.
- `audio:stop-system-capture` is ignored unless Electron main has verified signed-in state.
- The Windows `getDisplayMedia` request handler now denies screen/audio capture requests while signed out.
- Any active system-audio helper is stopped when main transitions to signed-out or OAuth-pending.
- Audio chunks are not forwarded if auth state is lost while the helper is running.

Relevant files:

- `desktop/electron/main.ts`
- `desktop/electron/ipc-handlers.ts`

### Addressed: `/auth/complete` consumed code before state mismatch handling

`ValidateAndConsumeCode` uses `GETDEL`, then state mismatch is checked afterward. A wrong-state request burns a valid code. This is mostly denial-of-service and lifecycle fragility.

Status: addressed on 2026-05-05.

Resolution:

- `CompleteAuth` now passes the expected OAuth state into `ValidateAndConsumeCode`.
- `ValidateAndConsumeCode` now uses a Redis Lua script to read the code, compare the stored state, and delete the code only when the state matches.
- Wrong-state completion attempts return an invalid-code response without consuming the valid one-time code.
- The existing expiry and used-code checks still run after atomic Redis consumption.

Relevant files:

- `backend/internal/auth/code.go`
- `backend/internal/handlers/oauth.go`

### Addressed: Auth middleware echoed malformed Authorization headers

Invalid auth format includes the received header in the response. If a client accidentally sends a token in the wrong format, it can be reflected into logs or UI.

Status: addressed on 2026-05-05.

Resolution:

- Invalid Authorization header format now returns a generic message.
- The malformed header value is no longer included in the JSON response.
- The middleware still returns the expected `Bearer <token>` format without reflecting client-supplied header content.

Relevant files:

- `backend/internal/middleware/firebase_auth.go`

## Follow-up findings from re-check

### Addressed: Desktop auth verifier was only required for the JSON start path

The intended Electron flow now sends `platform=desktop&response=json` with a PKCE-style `code_challenge`, and that path is protected. However, `/auth/start` only requires the verifier challenge when both `platform=desktop` and `response=json` are present.

A crafted redirect-style start URL such as `/auth/start?platform=desktop&provider=google` can still create a desktop OAuth state and later mint a desktop one-time code without a stored verifier. Because `/auth/complete` only checks `code_verifier` when the stored one-time code has a `CodeChallenge`, this reopens the custom-protocol interception class outside the normal Electron start path.

Status: addressed on 2026-05-05.

Resolution:

- `/auth/start` now requires a valid `code_challenge` and `code_challenge_method=S256` for every `platform=desktop` OAuth start.
- This enforcement no longer depends on `response=json`.
- Redirect-style desktop starts without verifier binding are rejected before OAuth state is created.

Relevant files:

- `backend/internal/handlers/oauth.go`

### Addressed: Wrong desktop verifier consumed the one-time code

`CompleteAuth` atomically validates state and consumes the one-time code before checking `code_verifier`. A bad verifier cannot redeem the session, but it can burn a valid login code and cause the legitimate desktop flow to fail.

This is primarily a denial-of-service and lifecycle robustness issue, similar to the previously fixed wrong-state consumption bug.

Status: addressed on 2026-05-05.

Resolution:

- `CompleteAuth` now computes the verifier-derived challenge before calling `ValidateAndConsumeCode`.
- The Redis Lua script now checks stored OAuth state and stored `code_challenge` before deleting the one-time code.
- If a stored challenge exists, Redis requires `code_challenge_method=S256` and an exact challenge match.
- Wrong or missing desktop verifier attempts now fail without consuming the valid one-time code.

Relevant files:

- `backend/internal/auth/code.go`
- `backend/internal/handlers/oauth.go`

### Addressed: Auth rate limiting depended on trusted client IP configuration

Auth rate limiting keys use `c.ClientIP()`. The router setup does not explicitly configure Gin trusted proxies. If the backend is deployed behind a proxy or load balancer with permissive forwarded-header trust, clients may be able to spoof IP headers and bypass auth rate limits.

Status: addressed on 2026-05-05.

Resolution:

- Backend startup now calls `router.SetTrustedProxies(...)` explicitly.
- By default, `TRUSTED_PROXIES` is empty and Gin trusts no forwarded client IP headers.
- Deployments behind a proxy or load balancer can set `TRUSTED_PROXIES` to a comma-separated list of exact trusted proxy IPs or CIDRs.
- `TRUSTED_PROXIES` must not be set to a broad public range such as `0.0.0.0/0`, because that would allow client-supplied forwarded IP spoofing.

Relevant files:

- `backend/cmd/api/main.go`
- `backend/internal/handlers/oauth.go`

### Addressed: Desktop lint failed in auth-adjacent code

The backend and web checks passed during the re-check:

- `go test ./...` from `backend`
- `npm run lint` from `web`

Desktop lint currently fails:

- `desktop/src/contexts/FirebaseAuthContext.tsx` uses `any` in `mapBackendUser`.
- `desktop/src/components/ChatWidget.tsx` has two React hook dependency warnings.

Status: addressed on 2026-05-05.

Resolution:

- `mapBackendUser` now accepts an `unknown`-typed backend payload shape and safely normalizes string fields.
- `ChatWidget` now depends on the actual `thinkingText` value instead of a boolean expression.
- `npm run lint` from `desktop` now passes.

Relevant files:

- `desktop/src/contexts/FirebaseAuthContext.tsx`
- `desktop/src/components/ChatWidget.tsx`

### Addressed: Dormant web-login path could mint unbound one-time codes

`platform=web` was accepted by `/auth/start` without requiring an auth verifier challenge, while the shared web callback page still forwarded any returned `code` and `state` into `orion://auth-complete`. Even though the product does not currently expose web login, this left a reachable half-implemented path that could bypass the desktop verifier binding.

Status: addressed on 2026-05-05.

Resolution:

- Web login is now disabled by default at `/auth/start`.
- The backend only accepts `platform=web` when `ENABLE_WEB_LOGIN` is explicitly enabled.
- Any enabled app-login platform, including future web login, must provide a valid S256 verifier challenge.
- The web callback page only bridges callbacks into `orion://auth-complete` when `platform=desktop`.
- Non-desktop auth callbacks now show an unsupported-login state instead of attempting to open the desktop app.

Relevant files:

- `backend/internal/handlers/oauth.go`
- `web/app/auth/callback/page.tsx`

## Recommendation

All original and follow-up findings in this audit have been addressed as of 2026-05-05. The desktop auth flow is hardened enough for sign-off from this review's threat model, with the remaining work being automated regression tests for the critical auth invariants and deployment checks for production configuration.
