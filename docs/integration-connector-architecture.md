# Integration Connector Architecture

**Status:** Proposed architecture  
**Date:** 2026-08-22  
**Scope:** Google Calendar, Gmail, Google Drive, Outlook Calendar, Outlook Mail, OneDrive, Notion, Zapier, and future external connectors

## Executive decision

Orion should use one shared connection framework for all external integrations, but it should not use one shared synchronization implementation or one universal data model.

The reusable part is the connector control plane:

- account or workspace installation identity;
- backend-owned encrypted credentials;
- enabled capabilities and granted scopes;
- connection, consent, and reconnect lifecycle;
- sync jobs, retries, rate limits, and checkpoints;
- webhook subscription lifecycle and verification;
- tenant isolation, auditability, and cache invalidation.

Each capability still needs its own data plane:

- calendars synchronize calendar lists and events;
- email synchronizes mailboxes, folders, threads, messages, and drafts;
- file providers synchronize files, folders, permissions, and content metadata;
- Notion synchronizes workspace content that was explicitly shared with the integration;
- Zapier consumes an Orion API and subscribes to Orion events rather than acting like a normal provider cache.

In short: **share connection infrastructure; separate provider and capability behavior.**

## Target shape

```text
Desktop / Web
      |
      v
Backend connector control plane
      |-- installations and provider identities
      |-- encrypted credentials
      |-- enabled capabilities and scopes
      |-- connection lifecycle
      |-- jobs, checkpoints, and subscriptions
      |
      +--> Calendar adapters --> calendar sources and events
      +--> Email adapters ----> folders, threads, messages, drafts
      +--> File adapters -----> files, folders, permissions, content
      +--> Notion adapter ----> pages, data sources, blocks, comments
      +--> Zapier API --------> triggers, actions, subscriptions
```

The desktop and web applications initiate connections and display state. The backend performs OAuth exchanges, stores and refreshes secrets, calls providers, verifies webhooks, and applies synchronized data. Provider tokens must never be returned to either client.

## What Orion has today

The calendar implementation already provides part of the desired control plane:

- `backend/internal/handlers/integration_oauth.go` starts OAuth using a `provider` and `feature`.
- Only the `calendar` feature is currently accepted for Google and Microsoft.
- Google authorization uses incremental granted scopes.
- The backend exchanges the authorization code and retrieves the provider account identity.
- `backend/internal/repository/integration_connection.go` encrypts provider access and refresh tokens before persistence.
- `integration_connections` is unique by Orion user, provider, and provider account.
- Calendar synchronization stores provider-specific tokens and cached data in `calendar_sources`, `calendar_events`, and `calendar_sync_state`.
- The shared account-scoped resource event channel already invalidates client query caches after changes.

This is a good starting point, but `integration_connections` currently combines four different concerns:

1. provider account or workspace identity;
2. credential material;
3. all granted OAuth scopes as a single string;
4. connection lifecycle.

There is also no persisted record saying which non-calendar capabilities are enabled. The OAuth request carries `feature`, but that feature is not represented independently after the callback.

If Gmail, Drive, Outlook Mail, and OneDrive are added directly to the current shape, feature state would have to be inferred from the scope string and each new subsystem would likely create its own version of synchronization and subscription infrastructure.

## Shared concepts

### Installation

An installation represents one external security boundary connected to one Orion account:

- a Google account;
- a Microsoft account and tenant identity;
- a Notion workspace installation;
- an Orion account authorized for use by Zapier.

An installation is not the same thing as a capability. One Google installation may provide Calendar, Gmail, and Drive. One Microsoft installation may provide Outlook Calendar, Outlook Mail, and OneDrive.

### Credential

Credentials belong to an installation and remain backend-only. The credential layer should support:

- encrypted access and refresh tokens;
- token expiry;
- encryption key versioning;
- safe refresh-token replacement;
- provider revocation state;
- reconnect state without deleting cached user data immediately;
- optional credential versioning if safe key rotation requires it.

Connection status must not be inferred only from the presence of a token. An installation can be active while one capability lacks required consent, or it can require reconnect while previously synchronized data remains available under the product's retention rules.

### Capability

A capability is a user-enabled function backed by an installation. Initial capability names could include:

- `calendar.read`;
- `mail.read`;
- `mail.draft.write`;
- `drive.read`;
- `notion.content.read`;
- `notion.content.write`;
- `automation.triggers`;
- `automation.actions`.

Capabilities should be explicit records, not deductions from a space-separated scope string. Each record should identify:

