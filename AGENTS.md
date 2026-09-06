# Codex project guidance

- Do not use the in-app browser, computer-use tools, screenshots, or local visual UI inspection unless the user explicitly asks. The user handles visual UI inspection. Code-level checks such as TypeScript, lint, and builds remain appropriate.
- Do not write, add, or modify automated tests. Do not run automated test suites. Verify changes with TypeScript, lint, builds, static checks, and user-led visual inspection instead.

## Local development processes

The local application stack has four long-running processes. Run each in its named detached `screen` session and write output to its named log:

| Process | Screen session | Log |
| --- | --- | --- |
| Go backend | `orion-backend` | `/tmp/orion-backend.log` |
| Next.js web app | `orion-web` | `/tmp/orion-web.log` |
| Stripe CLI webhook listener | `orion-stripe` | `/tmp/orion-stripe.log` |
| Electron/Vite desktop app | `orion-desktop` | `/tmp/orion-desktop.log` |

When the user asks to restart the desktop app or local development stack, ensure all four processes are running. Restart them in backend, web, Stripe, desktop order with these commands:

```sh
screen -S orion-backend -X quit 2>/dev/null || true
screen -S orion-web -X quit 2>/dev/null || true
screen -S orion-stripe -X quit 2>/dev/null || true
screen -S orion-desktop -X quit 2>/dev/null || true
pkill -TERM -f '/Users/admin/Git/orion/desktop/node_modules/.bin/vite' 2>/dev/null || true
pkill -TERM -f '/Users/admin/Git/orion/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .' 2>/dev/null || true
screen -dmS orion-backend bash -lc 'cd /Users/admin/Git/orion/backend && exec env API_HOST=127.0.0.1 go run ./cmd/api/main.go > /tmp/orion-backend.log 2>&1'
screen -dmS orion-web bash -lc 'cd /Users/admin/Git/orion/web && exec npm run dev > /tmp/orion-web.log 2>&1'
screen -dmS orion-stripe bash -lc 'cd /Users/admin/Git/orion && exec stripe listen --skip-update --forward-to http://127.0.0.1:8080/webhooks/stripe --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed > /tmp/orion-stripe.log 2>&1'
screen -dmS orion-desktop bash -lc 'cd /Users/admin/Git/orion/desktop && exec npm run dev > /tmp/orion-desktop.log 2>&1'
```

Then verify startup without using UI inspection:

```sh
screen -ls
ps -axo pid,ppid,state,command | rg 'orion/(backend|web)|stripe listen' | rg -v 'rg '
ps -axo pid,ppid,state,command | rg '/Users/admin/Git/orion/desktop/(node_modules/.bin/vite|node_modules/electron)' | rg -v 'rg '
tail -80 /tmp/orion-backend.log
tail -80 /tmp/orion-web.log
tail -80 /tmp/orion-stripe.log
tail -80 /tmp/orion-desktop.log
```

If a stale Electron main process survives after Vite exits, terminate that exact Orion desktop process before launching the session again; Electron's single-instance lock can otherwise cause the new session to exit immediately.
