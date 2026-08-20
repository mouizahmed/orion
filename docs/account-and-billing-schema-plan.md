# Individual Account, Usage, and Subscription Schema Plan

**Status:** Runtime implementation complete through Step 23. Step 24 manual lifecycle verification and the final-review remediation record remain active.

## Execution progress

- [x] Step 1: Remove the unused legacy `api_quota_used` and `api_quota_limit` columns from `public.users` in the authoritative development schema and hosted development database.
- [x] Step 2: Add the minimal `public.accounts` effective-plan table and its security boundary.
- [x] Step 3: Provision the account row atomically with a new Orion user.
- [x] Step 4: Move backend plan reads from `public.users.plan` to `public.accounts.effective_plan_key`.
- [x] Step 5: Remove `public.users.plan` and the obsolete `public.user_plan` type.
- [x] Step 6: Add `public.account_plan_changes` and record effective-plan transitions.
- [x] Step 7: Add `public.account_usage_periods`, static meter definitions, and atomic usage consumption.
- [x] Step 8: Add `public.billing_customers` as an inactive Stripe customer-mapping boundary.
- [x] Step 9: Add `public.subscriptions` as an inactive local Stripe subscription projection and history boundary.
- [x] Step 10: Add `public.billing_webhook_events` as an inactive durable Stripe event inbox.
- [x] Step 11: Complete a focused review of the inactive billing schema boundary.
- [x] Step 12: Finalize the initial commercial policy in this document.
- [x] Step 13: Create the Stripe sandbox Product, Prices, and Customer Portal configuration.
- [x] Step 14: Add ignored backend-only Stripe configuration with billing disabled by default.
- [x] Step 15: Add the pinned Stripe Go SDK and typed fail-closed configuration validation.
- [x] Step 16: Implement the Stripe customer-mapping service.
- [x] Step 17: Implement authenticated Checkout Session creation.
- [x] Step 18: Implement verified webhook receipt.
- [x] Step 19: Implement asynchronous, idempotent webhook processing.
- [x] Step 20: Finalize least-privileged runtime database access.
- [x] Step 21: Implement subscription reconciliation.
- [x] Step 22: Add billing status, Checkout, and management UI.
- [x] Step 23: Implement the 7-day trial decided in Step 12.

Stripe sandbox runtime integration is implemented through Step 23 and Step 24 manual verification is in progress against the local test-mode runtime. Steps 24–27 below are the authoritative remaining execution checklist; live billing, production operations, and account deletion remain later phases.

### Step 2 review record

Completed against the canonical development schema and hosted development database:

- `public.accounts` has exactly the seven planned columns.
- `id` is both the primary key and a cascading foreign key to `public.users(id)`.
- Plan keys cannot be blank and plan sources are constrained to the planned values.
- RLS is enabled and forced.
- `PUBLIC`, `anon`, and `authenticated` have no table privileges or policies.
- `orion_backend` has `SELECT`, `INSERT`, and `UPDATE`, but no direct `DELETE`.
- `service_role` retains administrative access and is not used by clients or the Go runtime.
- Every existing active development user was backfilled with one `free`/`default` account.
- Verification found no missing active-user account, orphan account, or non-default backfill value.
- Supabase advisors reported no new account-table finding. Existing project-wide Auth/Postgres warnings and unused-index informational notices remain outside this step's scope.

### Step 3 review record

Completed in the Go backend's authenticated session bootstrap:

- `EnsureUserFromAuth` provisions `public.users` and `public.accounts` in one short database transaction.
- A newly created Orion user receives one `free`/`default` account before the transaction can commit.
- An existing active user missing an account is repaired idempotently and the repair is logged after commit.
- Suspended and deleted users do not receive a repaired account.
- Existing account plan values and timestamps are never updated or reset during login.
- A failed account write rolls back a newly inserted Orion user, and the post-bootstrap welcome email therefore cannot run after a partial provision.
- The full backend builds successfully and passes `go vet`.
- Hosted verification found two active users, two accounts, zero missing active-user accounts, and zero orphan accounts.
- Supabase advisors reported no new finding. Existing project-wide Auth/Postgres warnings and unused-index informational notices remain outside this step's scope.

### Step 4 review record

Completed in the Go backend's user repository without changing the existing API contract:

- Session bootstrap, authentication lifecycle lookup, and current-user/profile lookup now source `plan` from `public.accounts.effective_plan_key`.
- The API and Go user model continue to expose the field as `plan`; clients do not need a transition-specific response shape.
- Active-user reads require an account and reject unknown effective plan keys, so missing or unrecognized account state fails closed.
- Authentication lifecycle lookup retains a left join so suspended or deleted profiles can still return the correct lifecycle denial when no account exists.
- Account provisioning resolves the effective plan only after its transactional account insert or repair has succeeded.
- The shared primary key on `users.id` and `accounts.id` supports the new join; hosted `EXPLAIN` used the `accounts` primary-key index, while the planner reasonably chose a sequential scan for the two-row `users` table.
- Hosted verification found two active users, zero missing accounts, zero unknown plan keys, and zero differences between current account keys and the retained legacy values.
- The full backend builds successfully and passes `go vet`.
- Supabase advisors reported no new finding. Existing project-wide Auth/Postgres warnings and unused-index informational notices remain outside this step's scope.

### Step 5 review record

Completed against the canonical development schema and hosted development database:

- Removed the legacy `public.users.plan` column after confirming every active user's retained value matched `accounts.effective_plan_key`.
- Removed the obsolete `public.user_plan` Postgres enum without `CASCADE`; catalog inspection found no application dependency beyond the removed column and its default.
- The canonical rebuild schema no longer creates the enum or column. It retains a non-cascading `drop type if exists public.user_plan` cleanup so rebuilding an older development database also removes the obsolete type safely.
- The Go `UserPlan` type remains intentionally as the backend's typed effective-plan key validation; it is no longer coupled to a database enum.
- Hosted verification found two users, two accounts, zero missing active-user accounts, zero unknown plan keys, and two successful account-backed free-plan reads.
- The full backend builds successfully and passes `go vet` after the hosted removal.
- Supabase advisors reported no new finding. Existing project-wide Auth/Postgres warnings and unused-index informational notices remain outside this step's scope.

### Step 6 review record

Completed against the canonical development schema, Go provisioning path, and hosted development database:

- Added `public.account_plan_changes` as an append-only effective-plan transition audit trail.
- Added non-blank plan-key checks, a no-op transition check, the planned source allowlist, and the planned account/user foreign-key behavior.
- Indexed account history by `(account_id, changed_at desc, id desc)` and indexed non-null `changed_by_user_id` values for its foreign-key action path.
- Backfilled exactly one initial audit row from each existing account's effective plan, source, and `plan_changed_at`; hosted verification found two accounts, two audit rows, no missing initial rows, and no orphans.
- New account creation and active-user account repair now insert the initial audit row inside the same short transaction as the account. Audit failure therefore rolls back provisioning and prevents post-bootstrap welcome-email work.
- RLS is enabled and forced. `PUBLIC`, `anon`, and `authenticated` have no access. `orion_backend` has only table `INSERT` and sequence `USAGE`, with one insert policy and no select, update, or delete capability.
- `service_role` retains administrative access and is not used by clients or the Go runtime.
- The full backend builds successfully and passes `go vet`.
- Supabase security advisors reported no new finding. The new history and actor indexes are reported as unused informationally because the audit table is new; existing project-wide warnings and unrelated unused-index notices remain outside this step's scope.

### Step 7 review record

Completed against the canonical development schema, Go entitlement/transcription path, and hosted development database:

- Added period counters in `public.account_usage_periods` and one mutable cumulative operation row per transcription stream in `public.account_usage_operations`. Operation rows exist only to deduplicate retries, cascade with their period, and are not an immutable usage-event or billing ledger.
- Added typed backend definitions for `transcription_seconds`. Free includes 12,000 seconds per UTC calendar month; Professional includes the advertised 90,000 seconds. Business temporarily uses the same conservative 90,000-second allowance until Orion defines and markets a distinct Business entitlement.
- Unknown plan keys, unknown meter keys, and unknown period kinds fail closed in the backend. No `plans` or meter-definition table was added.
- Added `orion_internal.consume_account_usage` as the single database statement used by the Go repository. It locks the period and operation, applies only the unconsumed part of a cumulative operation total, rejects increments over the effective limit, and returns stable results for exact retries.
- Wired live transcription to authorize cumulative stereo wall-clock seconds before forwarding each newly entered second to the provider. Repeated calls for the same stream total cannot double-charge, and concurrent streams cannot collectively pass the limit.
- Authentication revalidation also refreshes the stream's effective static limit every minute. A plan change never creates a fresh usage period or resets existing consumption.
- RLS is enabled and forced on both tables. `PUBLIC`, `anon`, `authenticated`, and `orion_backend` have no direct table privileges or policies. The backend has only `USAGE` on the private schema and `EXECUTE` on the hardened security-definer function; `service_role` retains administrative table access.
- Manual hosted verification showed one of two concurrent two-unit consumptions succeed against a limit of two while the other was rejected. A repeated cumulative total returned `replayed=true` without incrementing, a larger cumulative total charged only its delta, and an over-limit total was rejected without changing consumption. The isolated year-2000 verification rows were then deleted, including their cascading operation rows.
- The full backend builds successfully and passes `go vet`.
- Supabase advisors reported no new warning. They report intentional informational notices for the two forced-RLS usage tables having no policies; this is the intended deny-all direct-access boundary. Existing leaked-password/Postgres-version warnings and unrelated unused-index notices remain outside this step's scope.

