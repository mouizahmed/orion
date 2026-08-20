# Stripe Billing Final Review and Remediation

**Repository status:** Remediation complete on the `supabase-auth` branch.

**Deployment status:** The Stripe sandbox integration is clean enough to move
on from. Live billing is intentionally blocked on the external production gates
listed below.

This record is based on the actual Go, Electron, web, and SQL implementation;
direct read-only inspection of the hosted Supabase development database;
read-only inspection of Stripe test-mode resources; and current official Stripe
and Supabase guidance. The earlier execution plan and prior verification claims
were not treated as proof. No automated tests, test files, test dependencies,
test scripts, or CI were added.

## 1. Blocking

No blocking repository defect remains.

## 2. High findings

### Resolved: delayed webhooks could project an older subscription

- **Location:** `backend/internal/billing/processor.go:138` and
  `backend/internal/billing/reconciliation.go:80`
- **Verified failure:** Processing an old terminal-subscription event previously
  projected that event's subscription directly, so delivery order could replace
  a newer active projection and incorrectly remove access.
- **Correction:** Every subscription event now resolves its customer and lists
  the customer's complete Stripe subscription set. A single nonterminal
  subscription wins; otherwise the newest terminal subscription wins. More than
  one nonterminal subscription fails closed for operator reconciliation. The
  periodic reconciler uses exactly the same selection path.

### Resolved: production Electron builds could call localhost

- **Location:** `desktop/src/lib/api-config.ts:1` and
  `desktop/vite.config.ts:24`
- **Verified failure:** Scattered renderer fallbacks could silently send a
  production build to a loopback backend.
- **Correction:** All renderer clients use one validated origin. Production
  builds require an explicit non-loopback HTTPS `VITE_API_BASE_URL`; development
  alone defaults to localhost.

## 3. Medium findings

### Resolved: incomplete webhook status coverage

- **Location:** `backend/internal/billing/webhook.go:13`
- **Verified failure:** Explicit Stripe pause and resume events were not
  allowlisted, delaying authorization changes until another update or periodic
  reconciliation.
- **Correction:** `customer.subscription.paused` and
  `customer.subscription.resumed` are durably accepted and processed with the
  existing create, update, and delete events.

### Resolved: ambiguous Checkout retries could create another session

- **Location:** `backend/internal/billing/checkout.go:141` and
  `desktop/src/features/settings/sections/billing/BillingSettings.tsx`
- **Verified failure:** Releasing the account reservation after an ambiguous
  Stripe response let a retry use a new operation identifier and create a second
  trial-bearing Checkout Session.
- **Correction:** Once the create request may have reached Stripe, the 32-minute
  reservation remains bound to the operation identifier. Electron persists and
  reuses that identifier across retries/reloads. Stripe's idempotency key contains
  mode, account, offer, and operation identifier. The reservation outlives the
  31-minute Checkout Session.

### Resolved: missing customer mappings trusted one metadata source

- **Location:** `backend/internal/billing/processor.go:270`
- **Verified failure:** A missing local mapping could be repaired from
  uncorroborated provider metadata.
- **Correction:** Repair now retrieves the Stripe Customer and requires its
  account UUID to exactly match the Subscription account UUID before inserting
  the local mapping.

### Resolved: live/test and return-URL configuration was too permissive

- **Location:** `backend/internal/billing/config.go:58` and
  `backend/internal/billing/hosted_url.go:9`
- **Verified failure:** Environment naming alone could permit a live key with a
  development callback, and a compromised provider response could return an
  arbitrary external URL to Electron.
- **Correction:** Only `rk_test_` and `rk_live_` keys are accepted. A live key
  requires `APP_ENV=production`; production/live return URLs require non-loopback
  HTTPS; and returned hosted URLs must be HTTPS on `stripe.com` or a Stripe
  subdomain.

### Resolved: expiring overrides could hide paid access

- **Location:** `supabase/schema.sql:834` and
  `backend/internal/repository/user.go:135`
- **Verified failure:** When an administrator or promotion override expired,
  authentication could return Free even though the account still had a verified
  current paid subscription projection.
- **Correction:** The narrowly granted `orion_internal.resolve_account_plan`
  function falls back to the current, mode-matched local Stripe projection. It
  remains fail-closed for expired subscription materialization and never calls
  Stripe during authentication.

### Resolved: concurrent projection writers could race

- **Location:** `backend/internal/repository/subscription.go:150` and
  `backend/internal/repository/subscription.go:263`
- **Verified failure:** Webhook processing and periodic reconciliation could
  update the partial unique current-subscription set concurrently.
