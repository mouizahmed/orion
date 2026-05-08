# Desktop Auth Lifecycle

## Current Model

The Electron main process owns the desktop auth phase and all window lifecycle decisions.

Auth phases:

```txt
initializing -> signed-out -> oauth-pending -> signed-in
```

Renderer roles:

```txt
Primary desktop renderer:
  - shows signed-out onboarding/auth UI
  - starts OAuth
  - receives OAuth completion from main
  - signs into Firebase with the backend custom token
  - reports Firebase auth state to main

Dashboard renderer:
  - reads Firebase auth state for UI and API calls
  - can request logout
  - does not handle OAuth callbacks
  - does not report global auth state to main
```

## Window Lifecycle

Signed out:

```txt
close dashboard
destroy overlay
show auth window
unregister shortcuts
```

OAuth pending:

```txt
close dashboard
destroy overlay
show auth window
unregister shortcuts
open browser OAuth
```

Signed in:

```txt
create/show overlay
close auth window
register shortcuts
dashboard opens only when requested
```

Dashboard windows are destroyed on signout so they cannot keep stale Firebase or app state across accounts.

## OAuth Flow

```txt
AuthWelcome
  -> electronAPI.authenticateWithGoogle()
  -> main opens backend /auth/start?platform=desktop
  -> backend owns OAuth state and callback validation
  -> web callback opens orion://auth-complete?code=...
  -> main exchanges one-time code with backend /auth/complete
  -> main sends auth-session-updated to the auth callback window
  -> primary renderer signs into Firebase with custom token
  -> Firebase auth listener reports signed-in state to main
```

OAuth failures and timeouts return to the auth UI and show an error on the sign-in step.

## Logout Flow

```txt
renderer calls Firebase signOut()
renderer invokes auth:logout
main phase becomes signed-out
main closes dashboard, destroys overlay, shows auth window, unregisters shortcuts
```

The app intentionally does not relaunch on logout. User-scoped renderer state is cleaned up by destroying signed-in windows and recreating them after the next successful sign-in.

## Invariants

- Main process is the authority for desktop auth phase.
- Only the primary desktop renderer handles OAuth completion.
- Dashboard is an auth consumer, not an auth controller.
- Dashboard can request logout, but main performs global window cleanup.
- Overlay and dashboard must not survive signout.
- Shortcuts are registered only while signed in.
- Firebase persistence is initialized before auth listeners attach.

## Future Improvements

- Add a small `stopAllUserServices()` hook in main before signout cleanup if user-scoped native services grow, such as transcription workers, audio capture helpers, or long-lived sockets.
- Add proper device/session management only when needed:
  - per-device session records
  - active sessions UI
  - revoke selected device
  - realtime or polling session-revoked signal
  - local forced signout on revoked session
- Add an end-to-end desktop auth test covering login, cancel, timeout, logout, and dashboard open after relogin.