### Step 8 review record

Completed against the canonical development schema and hosted development database without beginning Stripe integration:

- Added `public.billing_customers` with the planned nine columns, a generated `bigint` identity primary key, and a cascading account foreign key.
- Constrained the provider to Stripe, rejected blank, padded, or excessively long provider customer IDs, and kept provider IDs otherwise opaque.
- Enforced one customer mapping per account/provider/mode and one owner per provider customer/mode. The account-leading unique index also covers foreign-key joins and cascades, so no redundant account index was added.
- Kept test and live mappings distinct through the required `livemode` value. No external Stripe customer or local placeholder row was created.
- Enabled and forced RLS with no policies. `PUBLIC`, `anon`, `authenticated`, and `orion_backend` have no table or identity-sequence privileges; `service_role` retains administrative access.
- Supabase advisors reported only the expected informational no-policy notice for this intentionally inaccessible table. Existing leaked-password/Postgres-version warnings and unrelated unused-index notices remain outside this step's scope.
- Added no Stripe dependency, configuration, price mapping, Checkout flow, subscription state, webhook handling, trial behavior, or external Stripe resource.

### Step 9 review record

Completed against the canonical development schema and hosted development database without beginning Stripe integration:

- Added `public.subscriptions` with the planned 21 columns as a local subscription projection and history table. It is not an authorization source and Stripe remains authoritative for billing facts.
- Added a generated `bigint` identity primary key and a cascading foreign key to `public.billing_customers`. The customer-leading unique and history indexes cover the foreign-key access path.
- Constrained provider subscription, subscription-item, price, and optional invoice identifiers to trimmed, nonblank, bounded values while otherwise treating them as opaque provider IDs. Plan keys receive equivalent validation without adding a database-backed plan catalogue.
- Constrained status to Stripe's eight recognized subscription lifecycle values and required valid ordering for populated current-period and trial timestamps.
- Enforced one provider subscription ID per billing customer, retained historical subscription rows, and added a partial unique index allowing at most one row marked current per billing customer.
- Kept all nullable trial fields as passive provider-projection columns only. No trial eligibility, grant, Checkout, or other trial behavior was implemented.
- Enabled and forced RLS with no policies. `PUBLIC`, `anon`, `authenticated`, and `orion_backend` have no table or identity-sequence privileges; `service_role` retains administrative access.
- Hosted verification found zero subscription rows. No placeholder row or external Stripe resource was created.
- Supabase advisors reported the expected informational no-policy notice and the expected unused history-index notice for this new inactive table. Existing leaked-password/Postgres-version warnings and unrelated unused-index notices remain outside this step's scope.
- Added no Stripe dependency, configuration, price mapping, Checkout flow, webhook handling, or application runtime behavior.

### Step 10 review record

Completed against the canonical development schema and hosted development database without beginning Stripe integration:

- Added `public.billing_webhook_events` with the planned 16 columns as a durable receipt inbox for future verified provider events.
- Added a generated `bigint` identity primary key; a Stripe-only provider constraint; bounded, trimmed, nonblank event identifiers and event types; JSON-object payload validation; the planned processing-state allowlist; nonnegative attempt counts; bounded errors; and basic processing, completion, and purge timestamp ordering.
- Enforced provider-event uniqueness so a duplicate Stripe delivery can later become a harmless conflict, and added the planned partial pending/failed work index.
- Enabled and forced RLS with no policies. `PUBLIC`, `anon`, `authenticated`, and `orion_backend` have no table or identity-sequence privileges; `service_role` retains administrative access.
- Hosted verification found zero webhook-event rows. No placeholder event, webhook endpoint, Stripe dependency, configuration, or external Stripe resource was created.
- Supabase advisors reported the expected informational no-policy and unused-new-index notices. Existing leaked-password/Postgres-version warnings and unrelated unused-index notices remain outside this step's scope.

### Step 11 focused review record

Completed as a deliberately brief catalog review:

- Confirmed the cascading ownership chain `users` -> `accounts` -> `billing_customers` -> `subscriptions` and the independent durable webhook inbox.
- Confirmed the customer test/live uniqueness, subscription history and one-current indexes, provider-event uniqueness, and pending/failed event-work index.
- Confirmed `billing_customers`, `subscriptions`, and `billing_webhook_events` all have forced RLS, no policies, zero rows, and no effective access for `PUBLIC`, `anon`, `authenticated`, or `orion_backend`.
- Confirmed the hosted definitions align with the canonical development schema for this inactive boundary. No broader audit was performed or needed before commercial-policy work.

### Step 12 decision record

Completed as a documentation-only step. No Stripe resource, dependency, configuration, or application code was created.

- Chose the launch lineup, prices, currency, intervals, trial, and grace behavior recorded in the Commercial policy section below.
- Confirmed the decisions against the existing landing page and recorded the four marketing-copy corrections that must ship before Checkout is enabled.
- Left `business` deliberately unmarketed and unreachable from Checkout; it remains an admin-only plan key with no provider price.
- Made no schema change. `accounts`, `billing_customers`, `subscriptions`, and `billing_webhook_events` are unchanged and still hold zero billing rows.

### Step 13 review record

Completed against the Stripe sandbox only. Every created object returned `livemode: false`. No live-mode resource was created, and no Stripe dependency or application code was added.

- Created one Product, `prod_V4ZbnFZ7Zh2e6G`, named `Orion Professional`.
- Created two recurring USD prices on that product, both carrying stable lookup keys so the same identifiers can be recreated in live mode during Step 25.

  | Lookup key | Price ID | Amount | Interval |
  |---|---|---:|---|
  | `professional_monthly` | `price_1U6BV31ObSI0wJbVwCAMFYRt` | 1500 (15.00 USD) | `month` |
  | `professional_annual` | `price_1U6BV41ObSI0wJbVVIJ7dHOA` | 14400 (144.00 USD) | `year` |

- Created the Customer Portal configuration `bpc_1U4QSj1ObSI0wJbVfXiH07bC`, which is the sandbox default configuration.
- The portal enforces the Step 12 policy: cancellation is enabled at `at_period_end` with `proration_behavior` of `none`; price updates are enabled, limited to `default_allowed_updates` of `price`, and restricted to exactly the two prices above.
- The asymmetric plan-change rule was confirmed to be expressible in one configuration. `proration_behavior` is `create_prorations`, so a monthly-to-annual upgrade charges the prorated difference immediately, while `schedule_at_period_end.conditions` of `decreasing_item_amount` and `shortening_interval` defers an annual-to-monthly downgrade to period end with no credit. Stripe accepted both conditions and returned them intact, so no fallback to backend-driven interval switching was required.
- Payment-method update and invoice history are enabled. Customer update and subscription pause remain disabled.
- Verification re-read every object from the API and found exactly one product, exactly two prices, and exactly one portal configuration, with no unintended resource.
- Stripe Tax remains disabled and both prices have `tax_behavior` of `unspecified`, consistent with the Step 12 decision to defer tax to Step 25.
- No trial parameter exists on either price. The 7-day trial is applied per Checkout Session through `subscription_data.trial_period_days` and remains Step 17 and Step 23 work.
- The portal initially returned Stripe's default `trial_update_behavior` of `end_trial`. Step 24 rejected that behavior as surprising for two prices with identical entitlements and changed the sandbox configuration to `continue_trial`. Interval changes now preserve the existing trial; applicable downgrades can still be scheduled for the current period end.
- The sandbox restricted key used for this step should now be revoked. Step 14 provisions the separate backend runtime credential.

### Step 14 review record

Completed without enabling Stripe runtime behavior or storing a credential:

- Added an explicitly ignored `backend/cmd/api/.env.billing` file and loaded it only in the trusted Go backend after the existing backend environment file.
- Kept `STRIPE_BILLING_ENABLED=false`, `STRIPE_API_KEY`, and `STRIPE_WEBHOOK_SECRET` empty. The sandbox price and Customer Portal configuration IDs are non-secret trusted backend configuration and do not appear in Electron or web environment files.
- Added separate Checkout success, Checkout cancellation, and Customer Portal return URLs. Development permits only HTTP loopback URLs; production requires HTTPS.
- Added matching placeholders to the tracked backend environment example without adding or exposing a secret.
- Confirmed the ignored billing file is not tracked by Git.

### Step 15 review record

Completed as a backend-only integration foundation with no customer-facing endpoint:

- Pinned the stable Stripe Go SDK at `github.com/stripe/stripe-go/v86 v86.3.0` and retained the module checksums.
- Added typed test/live mode, offer, plan, price, interval, Portal configuration, webhook-secret, and return-URL configuration.
- Billing-disabled startup requires no Stripe values. Enabling billing fails closed on a missing or malformed API key, signing secret, trusted price, Portal configuration, or return URL.
- Only restricted Stripe keys are accepted. Their `test` or `live` prefix determines the one allowed runtime mode, and provider objects must match that mode. Live mode additionally requires `APP_ENV=production` and HTTPS return URLs.
- Only `professional_monthly` and `professional_annual` resolve to the `professional` plan. Unknown offers and prices fail closed, and no Business price can be resolved.
- The backend constructs Stripe's non-global client only when billing is enabled and logs only the mode, never a credential.
- `go build ./...` and `go vet ./...` completed successfully. No automated tests or customer-facing billing behavior were added.

### Steps 16–17 review record

- Added a backend-only customer service that derives email, name, account ownership, and metadata from the authenticated Orion principal. Stripe idempotency plus the database's account/mode and provider-ID uniqueness constraints enforce one customer mapping per account and mode.
- Added authenticated Checkout Session creation that accepts only the two internal Professional offer keys and resolves trusted Stripe prices server-side. Checkout returns only Stripe's hosted HTTPS URL and never changes access.
- Checkout uses a per-account/mode Redis reservation, Stripe idempotency, a 31-minute hosted-session expiry, local subscription history, and a current Stripe subscription-history check. Concurrent or stale duplicate attempts cannot create a second nonterminal subscription or accidentally receive a second trial.
- Checkout collects a payment method, carries trusted account and offer metadata, is rate-limited, and rejects inactive application users, unknown offers, arbitrary price IDs, incompatible modes, and existing nonterminal subscriptions.

### Steps 18–19 review record

- Added a public webhook route that accepts at most 1 MiB, verifies the unmodified body with the configured Stripe signing secret, rejects mode mismatches, and durably stores the five subscription lifecycle event types Orion processes, including explicit pause and resume events.
- Duplicate provider event IDs return successfully without duplicate work. The request path performs no entitlement transition or outbound Stripe call after durable receipt.
- Added an asynchronous worker with atomic `FOR UPDATE SKIP LOCKED` claiming, stale-claim recovery, ten bounded attempts, exponential retry capped at one hour, short database transactions, and bounded failure records.
- Processing retrieves the complete current Stripe subscription set outside row locks, selects the canonical nonterminal or newest terminal subscription, validates mode/customer/item/quantity/price, repairs customer mappings only when customer and subscription ownership metadata agree, then updates subscription history, the effective account plan, and plan-change audit state atomically.
- Verified event payloads receive a 30-day retention deadline. A scheduled backend purge replaces expired terminal payloads with an empty object while preserving the event identity, status, timestamps, and failure audit record.

### Steps 20–21 review record

- Hosted Supabase and the authoritative schema grant `orion_backend` only `SELECT`/`INSERT` on `billing_customers`, `SELECT`/`INSERT`/`UPDATE` on `subscriptions` and `billing_webhook_events`, plus only the identity-sequence usage required for inserts. No billing table has a normal runtime delete path.
- All billing tables have enabled and forced RLS with backend-role policies for only their granted operations. `PUBLIC`, `anon`, and `authenticated` retain no billing-table or sequence access.
- Added scheduled reconciliation that lists Stripe state only in the billing worker, detects conflicting nonterminal subscriptions, reuses the webhook projection/access logic, repairs missing or stale projections, and removes access when Stripe has no current subscription.
- Authentication, authorization, WebSocket revalidation, transcription quota checks, and normal application reads remain Stripe-free. Expired `plan_valid_until` values fail closed immediately; an expired temporary override may fall back only to a verified, current, mode-matched local subscription projection while reconciliation materializes it.
- Hosted billing tables remained empty during implementation. Supabase security advisors reported no billing-table issue; the remaining policy-less-table notices are the intentional function-only usage tables, with unrelated project-level leaked-password and Postgres-upgrade warnings retained for later project administration.

### Steps 22–23 review record

- Added authenticated billing status and Customer Portal endpoints. The desktop billing settings view renders effective access and projected provider state, opens short-lived Stripe-hosted Checkout/Portal URLs, and polls the backend after a validated `orion://billing/complete` return without trusting browser callback state.
- Added the shared web `/billing/complete` bridge and strict Electron protocol handling. Billing returns reveal the dashboard without opening the overlay and carry only `success`, `cancelled`, or `portal` as refresh hints; they never grant access.
- Replaced placeholder desktop billing cards and corrected public pricing copy to the actual allowances, prices, annual discount, and payment-method-required trial. Go, Electron, and web now consume one typed non-secret product catalog so those values cannot drift independently.
- Trial eligibility is derived from full local subscription history and checked against Stripe history as a repair boundary. Trial dates and Professional access are populated only from verified subscription projection; no account trial flag or synthetic subscription exists.
- The sandbox portal preserves the active trial when a customer changes interval. The configured update is scheduled according to Stripe's portal policy and must still be exercised in both directions before live resources are created.

### Step 24 verification progress

- Local sandbox billing is enabled from the ignored backend billing environment file with a replacement restricted runtime key and a Stripe CLI signing secret. No credential is recorded in this document or a tracked file.
- A real annual Checkout completed with payment-method collection and created one test-mode Stripe customer and one `trialing` subscription. The initial listener command had passed the comma-separated event names incorrectly in PowerShell, so the creation event was missed; the scheduled reconciler recovered the subscription after backend restart and recorded the `free` to `professional` transition with `source = 'reconciliation'`.
- The local listener must subscribe separately to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, and `customer.subscription.resumed`. Scheduling cancellation and then reactivating the trial each produced an authenticated webhook receipt, a processed durable inbox row, and the expected cancellation projection while Professional access and its provider-derived deadline remained intact.
- Replaying an already processed event returned success without adding an inbox row or applying a second mutation. Subscription-event processing now reconciles the complete customer subscription set, so a delayed event for an older terminal subscription cannot replace a newer nonterminal subscription.
- A bounded synthetic event for a nonexistent subscription entered `failed`, incremented its attempt count, retained an error, and scheduled a retry. That clearly named synthetic row was removed immediately after inspection so it could not keep retrying; real processed event rows were retained.
- The webhook endpoint rejects an absent or invalid signature without storing an event. A correctly signed live-mode envelope is also rejected by the test-mode runtime, while a correctly signed event outside the five-event allowlist is acknowledged without being stored. The Checkout callback only signals Electron to refresh authenticated billing status and cannot grant access. A second Checkout attempt against the provider subscription was rejected with conflict even before the missed creation event had been reconciled.
- Hosted inspection confirms one current annual trial subscription, one Professional subscription-backed account with a future validity deadline, forced RLS on every billing table, and no billing-table privileges for `anon` or `authenticated`. Supabase advisors reported no new billing security finding; expected deny-all/no-policy and new-index informational notices remain.
- The desktop Billing panel refreshes verified status whenever Orion regains focus or visibility. Checkout success performs bounded polling because it can race the webhook; Customer Portal and cancellation returns refresh once without displaying a misleading long-running confirmation state. Provider callbacks never mutate access.
- The replacement restricted runtime key successfully creates test-mode Customer Portal Sessions for the mapped customer and configured portal. Visual inspection confirmed that the authenticated desktop **Manage billing** action opens the correct Orion sandbox portal, showing the annual Professional trial, payment method management, invoice history, subscription updates, and end-of-period cancellation.
- Visual portal cancellation exposed Stripe's trial-specific representation: the subscription remained `trialing`, `cancel_at_period_end` stayed false, and Stripe populated a future `cancel_at` plus `canceled_at`. Orion now derives `scheduled_to_end` from either cancellation mechanism, displays **Ends** for that state, and bounds trial or active access by the earlier provider deadline. The raw Stripe flag remains preserved in the projection.
- Post-fix visual inspection confirmed that the returned desktop Billing view remains `Professional · trialing` and labels the provider deadline **Ends Aug 21, 2026** instead of incorrectly presenting it as an ordinary trial conversion date.
- Portal reactivation then produced and processed a fifth real webhook event. Stripe and the hosted projection both cleared `cancel_at`, `canceled_at`, and `cancel_at_period_end`; the account remained Professional and the final desktop view returned to **Trial ends Aug 21, 2026**.
- An annual-to-monthly portal change was confirmed as a downgrade scheduled for the trial/period end rather than an immediate mutation. Stripe retained the current annual `trialing` subscription and attached an active two-phase subscription schedule containing the current annual phase followed by the monthly phase. The portal clearly showed that monthly billing begins August 21 and that access continues until then.
- The sandbox portal was then changed from `trial_update_behavior = end_trial` to `continue_trial`. Billing cadence is not an entitlement change, so interval changes must not consume the remainder of a trial. Orion's blanket trial-ending warning was replaced with copy stating that the trial continues and applicable downgrades may be scheduled for period end; desktop TypeScript and ESLint pass.
- Backend formatting, `go build ./...`, and `go vet ./...` pass after adding identifier-free reconciliation failure diagnostics. Desktop TypeScript and ESLint pass after the billing-refresh change.
- Still pending before Step 24 can be marked complete: canceled Checkout, the reverse monthly-to-annual policy, renewal, payment failure and recovery, immediate cancellation, terminal resubscription without a second trial, and final refresh/build/advisor inspection. These scenarios intentionally remain pending rather than being inferred from static code.