- whether the capability is enabled;
- the scopes it requires;
- the scopes actually granted;
- whether more consent is required;
- its last successful operation;
- its current health or error state.

Scopes are evidence of authorization, while capabilities represent Orion product intent. They are related but not interchangeable.

### Sync state

Sync state must be stored per capability and, where necessary, per provider resource. Examples include:

- one Gmail mailbox `historyId`;
- one Microsoft Mail delta link per tracked folder;
- one Drive changes page token per account or shared drive;
- one Microsoft drive-item delta link per drive;
- calendar event delta or sync tokens per calendar;
- a backfill checkpoint for one Notion workspace or content root.

Provider cursors are opaque values. Orion should store and replay the complete value returned by the provider rather than parse or manufacture it.

### Webhook subscription

Webhook or push-notification registrations need an independent lifecycle. A subscription record should support:

- installation and capability ownership;
- provider and provider subscription ID;
- watched resource identifier;
- verification or routing secret;
- creation and expiration timestamps;
- renewal state;
- last notification timestamp;
- disabled or failed status;
- best-effort remote cleanup on disconnect.

A webhook is normally a signal to enqueue reconciliation. It should not be treated as the sole source of truth or assumed to contain the complete updated object.

### Jobs and reconciliation

All connector work should use the same operational contract:

- remote API calls occur outside long-lived database transactions;
- received pages or batches are applied in short transactions;
- jobs are idempotent and safe to retry;
- provider and tenant concurrency limits are explicit;
- retryable errors use bounded exponential backoff with jitter;
- permanent authorization errors move the installation or capability to `needs_reconnect`;
- invalid or expired cursors trigger a controlled capability-specific full resync;
- a periodic reconciliation job covers missed webhook delivery;
- successful commits publish account-scoped resource invalidations afterward.

## Provider mapping

| Connector | Shared installation | Incremental state | Notification model | Important difference |
|---|---|---|---|---|
| Google Calendar | Google account | Calendar sync token | Optional Calendar watch channel | Existing Orion implementation |
| Gmail | Google account | Mailbox `historyId` | Gmail `watch` through Google Cloud Pub/Sub | Mailbox and message model, not calendar polling |
| Google Drive | Google account | Changes page token, optionally per shared drive | Expiring Drive notification channels | Hierarchy, permissions, shortcuts, shared drives, and content retention |
| Outlook Calendar | Microsoft account | Graph event delta link | Microsoft Graph change notification | Existing Orion implementation |
| Outlook Mail | Microsoft account | Graph message delta link per mail folder | Microsoft Graph change notification | Folder-scoped delta state and message/draft semantics |
| OneDrive | Microsoft account | Graph drive-item delta link per drive | Microsoft Graph change notification | File hierarchy and permission changes |
| Notion | Notion workspace installation | Backfill/event checkpoints as required | Signed Notion webhook events | Access is limited to content shared with the connection |
| Zapier | Orion account authorized to Zapier | Zapier deduplication identity and Orion subscription state | Orion sends events to Zapier REST-hook URLs | Direction is reversed: Zapier calls Orion triggers and actions |

## Google architecture

Google Calendar, Gmail, and Drive should normally reuse the same Google account installation. The user should enable each capability separately, and Orion should request additional scopes only when that feature is selected.

Google recommends incremental authorization rather than requesting every possible scope during the initial connection. Orion must compare the scopes actually returned with those required by the requested capability and leave unavailable capabilities disabled.

### Gmail

Gmail requires its own adapter and state machine:

1. Perform a bounded initial synchronization of the folders, labels, threads, or messages required by the product.
2. Save the most recent mailbox `historyId`.
3. Run partial synchronization with `history.list` after that history ID.
4. Use Gmail push notifications as a prompt to run partial synchronization.
5. If Gmail reports that the history ID is no longer available, perform a controlled full synchronization.

Gmail push notifications use Google Cloud Pub/Sub. This is operationally different from a provider sending a conventional webhook directly to an Orion endpoint. Watches also require renewal.

Mail read access and draft write access should be separate capabilities. Enabling generated email drafts must not silently grant Orion permission to read an entire mailbox or send messages.

### Google Drive

Drive synchronization should use the Changes API and persist the provider's page token. Push channels tell Orion that changes are available; Orion then consumes the changes feed.

The file model must account for:

- My Drive and shared drives;
- stable provider file IDs;
- folders and parent relationships;
- shortcuts;
- files becoming inaccessible or unshared;
- permission changes;
- trashed and deleted files;
- provider-native documents versus downloadable binary files;
- explicit content indexing and retention policies.

Drive notification channels expire and cannot be renewed in place. Orion must create a replacement before expiration and tolerate an overlap period.

## Microsoft architecture

Outlook Calendar, Outlook Mail, and OneDrive are separate Microsoft Graph capabilities backed by the same Microsoft installation and credential grant.

Microsoft supports incremental delegated consent, so Orion can request mail or file permissions when those features are enabled rather than adding them to the original calendar connection.

### Outlook Mail

Graph message delta tracking is scoped to a mail folder. Orion therefore needs separate state for each tracked folder instead of one cursor for the complete connection.

The adapter must handle:

- `@odata.nextLink` while consuming the current delta round;
- the complete `@odata.deltaLink` for the next round;
- additions, updates, deletions, and moves;
- folder discovery and folder-specific checkpoints;
- mailbox access loss;
- separate read, draft-write, send, and attachment permissions.

### OneDrive

OneDrive uses the Graph `driveItem` delta feed. State should normally be tracked per drive. Orion should use stable item IDs rather than reconstructed paths because renaming a folder does not necessarily cause every descendant to appear in the delta feed.

The OneDrive adapter can share Graph authentication, HTTP behavior, throttling, and change-notification infrastructure with Outlook, but it should not share Outlook's resource repository or cursor rows.

## Notion architecture

Notion differs from user mailbox providers because a public connection is installed into a workspace and receives access only to the pages selected or shared during authorization.

The installation identity should include the Notion workspace and connection/bot identifiers. The adapter must treat permission changes as normal synchronization events: content may disappear because it was unshared even though the workspace installation remains valid.

Notion webhook events are signals and do not necessarily contain the complete updated content. Orion should:

1. verify the webhook signature;
2. deduplicate by provider event ID;
3. enqueue affected entity IDs;
4. retrieve the latest accessible representation through the API;
5. apply the result idempotently;
6. remove or tombstone content that is no longer accessible according to retention policy.

The model should preserve the difference between pages, data sources/databases, blocks, comments, and users rather than flattening every object into an unstructured JSON document.

## Zapier architecture

Zapier is not primarily another source Orion logs into and mirrors. For a native Zapier integration, Orion becomes the service that Zapier authenticates against.

Orion would provide:

- an OAuth authorization and token service, or an intentionally issued API key model;
- an authenticated API for searchable resources and actions;
- stable trigger payloads with unique IDs;
- subscribe and unsubscribe endpoints for REST hooks;
- a registry of Zapier callback URLs associated with Orion accounts and trigger types;
- event delivery with idempotency, retries, rate limiting, and automatic disabling of persistently invalid subscriptions;
- granular action authorization for operations such as creating notes, starting workflows, or requesting summaries.

Zapier should therefore reuse Orion's installation, capability, subscription, audit, and lifecycle concepts, but its request direction and credential ownership are different from Google, Microsoft, and Notion connectors.

## Implemented persistence foundation

The shared foundation below was approved and implemented on 2026-08-27 in the
canonical schema and hosted development project. Calendar remains the first
active capability; provider-specific domain models for mail, files, Notion,
and Zapier remain future work.

### `integration_connections` (installation compatibility model)

Represents the connected external account or workspace.

Implemented responsibilities:

- `id`;
- `user_id` or future account/tenant owner ID;
- `provider`;
- provider account, workspace, or tenant ID;
- provider email and display name;
- installation status;
- provider metadata that is safe and necessary to retain;
- connected, updated, reconnect-required, and disconnected timestamps.

The current uniqueness boundary is `(user_id, provider, provider_account_id)`.
Future workspace providers must populate `provider_account_id` with their stable
installation/workspace identity; email is display metadata, not identity.

### Credential fields (current compatibility model)

The compatibility table currently stores encrypted credential material beside
installation metadata. Repository list methods scan credentials only inside the
backend and response models exclude them. A physically separate credential
table remains a later hardening option, not a prerequisite for another adapter.

Implemented fields:

- connection ID;
- encrypted access token;
- encrypted refresh token;
- encryption key version;
- token expiry;
- credential metadata required for refresh;
- updated timestamp.

Normal list APIs should query installations without selecting credential columns.

### `integration_capabilities`

Represents product intent and consent state.

Implemented fields:

- connection ID;
- capability key;
- enabled state;
- required scopes;
- granted scopes;
- capability health;
- consent-required state;
- last success and last error metadata.

An installation and capability should have one active configuration unless a later product requirement explicitly supports multiple configurations.

### `calendar_sync_state` and `integration_jobs`

Calendar lifecycle state remains split by list/event scope in
`calendar_sync_state`; shared retryable work lives in `integration_jobs`.

Implemented job fields and behavior:

- installation ID;
- capability key;
- provider resource key;
- capability and provider resource keys;
- JSON payload and stable idempotency key;
- pending, running, succeeded, failed, and dead states;
- bounded attempt count, next availability, lease owner, and lease expiry;
- bounded operational error code without raw provider text.

Calendar provider cursors remain on each `calendar_sources` row. Shared jobs are
unique by tenant, job kind, and idempotency key and use tenant-leading partial
indexes for due work.

### `integration_webhook_subscriptions`

Stores provider notification registrations and Zapier callback subscriptions.

Implemented fields:

- installation ID;
- capability key;
- provider subscription ID;
- watched resource ID;
- encrypted or hashed routing/verification secret as appropriate;
- callback destination for outbound integrations such as Zapier;
- status and expiration;
- renewal attempt and last delivery timestamps.

Secrets must not be included in generic connection responses or logs.

### `integration_webhook_receipts`

Provides an idempotent inbound notification ledger keyed by tenant, provider,
capability, and provider event ID. It retains only a SHA-256 payload digest and
bounded status/error metadata; it deliberately does not retain the raw payload.

### `integration_outbox_events` and `integration_delivery_attempts`

Provide transactional outbound event enqueue, leased delivery, retry/dead-letter
state, and immutable attempt history. Domain writers enqueue through the caller's
existing tenant-bound transaction so a business change and its outbound event
commit or roll back together.

### Domain data

Use capability-specific normalized tables for durable product data. Avoid one universal `connector_objects` table containing only provider name and arbitrary JSON.

Raw provider JSON can be retained selectively for debugging or forward compatibility, but it should not be the only representation of fields used for ownership, filtering, ordering, joining, lifecycle decisions, or user-visible behavior.

Every user-data table must carry an enforceable tenant ownership path. Tables exposed through Supabase's Data API require explicit grants where applicable and RLS policies that combine authentication with row ownership; `TO authenticated` alone is not tenant authorization.

Do not reuse a tenant-owner column for the identity of a related person or
provider principal. Child records such as attendees and future file recipients
must keep a non-null owner/tenant column for RLS and ownership foreign keys,
plus a separate nullable matched-user column when the related identity may be
external, unresolved, or owned by another Orion account.

## Security requirements

- Keep all provider tokens in the backend and encrypted at rest.
- Never include tokens, authorization codes, webhook secrets, or full provider payloads in logs.
- Request the least privilege required by each capability.
- Use incremental consent instead of asking for mail, calendar, and file access at once.
- Verify provider webhook signatures or channel secrets and use constant-time comparisons where appropriate.
- Deduplicate notifications and protect against replay.
- Scope every installation, capability, job, cursor, subscription, and domain row to its Orion owner.
- Keep remote revocation best-effort and make local disablement authoritative immediately.
- Apply explicit retention policies for email bodies, attachments, files, and indexed content.
- Separate read, draft-write, send, file-write, and content-write capabilities.
- Do not expose Supabase service-role or secret keys to desktop or web clients.
- Use short database transactions for local state changes; do not hold transactions open during provider API requests.

## Calendar implementation impact

Orion does need to evolve the calendar implementation before using it as the foundation for many additional connectors, but the working calendar functionality does not need to be discarded.

The implemented direction is:

1. Preserve the existing calendar provider adapters, event cache, and calendar-specific sync tokens.
2. Treat `integration_connections` as the compatibility installation and credential record while keeping tokens excluded from every response.
3. Persist `calendar.read` as an explicit capability. **Complete.**
4. Move general job state, webhook receipt/subscription, outbox, and delivery-attempt lifecycle into shared connector services. **Complete at the foundation layer.**
5. Keep calendar sources, events, preferences, and attendee logic in the calendar domain.
6. Add Gmail, Drive, Outlook Mail, OneDrive, or Notion only after the first generic connector seams exist.

This change also addresses a limitation in the current schema: reconnecting the same Google or Microsoft account for another feature updates the same `integration_connections` row, but there is no independent record of which feature was enabled or whether its required scopes are still present.

