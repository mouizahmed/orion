# Orion local development runbook

This runbook starts Orion's four local development processes (API, web, desktop, and Stripe webhook forwarding). Use repository-relative paths so the commands remain portable across checkouts.

## Preferred: one-command controller

Future agents and local developers should use the repository controller instead of rediscovering or manually coordinating the four processes:

```powershell
.\scripts\local-dev.ps1 start
.\scripts\local-dev.ps1 status
.\scripts\local-dev.ps1 stop
```

`start` validates the local prerequisites, confirms Stripe CLI authentication, obtains the current test-mode webhook signing secret without printing it to the console, updates the ignored billing env file, and launches the backend, web app, desktop app, and Stripe listener as hidden managed processes. It waits for the HTTP services to become ready and stores process metadata and logs under the ignored `.runtime-logs` directory. Stripe's listener log can contain its development-only signing secret, so `.runtime-logs` must remain ignored and must not be shared. `stop` terminates only the process trees recorded by the controller.

The manual commands below are the fallback for interactive debugging.

## Prerequisites

- Go is installed and available as `go` in PowerShell.
- Node.js/npm are installed. Install each package's dependencies (`npm install` or the repository's documented equivalent) in `web` and `desktop` before the first run.
- Backend dependencies and configuration are present. The API reads `backend\cmd\api\.env` and billing values from `backend\cmd\api\.env.billing` (or the corresponding ignored local files expected by the backend).
- Stripe CLI is installed and authenticated. Verify authentication without exposing local configuration:

  ```powershell
  stripe whoami --format json
  ```

  Do not use commands that print Stripe CLI config or secrets.

## Start order

Open four PowerShell terminals from the repository root, then run:

1. **Backend API**

   ```powershell
   Set-Location .\backend
   go run .\cmd\api\main.go
   ```

   By default, the API binds to loopback at `http://localhost:8080`, which avoids recurring Windows Firewall prompts during local `go run`. Set `API_HOST=0.0.0.0` only when LAN or container access is intentionally needed; Windows may then request firewall access. Keep this process running before starting the webhook listener.

2. **Web app**

   ```powershell
   Set-Location .\web
   npm run dev
   ```

   The web development server listens on `http://localhost:3000`.

3. **Desktop app**

   Ensure `desktop\.env.local` exists with the local values required by the desktop app, then run:

   ```powershell
   Set-Location .\desktop
   npm run dev
   ```

   Vite serves the renderer at `http://localhost:5173`; the command also starts the Electron process.

4. **Stripe webhook listener**

   From the repository root (or any terminal with the same Stripe CLI auth), forward events to the API:

   ```powershell
   stripe listen --forward-to http://localhost:8080/webhooks/stripe `
     --events customer.subscription.created `
     --events customer.subscription.updated `
     --events customer.subscription.deleted `
     --events customer.subscription.paused `
     --events customer.subscription.resumed
   ```

   In PowerShell, pass one `--events` flag per event as shown. Do not rely on comma-separated event parsing.

   The listener prints a signing secret for the current development session. Put that value only in the ignored file `backend\cmd\api\.env.billing` as `STRIPE_WEBHOOK_SECRET=...`; never commit or paste it into documentation. This secret is development-only. Restart the backend after changing it so the API reloads the value.

## Verify

- API: run `Invoke-WebRequest http://localhost:8080/api/health` and confirm it returns HTTP `200`.
- Web: open `http://localhost:3000` and confirm the page loads.
- Desktop: confirm Vite reports port `5173` and an Electron window opens.
- Stripe: leave `stripe listen` running and create a test subscription event; confirm the listener reports a forwarded `2xx` response from `localhost:8080`.

## Clean shutdown

Press `Ctrl+C` in each terminal (Stripe listener, desktop, web, and backend). Stop the listener before restarting the API when testing webhook configuration changes.

## Troubleshooting

- **Port already in use (8080, 3000, or 5173):** stop the process using that port, then rerun the affected command. In PowerShell, inspect listeners with `Get-NetTCPConnection -LocalPort <port>` and identify the process with `Get-Process -Id <OwningProcess>`.
- **Webhook signature failures after rotating the listener:** copy the newly printed development signing secret to `backend\cmd\api\.env.billing` as `STRIPE_WEBHOOK_SECRET`, then stop and restart the backend. Do not reuse a stale listener secret.
- **`stripe whoami` fails:** authenticate the Stripe CLI for the current account, then rerun `stripe whoami --format json`; do not print or share the CLI config.
- **Missing modules or packages:** install dependencies in the failing directory and rerun its start command.

Future agents should run `scripts\local-dev.ps1 start` instead of rediscovering the local process setup. Keep this document free of secrets, account IDs, credentials, and process/session IDs.