### Steps 16–23 verification record

- `go build ./...` and `go vet ./...` pass for the backend.
- Desktop TypeScript and ESLint pass, and the complete Vite/Electron Builder Windows packaging pipeline completes successfully.
- Web TypeScript, ESLint, and the Next.js production build pass. The obsolete Next 15 `next lint`/`FlatCompat` setup was replaced with Next 16's supported flat configuration and direct ESLint CLI.
- `git diff --check` passes. Tracked-file and generated-bundle scans contain no Stripe or Supabase secret. Runtime billing credentials remain only in ignored backend environment files.
- Hosted inspection confirms forced RLS, the exact runtime grants and policies described above, no client-role privileges, and zero rows in all three billing tables before Step 24.

## Remaining execution roadmap

Execute these steps in order. Complete and review one coherent boundary before starting the next unless a later step explicitly needs to be combined with it.

### Phase A: finish the inactive schema

- [x] **Step 10: Add `public.billing_webhook_events` only.**

  - Add the durable, idempotent provider-event inbox from this document to the canonical development schema and hosted development database.
  - Apply its provider, event-ID, processing-state, retry, timestamp, payload-retention, uniqueness, and pending-work index constraints.
  - Enable and force RLS, revoke all client and runtime access, retain only administrative access, and create no Stripe resource or behavior.
  - Verify the hosted columns, constraints, indexes, grants, RLS, empty state, and Supabase advisors.

- [x] **Step 11: Review the complete inactive billing schema.**

  - Inspect the `accounts` -> `billing_customers` -> `subscriptions` ownership and cascade chain.
  - Verify test/live isolation, partial-current uniqueness, durable event idempotency, and all foreign-key access indexes.
  - Confirm `PUBLIC`, `anon`, `authenticated`, Electron, web clients, and `orion_backend` cannot access inactive billing tables.
  - Confirm the canonical schema and hosted development database match and no billing rows or external Stripe resources exist.

### Phase B: define commercial policy

- [x] **Step 12: Finalize the initial billing and access policy before implementing Stripe runtime code.**

  - Decisions are recorded in the Commercial policy section of this document and are authoritative for Steps 13 through 26.

### Phase C: configure Stripe sandbox

- [x] **Step 13: Create Stripe sandbox Products, Prices, and Customer Portal configuration.**

- Create only the sandbox resources required by the approved commercial policy: one Professional Product with a 15.00 USD monthly price and a 144.00 USD annual price. Create no Free or Business product.
  - Configure the Customer Portal for immediate prorated monthly-to-annual switches, end-of-period annual-to-monthly switches, end-of-period cancellation only, and payment-method and invoice management.
  - Configure product names, branding, support, terms, privacy, and invoice settings. Leave Stripe Tax disabled.
  - Keep sandbox and live resources completely separate; do not create live resources yet.
  - Record non-secret sandbox resource identifiers in the appropriate trusted backend configuration.

- [x] **Step 14: Add ignored backend-only Stripe configuration.**

  - Add the sandbox secret key, later webhook signing secret, application return URLs, and explicit price-ID-to-plan-key mapping to ignored backend environment files or the deployment secret manager.
  - Validate mode consistency so test keys, live keys, customers, prices, and webhook events cannot be mixed.
  - Expose no Stripe secret, webhook secret, trusted price ID, or privileged billing configuration to Electron or web bundles.
  - Permit billing to remain explicitly disabled for ordinary development startup until the integration is ready.

### Phase D: implement backend Stripe integration

- [x] **Step 15: Add the pinned Stripe Go dependency and typed configuration validation.**

  - Pin the SDK version and preserve the lock/module files.
  - Fail closed on unknown plans, prices, modes, or incomplete enabled configuration.
  - Keep Stripe initialization and all secret-bearing clients inside the trusted Go backend.
  - Add no customer-facing endpoint in this step unless required to verify initialization safely.

- [x] **Step 16: Implement the Stripe customer-mapping service.**

  - Create or reuse exactly one Stripe customer per Orion account and Stripe mode.
  - Derive identity and metadata from the authenticated server-side account; never trust client ownership fields.
  - Use Stripe idempotency and database uniqueness to handle retries and concurrent requests safely.
  - Persist `billing_customers` only for a valid Stripe customer and make reconciliation capable of repairing partial external/local failures.
  - Grant the minimum table and sequence operations required for this service, with narrowly scoped forced-RLS policies for `orion_backend`.

- [x] **Step 17: Implement authenticated Checkout Session creation.**

  - Accept an internal plan key, never an arbitrary Stripe price ID, from the client.
  - Resolve the allow-listed price server-side and reject incompatible existing subscription states.
  - Create a server-side subscription-mode Checkout Session for the mapped customer and attach trusted Orion account metadata for reconciliation.
  - Return only the hosted Checkout URL. Success or callback navigation must never grant paid access; only verified billing state may do so.
  - Apply authentication, lifecycle checks, rate limiting, and safe retry behavior.

- [x] **Step 18: Implement verified webhook receipt.**

  - Read a size-limited, unmodified raw request body and verify `Stripe-Signature` before parsing or storing anything.
  - Subscribe only to event types Orion actually processes.
  - Insert verified events into `billing_webhook_events`; duplicate provider event IDs must become harmless successful deliveries.
  - Return `2xx` promptly after durable receipt and perform no complex Stripe or entitlement work in the request transaction.
  - Redact secrets and unnecessary billing payload data from logs and errors.

- [x] **Step 19: Implement asynchronous, idempotent webhook processing.**

  - Claim pending work safely, keep transactions short, and never call Stripe while holding row locks.
  - Fetch the latest Stripe object whenever duplicate, missing, or out-of-order events could make the payload stale.
  - Create or update `billing_customers` and `subscriptions`, resolving provider prices only through trusted backend configuration.
  - Derive effective access from the approved lifecycle policy, then update `accounts` and append `account_plan_changes` in one short transaction.
  - Retry transient failures with bounded backoff, retain actionable redacted errors, mark terminally irrelevant events ignored, and purge payloads according to the retention policy.

- [x] **Step 20: Finalize least-privileged runtime database access.**

  - Grant `orion_backend` only the exact select, insert, and update operations required on billing customer, subscription, and webhook-event state.
  - Grant identity-sequence access only where runtime inserts require it.
  - Add narrowly scoped forced-RLS policies for those operations and retain no normal runtime delete path.
  - Keep `PUBLIC`, `anon`, `authenticated`, Electron, and web clients fully blocked.
  - Reinspect effective privileges and run Supabase security and performance advisors.

- [x] **Step 21: Implement subscription reconciliation.**

  - Add an administrative command or scheduled backend operation that retrieves current Stripe state and repairs missing or stale local projections.
  - Reuse the same projection and effective-access transition logic as webhook processing.
  - Make reconciliation safe to repeat and able to recover after payload purge, webhook loss, partial failure, or out-of-order delivery.
  - Never query Stripe during ordinary authentication, authorization, WebSocket revalidation, or quota checks.

### Phase E: add minimal application billing surfaces

- [x] **Step 22: Add billing status, Checkout, and management UI.**

  - Expose a minimal authenticated backend response for effective plan, projected subscription status, renewal/end date, and cancellation state.
  - Add Upgrade and Manage Billing actions that request short-lived hosted URLs from the backend and open them in the system browser.
  - Use Stripe Checkout for purchase and Stripe Customer Portal for billing details, payment methods, invoices, plan changes, and cancellation where policy permits.
  - After returning to Orion, refresh or poll backend account state and display processing until verified webhook or reconciliation state arrives.
  - Do not expose billing tables, Stripe secrets, or direct plan mutation to the desktop or web applications.

- [x] **Step 23: Implement the 7-day trial decided in Step 12.**

  - Create Checkout Sessions with a 7-day Stripe subscription trial and always-on payment-method collection.
  - Enforce one-trial-per-account eligibility from `subscriptions` history before session creation; never trust a client `trial` flag, and omit the trial for ineligible accounts.
  - Populate `trial_started_at` and `trial_ends_at` from the provider projection and grant access through the same verified projection and account-plan transition path.
  - Do not add trial flags to `accounts`, a separate trial plan key, or fake subscription rows.
  - Treat a failed conversion at trial end as an ordinary `past_due` transition with no trial-specific grace.

### Phase F: verify in Stripe sandbox