- **Correction:** Both projection paths lock the account row before changing
  subscription rows, serializing all billing projection for an account inside a
  single database transaction.

### Resolved: nonterminal failure states produced a misleading Checkout action

- **Location:** `desktop/src/features/settings/sections/billing/BillingSettings.tsx`
- **Verified failure:** `unpaid`, `paused`, `past_due`, or `incomplete` accounts
  could be shown a Start Trial action that the backend correctly rejected.
- **Correction:** Electron now treats every nonterminal status as an existing
  subscription, disables Checkout/interval selection, and directs the user to
  manage that subscription.

### External: hosted Postgres security patches

- **Location:** Supabase project setting; no repository line.
- **Verified state:** The security advisor reports that the hosted
  `supabase-postgres-15.8.1.111` version has security patches available.
- **Smallest correction:** Schedule the Supabase platform upgrade before live
  production. This was explicitly deferred and cannot be performed as a
  read-only repository change.

## 4. Low findings

### Resolved: raw processing errors were retained

- **Location:** `backend/internal/repository/billing_webhook.go:24` and
  `supabase/schema.sql:300`
- **Verified failure:** Provider/database error text can contain request-log URLs
  and identifiers.
- **Correction:** Only the stable allowlisted code
  `subscription_sync_failed` is stored. The database constraint rejects other
  values, and ordinary reconciliation logs contain no provider identifiers.

### Resolved: canonical sequence grants exceeded hosted least privilege

- **Location:** `supabase/schema.sql:908`
- **Verified failure:** Canonical SQL granted sequence `SELECT` while runtime
  only needs `USAGE`.
- **Correction:** Canonical and hosted grants now give the backend `USAGE` only;
  `anon` and `authenticated` have neither `USAGE` nor `SELECT`.

### Resolved: plan limits and pricing presentation could drift

- **Location:** `backend/internal/entitlements/catalog.json`,
  `backend/internal/entitlements/plans.go:66`,
  `desktop/src/features/settings/sections/billing/billing-catalog.ts`, and
  `web/components/landing/pricing.tsx:6`
- **Verified failure:** Independent constants could disagree across quota
  authorization, Electron, and the website.
- **Correction:** One nonsecret catalog drives backend entitlements and both
  clients. The backend fails fast on unknown/duplicate plans and offers, invalid
  currency/amount/interval/trial data, and unknown plan references. Stripe Price
  identifiers remain environment-only secrets/configuration.

### Resolved: callback polling and stale billing UI

- **Location:** `desktop/src/features/settings/sections/billing/BillingContext.tsx` and
  `desktop/electron/protocol-handler.ts:115`
- **Verified failure:** Portal/cancel callbacks could display the Checkout
  confirmation state and poll unnecessarily; returning focus could retain stale
  data.
- **Correction:** Only successful Checkout polls for webhook confirmation.
  Portal and cancellation refresh once, and focus/visibility refreshes billing
  status. Deep links contain only an allowlisted result and merely reveal the
  billing page.

### Resolved: dependency advisory in the desktop tree

- **Location:** `desktop/package.json:66`
- **Verified failure:** The dependency graph resolved a vulnerable `js-yaml`
  release.
- **Correction:** The safe patch release is pinned through an npm override.
  Fresh desktop and web audits report zero known vulnerabilities.

### Resolved: billing card interval selector was attached to the wrong plan

- **Location:** `desktop/src/features/settings/sections/billing/BillingSettings.tsx`
- **Verified failure:** When Professional was current, the monthly/yearly
  selector appeared inside the Free card, and the Free card could display a
  Start Trial label.
- **Correction:** The selector now belongs to the Plans header, reflects the
  current offer, and is disabled while an existing nonterminal subscription must
  be managed through Stripe.

### External: disclosed test restricted key

- **Location:** Stripe Dashboard and ignored backend environment file; no
  tracked source line.
- **Verified state:** A test restricted key was shared outside the secret
  manager during development. Secret scanning found no copy in tracked/untracked
  source or generated bundles.
- **Smallest correction:** Rotate the test restricted key in Stripe, replace the
  ignored runtime value, and revoke the disclosed key.

## 5. Accepted limitations

- Pending Subscription Schedule phases are not projected locally. Monthly and
  annual Professional offers currently have identical entitlements, so Orion
  continues authorizing the current Stripe subscription until Stripe applies the
  scheduled phase. Revisit this before scheduled phases can change plan features
  or quota.
- The 15-minute reconciliation loop is recovery for missed webhooks, not the
  normal update path. Authorization remains fail-closed if both webhook delivery
  and the latest local period expire before reconciliation succeeds.
- A Stripe CLI listener and its signing secret are development-only. Production
  needs an HTTPS webhook endpoint and independent live signing secret.