The detailed calendar findings and fixes remain in [calendar-events-attendee-system-audit.md](./calendar-events-attendee-system-audit.md).

## Migration sequence

### Phase 1: Define the control-plane contract

- Establish provider, installation, capability, credential, sync-state, and subscription interfaces.
- Define stable capability keys and lifecycle states.
- Define redaction, audit, idempotency, and error classification conventions.
- Decide the product's account/tenant ownership model before creating new foreign keys or RLS policies.

### Phase 2: Adapt calendar without changing product behavior

- Backfill each existing integration connection into an installation and credential.
- Create an enabled `calendar.read` capability for every active calendar connection.
- Preserve current connection IDs through a compatibility layer or an explicit mapping.
- Move calendar sync orchestration onto the shared job/checkpoint contract.
- Verify that calendar lists, events, attendee behavior, reconnect, disconnect, and cache invalidation remain unchanged.

### Phase 3: Add provider subscriptions and reconciliation

- Introduce the shared webhook subscription registry.
- Add provider verification, expiration, renewal, and cleanup behavior.
- Keep periodic reconciliation even after notifications are enabled.
- Add metrics for webhook lag, cursor age, retry count, reconnect rate, and full-resync frequency.

### Phase 4: Add one new capability end to end

Choose one narrow capability rather than multiple connectors simultaneously. A reasonable first candidate is `mail.draft.write`, because the existing email-draft settings deliberately leave provider delivery for a later connector phase and it can be implemented without mirroring an entire mailbox.

Validate:

- incremental consent;
- capability enable and disable behavior;
- token refresh after expanded consent;
- multiple external accounts per Orion account;
- authorization loss;
- idempotent retries;
- cross-device invalidation;
- disconnect and data-retention behavior.

### Phase 5: Expand deliberately

Add read-heavy synchronization capabilities only after the control plane and operational telemetry have proven reliable. Prefer a small number of deep, supportable connectors over a broad catalog of shallow integrations.

## Decisions to make before implementation

- Whether connector ownership remains per user or moves to an account/workspace model.
- Whether Google and Microsoft credentials accumulate scopes in one grant or are isolated by capability for stronger separation.
- Which capabilities retain provider content and for how long.
- Whether disconnect deletes cached content immediately, schedules deletion, or leaves user-created derivatives intact.
- Which connector actions require interactive confirmation.
- Whether enterprise installations need administrator consent and organization-wide policy controls.
- Which provider objects become searchable context and which remain transient.
- Whether Zapier is initially private, invite-only, or prepared for marketplace publication.

## Acceptance criteria for the architecture

The connector foundation is ready when:

- one Google or Microsoft installation can safely enable multiple capabilities;
- each capability has explicit consent and health state;
- no client can retrieve provider credentials;
- every cursor and subscription is owned by one installation and capability;
- workers can retry operations without duplicating durable data or user actions;
- expired cursors and subscriptions recover automatically;
- disconnect is immediately authoritative within Orion;
- tenant isolation is enforced in repository queries and applicable RLS policies;
- calendar behavior remains compatible after migration;
- a new provider capability can be added through an adapter without cloning OAuth, credential, job, and subscription infrastructure.

## Official references

- [Google OAuth 2.0 and incremental authorization](https://developers.google.com/identity/protocols/oauth2)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Synchronize clients with Gmail](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Google Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Google Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push)
- [Microsoft incremental consent](https://learn.microsoft.com/en-us/entra/identity-platform/consent-types-developer)
- [Microsoft Graph message delta queries](https://learn.microsoft.com/en-us/graph/delta-query-messages)
- [Microsoft Graph drive-item delta queries](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0)
- [Microsoft Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview)
- [Notion authorization](https://developers.notion.com/guides/get-started/authorization)
- [Notion webhooks](https://developers.notion.com/reference/webhooks)
- [Notion webhook event delivery](https://developers.notion.com/reference/webhooks-events-delivery)
- [Zapier authentication](https://docs.zapier.com/integrations/build/auth)
- [Zapier REST-hook triggers](https://docs.zapier.com/integrations/build/cli-hook-trigger)
- [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Non-goals

This document does not:

- implement provider-specific Gmail, Drive, Outlook Mail, OneDrive, Notion, or Zapier domain adapters;
- define every provider object Orion may eventually store;
- authorize broad mailbox or file-content ingestion;
- replace the implemented PostgreSQL durable job/outbox foundation with a different queue;
- replace the calendar events and attendee audit;
- commit Orion to supporting every connector listed here.