- [ ] **Step 24: Complete manual sandbox verification.**

  - Exercise successful and canceled Checkout, duplicate Checkout attempts, renewal, payment failure, scheduled and immediate cancellation, reactivation, upgrade, downgrade, and trials if enabled.
  - Replay duplicate events, deliver relevant events out of order, force processing failures, and verify retry and reconciliation behavior.
  - Confirm callbacks never grant access directly, unknown prices and states fail closed, and test/live objects cannot be mixed.
  - Confirm normal clients cannot read or mutate billing tables.
  - Run Go builds and static analysis, TypeScript checks/builds where changed, direct database inspection, and Supabase advisors without adding automated tests.

### Phase G: prepare production billing

- [ ] **Step 25: Create and configure separate live Stripe resources.**

  - **Prerequisite: Stripe account activation must already be complete.** Live products, the live webhook endpoint, and the live-mode purchase inspection below all require an activated account with verified business details, tax ID, bank account, and identity verification. Nothing in Steps 13 through 24 requires activation, so begin it early and in parallel; it is the only item on this roadmap whose latency Orion does not control.
  - Create live Products and Prices only after sandbox behavior is accepted.
  - Configure the live Customer Portal, public business details, branding, support, terms, privacy, cancellation, tax, and receipt settings required for launch.
  - Register the production HTTPS webhook endpoint for only the required event types.
  - Store the live secret key, webhook signing secret, and live price mapping only in the production secret manager.
  - Perform a low-risk live-mode purchase and cancellation inspection before broad availability.

- [ ] **Step 26: Add production billing safeguards and operations.**

  - Add metrics and alerts for failed or pending webhook work, reconciliation differences, and unusual Checkout or portal-session creation.
  - Add rate limits, bounded retries, payload retention/purge, redacted logging, and support-safe administrative inspection.
  - Document incident response, reconciliation, refunds, subscription overrides, key rotation, webhook-secret rotation, and test/live separation.
  - Run final dependency, secret-exposure, database-privilege, RLS, build, static-analysis, and advisor reviews.

### Phase H: implement account deletion after billing

- [ ] **Step 27: Implement coordinated, retryable account deletion.**

  - Require explicit confirmation and immediately block protected actions through a defined deleting lifecycle state or equivalent fail-closed mechanism.
  - Cancel or schedule cancellation of the active Stripe subscription according to the approved policy.
  - Revoke Supabase sessions, disconnect WebSockets, and clear the encrypted Electron session and caches.
  - Retry cleanup of recordings, attachments, avatars, and other external Orion objects.
  - Handle late billing events without recreating deleted application access or ownership state.
  - Delete the Supabase Auth identity through a server-only Admin API and allow ownership cascades to remove local user, account, usage, customer, subscription, and plan-history projections.
  - Document exactly what Orion deletes, anonymizes, retains, and retries, including billing records Stripe may retain for legal or accounting obligations.
  - Manually inspect deletion across Auth, Postgres, WebSockets, external object storage, Electron state, and Stripe before marking the full plan complete.

## Objective

Design Orion's account, entitlement, quota, and future Stripe subscription model from first principles instead of preserving the columns currently stored on `public.users`.

The initial product has individual accounts only. This design deliberately excludes organizations, workspaces, memberships, seats, a database-backed plans catalogue, and usage-based Stripe billing. It leaves clean boundaries for adding those concepts later if the product genuinely needs them.

## Domain boundaries

```text
auth.users
    │ managed identity and sessions
    ▼
public.users
    │ Orion profile and lifecycle
    ▼ 1:1, shared UUID
public.accounts
    │ effective application access
    ├── public.account_usage_periods
    ├── public.billing_customers
    │       └── public.subscriptions
    └── public.account_plan_changes

public.billing_webhook_events
    durable, idempotent provider-event inbox
```

The boundaries are:

- Supabase Auth owns identity and sessions.
- `public.users` owns the Orion profile and whether the person may use Orion.
- `public.accounts` owns the account's effective application plan.
- Backend configuration defines plans, limits, and features.
- `public.account_usage_periods` owns consumption counters.
- Stripe owns billing facts.
- `public.billing_customers` maps an Orion account to a Stripe customer.
- `public.subscriptions` is Orion's local subscription projection and history.
- `public.billing_webhook_events` provides durable, idempotent webhook processing.
- `public.account_plan_changes` records why effective access changed.

Subscription state must not be queried from Stripe during normal authorization. Verified webhooks and reconciliation translate Stripe state into `accounts.effective_plan_key` and `accounts.plan_valid_until`.

## Key decisions

- `auth.users.id` remains the canonical user UUID.
- `public.users.id` and `public.accounts.id` use that same UUID as shared primary keys.
- Every active Orion user has exactly one account.
- `public.accounts` does not contain usage counters or Stripe IDs.
- Plan definitions remain typed backend configuration; no `plans` table is created.
- Plan keys are stored as `text`. The backend fails closed for an unknown key.
- Usage counters are grouped into explicit periods and meters.
- Stripe customers and subscriptions are stored separately from application access.
- Subscription history is retained locally instead of overwriting one subscription row forever.
- Only one subscription row per billing customer is designated as Orion's current subscription, while terminal rows remain history.
- Webhook processing assumes duplicate and out-of-order delivery.
- Orion does not locally mirror invoices, payment methods, prices, or products for the initial billing system.
- Clients cannot write lifecycle, plan, usage, billing, or webhook data.

## Table specifications

The SQL in this document is the proposed target shape. Exact constraint names may be adjusted during implementation.

### 1. `auth.users`

Managed exclusively by Supabase Auth.

Relevant managed fields include:

- `id`: canonical authenticated user UUID.
- `email`: authentication email.
- provider identities and metadata.
- verified-email state.
- sessions and refresh tokens.

Do not store Orion plan, quota, billing, or authorization decisions in Supabase user metadata. User metadata can be user-editable and must not authorize paid access.

### 2. `public.users`

Orion profile and lifecycle record:

| Column | Type | Null | Purpose |
|---|---|---:|---|
| `id` | `uuid` | No | Shared primary key referencing `auth.users(id)` with `ON DELETE CASCADE`. |
| `email` | `text` | No | Application-facing mirror of the verified identity email. |
| `name` | `text` | No | Canonical Orion display name. |
| `avatar_url` | `text` | Yes | Orion avatar, including an imported or manually uploaded avatar. |
| `status` | `user_status` | No | Application lifecycle: `active`, `suspended`, or `deleted`. |
| `email_verified` | `boolean` | No | Application mirror used where Orion needs verified-email state. |
| `created_at` | `timestamptz` | No | Profile creation time. |
| `updated_at` | `timestamptz` | No | Last profile update time. |
| `deleted_at` | `timestamptz` | Yes | Soft-deletion lifecycle marker while cleanup is pending. |

Remove all commercial and usage fields from this table. In particular, it must not contain `plan`, `api_quota_used`, `api_quota_limit`, Stripe IDs, or subscription status.

Keep `status` here because a suspended or deleting person must be blocked before plan or subscription evaluation.

### 3. `public.accounts`

One individual Orion service account per user:

```sql
create table public.accounts (
  id uuid primary key
    references public.users(id) on delete cascade,

  effective_plan_key text not null default 'free',
  plan_source text not null default 'default'
    check (plan_source in ('default', 'subscription', 'promotion', 'admin')),
  plan_valid_until timestamptz,
  plan_changed_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Column responsibilities:

| Column | Purpose |
|---|---|
| `id` | The account UUID. Sharing the user UUID enforces the current one-user/one-account model without an unnecessary membership table. |
| `effective_plan_key` | Materialized application plan such as `free` or `pro`. Normal authorization reads this rather than calling Stripe. |
| `plan_source` | Explains whether the effective plan came from the default, a subscription, a promotion, or an administrator. |
| `plan_valid_until` | Optional deadline for non-default access. `NULL` means the current plan assignment has no scheduled expiry. |
| `plan_changed_at` | Time the effective plan projection last changed. |
| `created_at`, `updated_at` | Record lifecycle timestamps. |

The account does not duplicate user lifecycle status. Authorization order is:

1. Validate the Supabase session.
2. Require `users.status = 'active'` and `users.deleted_at IS NULL`.
3. Resolve the materialized account plan through the internal plan resolver and backend plan configuration.
4. If `plan_valid_until` expired, fail closed to Free. The only exception is an expired `promotion` or `admin` override with a verified, current, mode-matched local subscription projection that still grants access; reconciliation later materializes that fallback.
5. Evaluate the requested entitlement and usage limit.

`plan_valid_until` is not copied blindly from Stripe. Billing policy determines whether it equals the paid-through time, includes a grace period, or is changed immediately for a terminal billing state.

### 4. Static backend plan definitions

There is no `plans` table. Typed backend configuration defines the available plans and their entitlements:

```text
PlanDefinition
  Key
  Features
  MeterLimits
  MaximumUploadBytes
  MaximumStorageBytes
  RetentionOptions