- The two usage-ledger tables intentionally use forced RLS with no direct
  policies or backend table grants. The backend consumes usage only through the
  narrowly granted security-definer function.
- Unused-index advisor notices are telemetry from a tiny development dataset,
  not evidence that ownership/history lookup indexes should be removed before
  representative production traffic exists.
- Remaining lifecycle scenarios are manual by product decision: canceled
  Checkout, interval changes, renewal, payment failure/recovery, immediate and
  period-end cancellation, and terminal resubscription without another trial.
- Whole-tree `gofmt -l` reports legacy CRLF-only files. Every changed/new Go file
  is gofmt-clean; unrelated files were not rewritten solely to normalize line
  endings.
- The optimized Electron renderer chunk is larger than Vite's advisory
  threshold. This is a general performance optimization, not a billing safety or
  correctness defect.

## 6. Verified strengths

- `public.accounts`, `public.account_plan_changes`, both usage tables,
  `public.billing_customers`, `public.subscriptions`, and
  `public.billing_webhook_events` are owned by `postgres`, have enabled and
  forced RLS, explicit public/`anon`/`authenticated` revocations, ownership
  cascades, and narrowly scoped backend grants.
- Hosted invariants returned zero active users without accounts, orphan
  accounts, duplicate current subscriptions, unresolved webhook events, invalid
  webhook error codes, and live-mode billing rows.
- `orion_internal.consume_account_usage` and
  `orion_internal.resolve_account_plan` are `SECURITY DEFINER`, owned by
  `postgres`, use an empty `search_path`, and are executable only by
  `orion_backend` (plus the owner).
- Webhooks verify the raw body before durable insertion, enforce a 1 MiB limit,
  reject mode mismatch, allowlist event types, deduplicate provider event IDs,
  claim with `FOR UPDATE SKIP LOCKED`, recover abandoned claims, retry with
  bounded backoff, and purge retained payloads after 30 days once terminal.
- Callbacks and renderer clients cannot grant plans. Only verified Stripe state
  projected by the backend mutates `public.subscriptions` and
  `public.accounts`.
- Electron owns its encrypted Supabase session; authenticated billing calls use
  the backend boundary; deep-link callbacks carry no access token, Stripe
  identifier, or authoritative plan data.
- Stripe test-mode inspection confirmed one active monthly USD recurring Price
  at the catalog amount, one active annual USD recurring Price at the catalog
  amount, both under the same Product, and an active Portal configuration with
  payment-method updates plus subscription update/cancellation enabled. The
  runtime key is restricted/test-only and deliberately lacks Price-read access.
- Canonical `supabase/schema.sql` contains the hosted billing constraints,
  indexes, policies, functions, and tightened grants applied during remediation.

## Verification evidence

- `go build ./...`: passed.
- `go vet ./...`: passed.
- Changed/new Go files: gofmt-clean.
- Electron `npx tsc --noEmit`: passed.
- Electron ESLint with zero warnings: passed.
- Electron production Vite renderer/main/preload build with explicit HTTPS
  production origins: passed.
- Web `npx tsc --noEmit`: passed.
- Web ESLint: passed.
- Next.js production build: passed.
- `go mod verify`: passed.
- Desktop and web `npm audit`: zero known vulnerabilities.
- `git diff --check`: passed.
- Secret scan: 270 source/config/document files and 316 generated bundle files;
  no secret found. The only credential-shaped source hit was the explicit
  `replace_me` database placeholder in `backend/.env.example`.
- Supabase security advisor: two expected informational no-policy notices for
  function-only usage tables; external warnings for leaked-password protection
  and the deferred Postgres upgrade.
- Supabase performance advisor: informational unused-index notices only.

## External production gates

- [ ] Rotate and revoke the disclosed test restricted key, then replace the
  ignored runtime secret.
- [ ] Confirm the restricted-key permission matrix in Stripe Dashboard before
  live deployment. Keep only the Customer, Checkout Session, Customer Portal
  Session/configuration, and Subscription permissions required by the runtime.
- [ ] Disable Supabase password authentication if Orion remains social-login
  only; otherwise enable leaked-password protection.
- [ ] Upgrade the hosted Supabase Postgres version during an approved development
  window before production.
- [ ] Create separate live Product, Prices, Portal configuration, restricted
  key, webhook endpoint, and webhook secret. Never reuse sandbox resources.
- [ ] Complete the manual sandbox lifecycle matrix before creating live billing
  resources.

Repository remediation is complete. These unchecked items require the user's
Stripe/Supabase account controls or future live infrastructure and are not
source-code defects.