```

Each consumable limit is keyed by a stable meter name, for example:

- `transcription_seconds`
- `ai_input_tokens`
- `ai_output_tokens`
- `api_requests`

Only `transcription_seconds` is active today. AI input/output tokens and API requests remain reserved examples until Orion has reliable provider usage accounting and a defined charging policy; treating them as active now would create false entitlements. The current static values are:

| Plan key | `transcription_seconds` per UTC month |
|---|---:|
| `free` | 12,000 (200 minutes) |
| `professional` | 90,000 (1,500 minutes) |
| `business` | 90,000 temporarily, pending a distinct Business product definition |

Storage is normally a current gauge, not a period consumption counter, and should be measured from authoritative stored objects or maintained as its own aggregate when performance requires it.

Rules:

- Unknown plan or meter keys fail closed.
- Only the backend resolves a plan into entitlements.
- Stripe price IDs map to plan keys through trusted server configuration.
- Clients may display returned entitlements but cannot supply authoritative values.
- Plan changes require a backend deployment, which is acceptable for the initial product.

### 5. `public.account_usage_periods`

Quota usage belongs in period rows rather than directly on `accounts`:

```sql
create table public.account_usage_periods (
  account_id uuid not null
    references public.accounts(id) on delete cascade,
  meter_key text not null,
  period_started_at timestamptz not null,
  period_ends_at timestamptz not null,
  consumed_quantity bigint not null default 0
    check (consumed_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (account_id, meter_key, period_started_at),
  check (period_ends_at > period_started_at)
);

create index account_usage_periods_active_lookup_idx
  on public.account_usage_periods (account_id, meter_key, period_ends_at desc);
```

Column responsibilities:

| Column | Purpose |
|---|---|
| `account_id` | Account consuming the resource. |
| `meter_key` | Backend-defined consumable resource. |
| `period_started_at`, `period_ends_at` | Explicit UTC usage window. |
| `consumed_quantity` | Monotonic amount consumed within that period. |
| timestamps | Operational inspection and reconciliation. |

The effective limit is read from the static definition for `accounts.effective_plan_key`. Do not copy ordinary plan limits into usage rows.

Usage consumption must be atomic. One database statement must:

1. Find or create the current period.
2. Check `consumed_quantity + requested_quantity <= effective_limit`.
3. Increment the counter only when allowed.
4. Return the new usage value.

The backend must never perform a read-increment-write sequence in application memory.

Free-plan periods should use a clearly documented UTC boundary. Paid-plan periods may align to the subscription item period, but a plan change must not silently reset already consumed usage unless that is an explicit product policy.

Do not add an immutable usage-event ledger yet. Add one later only if Orion introduces usage-based charging, customer-visible line-item audit, or analytics that cannot be served by period counters.

`public.account_usage_operations` is a bounded-lifetime idempotency companion to the period counter, not that future ledger. Its primary key is `(account_id, meter_key, period_started_at, operation_key)`. It stores the latest accepted cumulative quantity for an operation and the corresponding period result. The row is updated as a stream advances and is deleted when its parent usage period is deleted. This permits safe retry of a database call whose result may have been lost without retaining one immutable event per second or audio packet.

The backend role has no direct table privileges. It invokes the private `orion_internal.consume_account_usage` security-definer function, whose fixed search path, fully qualified relations, strict input validation, row locks, and delta update provide the only runtime mutation path. The effective limit remains a trusted typed backend value supplied to the function and is never stored in either usage table.

### 6. `public.billing_customers` (Stripe phase)

Provider-specific customer mapping belongs outside `accounts`:

```sql
create table public.billing_customers (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.accounts(id) on delete cascade,
  provider text not null default 'stripe'
    check (provider = 'stripe'),
  provider_customer_id text not null,
  livemode boolean not null,
  provider_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (account_id, provider, livemode),
  unique (provider, provider_customer_id, livemode)
);

```

The first unique constraint already provides an account-leading index, so a separate `account_id` index would be redundant. This permits one Stripe customer per Orion account in each Stripe mode. Test and live customers cannot be confused. Deletion marks may be retained while external cleanup or late-event handling completes.

Do not store card details, payment methods, tax data, or invoice addresses locally unless a concrete product requirement later demands it. Stripe remains authoritative for those records.

### 7. `public.subscriptions` (Stripe phase)

The initial commercial model permits one current single-item subscription per billing customer while retaining previous subscriptions as history:

```sql
create table public.subscriptions (
  id bigint generated always as identity primary key,
  billing_customer_id bigint not null
    references public.billing_customers(id) on delete cascade,

  provider_subscription_id text not null,
  provider_subscription_item_id text not null,
  provider_price_id text not null,
  provider_latest_invoice_id text,

  plan_key text not null,
  status text not null check (status in (
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  )),
  is_current boolean not null default true,

  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,

  provider_created_at timestamptz not null,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (billing_customer_id, provider_subscription_id),
  check (
    current_period_started_at is null
    or current_period_ends_at is null
    or current_period_ends_at > current_period_started_at
  ),
  check (
    trial_started_at is null
    or trial_ends_at is null
    or trial_ends_at > trial_started_at
  )
);

create index subscriptions_customer_history_idx
  on public.subscriptions (billing_customer_id, provider_created_at desc);

create unique index subscriptions_one_current_per_customer_idx
  on public.subscriptions (billing_customer_id)
  where is_current;
```

This is an Orion access projection, not a complete copy of Stripe's Subscription object.

Important details:

- Stripe's current API associates price and period data with subscription items. Orion initially supports exactly one recurring item and stores that item's ID, price ID, and period.
- `plan_key` is the trusted internal plan resolved from `provider_price_id`; it is never supplied by the client.
- `status` mirrors the recognized Stripe subscription lifecycle states.
- `is_current` chooses the subscription used for current billing presentation. It is separate from `status` so historical rows can be preserved and transient duplicate Checkout attempts can be reconciled deliberately.
- `past_due` access depends on Orion's explicit grace policy.
- `unpaid`, `canceled`, and `incomplete_expired` do not grant paid access.
- `provider_created_at` is the Stripe object's creation time. `last_synced_at` records the last successful Orion reconciliation.
- An out-of-order webhook should retrieve or reconcile the latest provider object instead of blindly applying stale event contents.

Do not add local invoice or payment-method tables initially. Stripe's hosted Checkout and Customer Portal remain the interfaces for those concerns.

### 8. `public.billing_webhook_events` (Stripe phase)

Stripe retries events, may deliver the same event more than once, and does not guarantee event order. Use a durable inbox:

```sql
create table public.billing_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null default 'stripe'
    check (provider = 'stripe'),
  provider_event_id text not null,
  event_type text not null,
  livemode boolean not null,
  provider_created_at timestamptz not null,
  payload jsonb not null,

  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'processed', 'failed', 'ignored')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  next_attempt_at timestamptz,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text
    check (last_error is null or last_error in ('subscription_sync_failed')),
  purge_after timestamptz not null,

  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, provider_event_id)
);

create index billing_webhook_events_pending_idx
  on public.billing_webhook_events (next_attempt_at, received_at)
  where processing_status in ('pending', 'failed');
```

Processing rules:

- Verify the Stripe signature against the unmodified request body before inserting anything.
- Insert by provider event ID; a duplicate delivery becomes a harmless conflict.
- Acknowledge valid receipt quickly and process asynchronously.
- Claim work safely and keep database transactions short; never call Stripe while holding row locks.
- Fetch the latest Stripe object when ordering matters.
- Retry transient failures with a bounded policy.
- Retain payloads only for a defined operational period because they may contain billing-related personal data.
- Persist only an allow-listed failure code in `last_error`; keep provider request URLs, identifiers, payload details, and database errors out of ordinary application logs.
- Reconciliation must be able to repair state even after the webhook payload has been purged.

### 9. `public.account_plan_changes`

Record every effective-plan transition as an append-only audit trail:

```sql
create table public.account_plan_changes (
  id bigint generated always as identity primary key,
  account_id uuid not null
    references public.accounts(id) on delete cascade,
  previous_plan_key text,
  new_plan_key text not null,
  source text not null,
  source_reference text,
  changed_by_user_id uuid
    references public.users(id) on delete set null,
  reason text,
  changed_at timestamptz not null default now(),

  constraint account_plan_changes_previous_plan_key_not_blank
    check (previous_plan_key is null or btrim(previous_plan_key) <> ''),
  constraint account_plan_changes_new_plan_key_not_blank
    check (btrim(new_plan_key) <> ''),
  constraint account_plan_changes_plan_changed
    check (previous_plan_key is distinct from new_plan_key),
  constraint account_plan_changes_source_valid
    check (source in ('default', 'subscription', 'promotion', 'admin', 'reconciliation'))
);

create index account_plan_changes_account_idx
  on public.account_plan_changes (account_id, changed_at desc, id desc);

create index account_plan_changes_changed_by_user_idx
  on public.account_plan_changes (changed_by_user_id)
  where changed_by_user_id is not null;
```

`source_reference` may hold a Stripe event ID, subscription ID, promotion reference, or administrative operation reference. It must not contain secrets.

The runtime backend may insert records as part of the same short transaction that changes `accounts.effective_plan_key`. Normal runtime paths must not update or delete audit rows.

## Tables deliberately not included

### No `plans` table

Plan definitions are static, version-controlled backend configuration. This avoids database/configuration drift and keeps authorization behavior reviewable with the code that enforces it.

### No local invoices or payment methods

Stripe remains the billing ledger and hosts payment-management surfaces. Orion stores only the projection required for access, account display, reconciliation, and support.

### No entitlement rows per account

Normal entitlements are derived from the effective plan. Per-account feature rows create drift and unclear precedence. If exceptional grants become necessary, add a narrowly scoped, expiring, auditable override model later.

### No immutable usage ledger yet

Period counters are sufficient for enforcing included quotas. Add usage events only when usage becomes billable or customers require item-level audit.

### No organizations, memberships, or seats

The shared account/user UUID intentionally enforces the current individual-account product. A future organization model should be designed as a separate product change rather than hidden inside the first billing implementation.

## Account provisioning

The authenticated session bootstrap remains the only account-provisioning path.

When a missing Orion user is genuinely created, one short database transaction must:

1. Insert `public.users`.
2. Insert `public.accounts` with the `free` plan and `default` source.
3. Insert the initial `account_plan_changes` record.

A later login must never reset the plan, usage, subscription mapping, lifecycle status, or timestamps.

During early development, an active user missing its account may be repaired explicitly with a free account. The repair must be observable and must not run for suspended, deleting, or deleted users.

## Commercial policy

Decided in Step 12. This section is authoritative for Steps 13 through 26. Changing any decision here requires updating this section first.

### Launch lineup

| Plan key | Marketed | Self-serve | `transcription_seconds` per UTC month | Provider price |
|---|---|---|---:|---|
| `free` | Yes | Default on signup | 12,000 | None |
| `professional` | Yes | Stripe Checkout | 90,000 | Monthly and annual |
| `business` | No | No | 90,000 placeholder | None |

`business` is deliberately unmarketed and unreachable from Checkout. It has no provider price, so the price-to-plan mapping can never resolve to it. It may only be assigned through `plan_source = 'admin'` or `'promotion'`. A distinct Business entitlement and a Business Stripe product are out of scope for launch.

### Prices and intervals

| Provider price | Plan key | Interval | Amount | Currency |
|---|---|---|---:|---|
| Professional monthly | `professional` | `month` | 15.00 | USD |
| Professional annual | `professional` | `year` | 144.00 | USD |

- Both prices belong to one Stripe Product and both map to the single plan key `professional`. The billing interval is a billing presentation detail, not an entitlement difference.
- USD is the only launch currency. No multi-currency prices, no Stripe Adaptive Pricing.
- Annual is 144.00, which is 12.00 per month and exactly 20 percent below twelve monthly charges.
- Stripe Tax stays disabled at launch. Enabling it, and the resulting tax-inclusive or tax-exclusive decision, is a Step 25 production prerequisite and must not be assumed by sandbox work.

### Entitlement periods are independent of billing intervals

An annual subscriber receives 90,000 `transcription_seconds` per UTC calendar month, not 1,080,000 per year. All plans keep the UTC calendar-month usage period already defined in the Usage-period policy. Billing interval never changes the meter period, the included quantity, or the reset boundary, and unused allowance never rolls over.

This keeps the effective limit a pure function of `accounts.effective_plan_key`, so usage authorization never has to read subscription or billing state.

### Trial policy

- A 7-day trial applies to both Professional prices.
- Checkout collects a payment method. The trial is created as a Stripe subscription trial with `payment_method_collection` set to always, so the subscription converts to `active` automatically at trial end.
- A trialing account receives the full `professional` entitlement. There is no separate trial plan key.
- Eligibility is one trial per Orion account, ever, enforced server-side before creating the Checkout Session. An account is ineligible if any `subscriptions` row belonging to its `billing_customers` row has a non-null `trial_started_at`, including terminal and non-current history rows. A client-supplied trial flag is never trusted, and terminal subscription rows are never deleted to restore eligibility.
- An ineligible account gets a Checkout Session with no trial and is charged immediately.
- `customer.subscription.trial_will_end` may drive a reminder. It never changes access.
- If conversion fails at trial end, the subscription becomes `past_due` and the ordinary grace rule below applies. No trial-specific grace exists.

### Subscription state to effective access

Only the `subscriptions` row with `is_current = true` determines access. History rows never grant access.

| Subscription state | Effective plan | `plan_valid_until` |
|---|---|---|
| `trialing` | `professional` | Earlier of `trial_ends_at` and a populated `cancel_at` |
| `active` | `professional` | `current_period_ends_at` |
| `active` with `cancel_at_period_end = true` or a populated `cancel_at` | `professional` | Earlier of `cancel_at` and `current_period_ends_at`, with the period end used when `cancel_at` is null |
| `past_due` | `professional` during grace only | `current_period_started_at` + 72 hours |
| `incomplete` | `free` | `NULL` |
| `incomplete_expired` | `free` | `NULL` |
| `unpaid` | `free` | `NULL` |
| `paused` | `free` | `NULL` |
| `canceled` | `free` | `NULL` |
| No current subscription | `free` | `NULL` |

Rules that make this safe under duplicate and out-of-order delivery:

- The `past_due` grace deadline is derived only from Stripe state, never from local observation time. Anchoring it to `current_period_started_at` means repeated, duplicated, or replayed events all compute the same deadline and cannot extend the grace. A `past_due` row with a null `current_period_started_at` fails closed to `free`.
- The grace is 72 hours and is never extended, even though Stripe's own invoice retry schedule runs longer. An account whose grace has elapsed is `free` while Stripe continues retrying, and returns to `professional` only when a retry succeeds and the subscription becomes `active` again.
- A `canceled` subscription grants nothing on its own. Paid-through access for a scheduled cancellation is granted earlier, while the row is still `trialing` or `active`, through `plan_valid_until`. Stripe may represent this with `cancel_at_period_end = true` or with an explicit future `cancel_at`; Orion honors the earlier provider deadline. The transition to `canceled` therefore removes access at the already-published deadline rather than extending it.
- Any expired `plan_valid_until` fails closed to `free` at authorization time, as defined in the authorization order. A scheduled reconciliation pass performs the same downgrade durably and records it in `account_plan_changes` with `source = 'reconciliation'`.
- Access is never granted from a Checkout success redirect, session status, client claim, or Supabase user metadata.

### Plan changes and proration

There is exactly one paid plan, so a plan change is either an entry from `free` or an interval switch.

| Change | Mechanism | Timing | Proration |
|---|---|---|---|
| `free` to `professional` | Stripe Checkout | Immediate on verified subscription | Not applicable |
| Monthly to annual | Stripe Customer Portal | Immediate | Stripe default prorated charge for the difference |
| Annual to monthly | Stripe Customer Portal | Scheduled at period end | None; no credit and no refund |
| Interval switch of any kind | Either of the above | See above | Entitlement is unchanged, so no usage effect |

- Orion never creates manual proration invoice items. Proration behavior is configured on the Customer Portal and left to Stripe.
- An interval switch does not reset, replace, or transfer the current usage period. This follows directly from the existing Usage-period policy and is reinforced here because both intervals resolve to the same plan key and the same monthly allowance.

### Cancellation, reactivation, resubscription, and refunds

- Self-serve cancellation is end-of-period only, through the Customer Portal. Paid access is retained until `plan_valid_until` as defined above.
- Immediate cancellation is an administrative action only. It is not exposed to clients and does not issue an automatic refund.
- Reactivation before the period ends is an un-cancel in the Customer Portal. It clears `cancel_at_period_end` on the same subscription, creates no new subscription, and grants no new trial.
- Resubscription after the subscription has reached `canceled` is a new Checkout Session producing a new subscription row. The prior row is retained as history with `is_current = false`. Trial eligibility is still consumed, so the new subscription is charged immediately.
- Refunds are manual Stripe Dashboard operations with no self-serve path. A refund by itself never changes effective access; access changes only when the subscription state changes. Refund events are not in the launch webhook subscription set.

### Required marketing-copy corrections

The website and Electron billing UI consume the same non-secret catalog used by backend entitlements. Stripe reviews the public website during account activation and looks for clearly stated pricing, a cancellation and refund policy, and contact information, so keep the catalog and the actual Stripe live Prices aligned during Step 25.

- The hero states "No credit card required". The launch trial requires a payment method, so this claim is false and must be removed or rewritten.
- The yearly discount badge reads "-20%". The chosen prices are effectively 20 percent off.
- The monthly and yearly toggle is cosmetic and does not change the displayed price. It must show 15.00 monthly and 12.00 monthly billed annually.
- The Pro tier lists features beyond transcription minutes. Only entitlements Orion actually enforces may be advertised as plan-gated at launch.

### Explicitly deferred

Usage-based or overage billing, seats, organizations, coupons and promotion codes, multi-currency, Stripe Tax, sales-led Business, and self-serve refunds are all out of scope for launch and are not permitted to leak into Steps 13 through 26.

## Effective-plan policy

Stripe is authoritative for billing facts; Orion is authoritative for application access. The status-to-access table above is the single implementation of that boundary, and Steps 19 and 21 must both derive access from it rather than reimplementing status handling.

## Trial model

The launch trial parameters are decided in the Commercial policy section: 7 days, payment method required, one per Orion account ever, full `professional` entitlement. This section describes the mechanism that implements them.

Do not add `is_trial`, `trial_used`, `trial_started_at`, or `trial_ends_at` columns to `accounts`. A paid-product trial is part of a subscription lifecycle, not a permanent account characteristic.

The recommended Orion trial is Stripe-backed:

1. The server creates or reuses the account's `billing_customers` row.
2. Stripe creates a subscription with a trial for the intended paid price.
3. `subscriptions.status` is normally `trialing` for a free trial.
4. `subscriptions.trial_started_at` and `subscriptions.trial_ends_at` store the provider period.
5. `subscriptions.plan_key` identifies the paid plan being trialed.
6. `accounts.effective_plan_key` becomes that plan, with `plan_source = 'subscription'` and `plan_valid_until = subscriptions.trial_ends_at`.
7. `account_plan_changes` records the transition into and out of trial access.

The trial should normally receive the target plan's entitlements. Trial state is displayed from the current subscription's status and dates; it should not require a separate `pro_trial` plan unless Orion intentionally offers different trial entitlements.

At trial end:

- Successful conversion changes the subscription to `active` and extends `accounts.plan_valid_until` according to the paid period.
- Cancellation or a configured missing-payment-method outcome removes paid access at the policy-defined time.
- A terminal, unpaid, paused, or otherwise non-entitled outcome returns the account to `free` unless an explicit grace policy applies.
- `customer.subscription.trial_will_end` may trigger a reminder but must not itself change access.

Trial eligibility is enforced server-side. Subscription history provides the durable record needed to prevent repeatedly claiming the same Stripe trial. Do not trust a client-supplied `trial=true` flag or delete terminal subscription rows merely to let Checkout run again.

If Orion grants temporary access without creating a Stripe subscription—for example a support credit, launch promotion, or private beta—represent it as `accounts.plan_source = 'promotion'`, set `plan_valid_until`, and record the grant in `account_plan_changes`. Do not create a fake subscription row. If non-Stripe promotional trials later become a normal self-service feature with abuse-prevention requirements, introduce a dedicated promotion-redemption table at that time.

Stripe's trial APIs and Checkout support are evolving. Choose the then-current stable Stripe trial mechanism during Phase 2 rather than binding this schema to a preview API now. The local columns above work for either a current free-trial subscription or a future stable trial-offer model.

## Usage-period policy

The initial policy is:

- `transcription_seconds` measures stereo wall-clock audio duration, not channel-seconds. Each stream's accepted PCM frames are accumulated and rounded up to a whole second.
- Orion authorizes a newly entered second before forwarding that audio packet to the transcription provider. Malformed audio and audio rejected by quota authorization are not charged. A provider write failure after successful authorization remains charged because the external attempt has begun.
- The stream is closed with the private `4004` WebSocket close code when the included limit is exhausted. Orion does not allow overage in this phase.
- All current plans use calendar-month periods starting at `00:00:00 UTC` on day one and ending at the next UTC month boundary. Stripe-backed periods may align to subscription-item periods when billing is implemented.
- Upgrades and downgrades do not reset or replace the current usage row. The stream refreshes the effective static limit during its one-minute authentication revalidation, and the existing consumed quantity is evaluated against the new limit.
- Unused allowance does not roll over.
- A transcription stream has one opaque operation key per period and submits its cumulative rounded seconds. The database charges only the positive delta from the last accepted total; an exact retry returns the stored result with `replayed=true`.
- AI token and API-request meters are not consumed until their actions, failure semantics, and reliable authoritative quantities are explicitly defined.

The account plan determines the limit; the usage-period row only records consumption.

## Security model

For every new application and billing table:

- Enable and force RLS.
- Explicitly revoke access from `PUBLIC`, `anon`, and `authenticated`.
- Create no client-facing policies while Orion remains backend-only.
- Grant only the required operations to Orion's dedicated backend role.
- Keep the Stripe secret key, webhook secret, Supabase secret/service key, and database credentials out of Electron and web bundles.
- Do not accept lifecycle, plan, price, quota, subscription, or usage fields from profile or account clients.
- Validate every requested Checkout price against the server's trusted price-to-plan mapping.
- Verify webhook signatures using the raw request body.
- Never authorize from Supabase `raw_user_meta_data`.
- Record plan mutations and administrative actions.
- Run Supabase security and performance advisors after implementation.

The 2026 Supabase Data API behavior no longer assumes every new table is automatically exposed, but Orion must still use explicit revocations and forced RLS as defense in depth.

## Stripe processing model

The implemented processing model does the following:

1. Create or reuse the appropriate test/live `billing_customers` row.
2. Create Checkout Sessions server-side using an allow-listed price ID.
3. Attach Orion's account ID as trusted Stripe metadata for reconciliation, without treating returned metadata as the only ownership proof.
4. Verify and durably record webhook events.
5. Process events idempotently and asynchronously.
6. Retrieve current Stripe state when events can be stale or out of order.
7. Update customer/subscription projections and the effective account plan in short transactions.
8. Add an `account_plan_changes` row whenever effective access changes.
9. Reconcile Stripe customers and subscriptions periodically or through an administrative command.
10. Use Stripe's hosted Customer Portal for payment method, invoice, and cancellation management unless Orion later has a concrete reason to own those interfaces.

## Account deletion interaction

Account deletion is implemented after Stripe so its behavior can be complete:

1. Mark the Orion user as deleting or otherwise block protected actions.
2. Cancel or schedule cancellation of the current Stripe subscription according to policy.
3. Revoke Supabase sessions and disconnect WebSockets.
4. Delete external Orion objects such as B2 recordings, attachments, and avatars.
5. Handle or suppress late billing events safely.
6. Delete the Supabase Auth identity through a server-only Admin API.
7. Allow the Auth-to-profile cascade to remove the local profile, account, usage, customer projection, subscription projection, and plan-change rows.
8. Clear the encrypted Electron session and cached state.

Stripe may retain billing records for legal and accounting purposes even after Orion removes its local projections. The final workflow must document exactly what is deleted, anonymized, retained, and retryable.

## Execution phases

### Phase 1: account and usage foundation

- Replace the development schema definitions for `public.users` and `public.accounts`.
- Add `public.account_usage_periods` and `public.account_plan_changes`.
- Add typed static backend plan and meter definitions.
- Provision user, account, and initial plan history atomically.
- Update authorization to resolve effective plans from backend configuration.
- Implement atomic, idempotent usage consumption.
- Preserve forced RLS, explicit revocations, dedicated backend-role access, and ownership cascades.

Because Orion is in early development, this can be a destructive development-schema rebuild without compatibility migrations or dual reads.

### Phase 2: Stripe subscriptions

- Add `billing_customers`, `subscriptions`, and `billing_webhook_events`.
- Add trusted test/live Stripe configuration and price-to-plan mappings.
- Implement Checkout and optionally the hosted Customer Portal.
- Implement verified, idempotent, asynchronous webhooks.
- Define grace, trial, upgrade, downgrade, cancellation, and reactivation policies.
- Implement reconciliation and plan-change auditing.
- Ensure no billing failure or unknown state can accidentally grant paid access.

### Phase 3: account deletion

- Implement explicit confirmation and immediate lifecycle blocking.
- Cancel billing according to the defined subscription policy.
- Revoke sessions and sockets.
- Perform retryable external object cleanup.
- Delete Auth and local projections safely.
- Handle late Stripe events and document retained billing records.

## Verification approach

Do not add automated tests, integration tests, test files, test dependencies, test scripts, or test CI under the current project policy.

Verify through:

- Go builds and static analysis.
- TypeScript checking, linting, and builds where applicable.
- Direct inspection of columns, constraints, indexes, grants, RLS, and cascades.
- Supabase security and performance advisors.
- Manual normal-client attempts to read or mutate protected commercial data.
- Manual concurrent and duplicate usage-consumption attempts.
- Stripe test-mode webhook replay, duplication, and out-of-order delivery exercises during Phase 2.
- Manual subscription reconciliation and access-state inspection.
- Manual account-deletion inspection across Auth, Postgres, external object storage, sessions, and Stripe.

## Definition of done

The full plan is complete when:

- Identity, profile lifecycle, effective account access, usage, and billing facts have distinct owners.
- Every active user has exactly one account.
- Plans and meter limits exist only in typed backend configuration.
- No `plans` table exists.
- Usage is period-based and consumed atomically and idempotently.
- Stripe customer and subscription projections cannot authorize access directly.
- Effective paid access is updated only by verified billing, reconciliation, promotion, or administrative paths.
- Webhook receipts are verified, durable, idempotent, retryable, and safe under out-of-order delivery.
- Normal authenticated clients cannot read or mutate application billing tables directly.
- Account deletion coordinates subscription cancellation and external cleanup.
- Documentation and operational procedures match the implementation.

## References

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Stripe subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
- [Stripe Subscription object](https://docs.stripe.com/api/subscriptions/object)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe webhook delivery and security](https://docs.stripe.com/webhooks)
