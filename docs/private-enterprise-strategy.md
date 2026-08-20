# Orion Product and Infrastructure Strategy

**Status:** Current product direction
**Stage:** Early development; every product and architectural decision remains open to change

## Product Thesis

Orion should initially be a private meeting-intelligence layer that people connect to the tools and AI agents they already use. It should not require a team to adopt Orion as its new collaborative workspace before it becomes useful.

> Orion privately captures, structures, and stores meeting knowledge, then makes that knowledge available wherever the user chooses to work.

The initial product is therefore integration-first rather than destination-first:

- Orion captures and transcribes meetings.
- Orion turns transcripts into reliable, structured meeting data.
- Users can review and correct that data in a lightweight desktop dashboard.
- A built-in AI chat provides an immediate first-party way to use the data.
- MCP lets users work with their meeting knowledge through an AI agent of their choice.
- APIs, webhooks, exports, and focused integrations send results into existing workflows.
- Secure view-only sharing lets another person consume a result without adopting Orion as their workspace.

This still supports the longer-term privacy and enterprise opportunity. The key difference is sequencing: Orion should first prove the value of a personal, interoperable meeting-data layer. Organizations, team workspaces, and enterprise governance can follow actual demand rather than becoming initial complexity.

## What Orion Is — and Is Not

### Orion is

- A trusted source of meeting transcripts, notes, decisions, and action items.
- A privacy-conscious capture and transcription client.
- A permission-aware retrieval and action layer.
- A first-party AI experience for meeting knowledge.
- Infrastructure that can serve MCP clients, integrations, and future applications.
- A product that can eventually run in Orion Cloud, customer infrastructure, or locally.

### Orion is not initially

- A replacement for Slack, Teams, Notion, a CRM, or a project-management system.
- A general-purpose ChatGPT clone.
- A Google Docs-style collaborative editor.
- An enterprise workspace or organization-management platform.
- A broad integration marketplace with many shallow connectors.

## Initial Product Surfaces

All product surfaces should use the same backend permission, retrieval, citation, and action layer.

```text
Desktop dashboard/chat ─┐
MCP server ─────────────┼── Permissions + retrieval + actions ── Meeting data
API and webhooks ───────┤
Focused integrations ──┘
```

This avoids implementing different security or AI behavior for each interface.

### Desktop dashboard

The dashboard remains necessary, but it should be a focused control plane rather than the place where an entire team must work. It should provide:

- Meeting capture and recording state.
- Meetings, transcripts, notes, folders, and search.
- Transcript and generated-output review and correction.
- Built-in AI chat.
- Integration and MCP configuration.
- Sharing and access controls.
- Model, privacy, storage, retention, and export settings.
- Account, usage, and billing management.

### Built-in AI chat

AI chat remains a core feature even though Orion is integration-first. It gives every user a useful experience without requiring an MCP client, demonstrates the value of Orion's data layer, and provides a reference implementation for external agents.

Its initial scope should be meeting-specific:

- Ask questions about one meeting or a selected collection of meetings.
- Search and synthesize across the user's authorized meeting data.
- Extract decisions, action items, follow-ups, and attributable statements.
- Rewrite or update notes only after clear user confirmation.
- Cite the meetings and transcript passages supporting an answer.
- Apply exactly the same permissions as MCP and API access.

It should not initially include a general agent builder, a plugin marketplace, unrelated general-purpose conversations, or silent autonomous modification of user data.

### MCP, API, and integrations

MCP is a primary product surface, not an accessory. It should let authorized agents search meeting data, retrieve notes and transcripts, and perform narrowly defined actions with explicit permissions.

The API and webhook layer should expose the same primitives so Orion can integrate with existing systems. Early integrations should be chosen for depth and real demand. Likely categories include:

- Knowledge tools such as Notion or Confluence.
- Communication tools such as Slack or Microsoft Teams.
- CRMs for customer calls.
- Project-management tools for decisions and action items.
- Generic webhooks and structured exports for everything else.

Orion should prefer a few reliable integrations over a large catalogue of fragile connectors.

## Sharing and Collaboration Scope

People will want to share notes and transcripts, but sharing does not require Orion to become a collaborative editor.

### Initial sharing

- Private by default.
- Explicit view-only access by email and/or secure link.
- Owner-controlled revocation.
- Optional link expiry.
- Explicit control over whether a share includes notes, transcript, recording, or attachments.
- Export controls and basic access history where appropriate.
- The transcript remains an immutable source record.

Recipients should be able to consume the result without being forced into a new collaborative workspace. Where possible, ongoing conversation and editing should occur in the destination tool users already share.

### Deferred collaboration

The following are deliberately deferred until observed usage demonstrates that users spend substantial time collaborating inside Orion:

- Multiple people editing simultaneously.
- Editor roles.
- Live cursors and presence.
- Comments, mentions, and collaboration notifications.
- Conflict-free replicated data types (CRDTs) or equivalent real-time editing infrastructure.
- Team workspaces, organization membership, and workspace-wide sharing.

If shared editing is later introduced, begin with an explicit editor permission, revision history, audit events, and optimistic concurrency. CRDTs should be considered only after simultaneous multi-user editing or offline multi-writer behavior becomes a demonstrated requirement.

## Privacy and Deployment Direction

The longer-term differentiator remains user control over data location and inference. Deployment and AI processing should be independent choices.

| Data location | AI processing | Potential offering |
|---|---|---|
| Orion Cloud | Orion-managed models | Easiest managed service |
| Orion Cloud | User-provided model or API key | BYOM/BYOK |
| Customer infrastructure | Customer or approved models | Private deployment |
| Local device or network | Local models | Offline/private mode |

Orion should ultimately support policies such as:

- Raw audio is never retained.
- Transcripts expire after a configured period.
- A particular meeting uses only a local or customer-controlled model.
- External integrations are disabled for sensitive data.
- An MCP client receives read-only access to an explicitly selected scope.

Self-hosting alone is not the differentiator. The product must combine deployability with a polished capture experience, consistent security boundaries, reliable integrations, and permission-aware AI access.

## Initial Account and Commercial Scope

Start with individual accounts. Do not make organizations, workspaces, membership roles, enterprise SSO, or seat-based billing foundational to the first release.

Near-term billing can use individual Stripe subscriptions and static backend plan definitions, as described in `docs/account-and-billing-schema-plan.md`. Organization billing and enterprise contracts can be designed later without forcing those abstractions into the initial product.

Potential longer-term offerings remain:

- Managed Orion Cloud.
- Managed service with user-provided models or credentials.
- Supported private deployment.
- Higher-assurance offline or regulated deployment.

## Technical Priorities

1. Make capture and transcription dependable.
2. Define stable provider-independent contracts for transcription, language models, embeddings, retrieval, object storage, identity, and secrets.
3. Build one permission and application-user lifecycle model shared by the dashboard, MCP, APIs, integrations, and WebSockets.
4. Produce reliable structured meeting outputs with traceability to source transcript segments.
5. Build the focused first-party chat on the shared retrieval and action layer.
6. Build a secure, scoped MCP server.
7. Add generic webhooks and structured export primitives.
8. Add a small number of high-value integrations.
9. Support configurable OpenAI-compatible inference endpoints for BYOM and local-model compatibility.
10. Establish a repeatable self-hosted deployment only after the managed product's core service boundaries are stable.

On-device transcription and fully air-gapped operation are separate later investments because model packaging, hardware acceleration, updates, and compatibility create significant product and support work.

## Explicitly Deferred

- Organization and workspace models.
- Enterprise governance and administrator consoles.
- Real-time collaborative note editing.
- Social or communication features already provided by destination tools.
- A large integration marketplace.
- A general-purpose AI assistant.
- Arbitrary self-hosted deployment permutations.
- Full on-device and air-gapped support.

Deferred does not mean rejected. These should be triggered by real user behavior, paid customer requirements, or a clear change in product strategy.

## Product and Engineering Success Signals

The strategy should be validated using evidence rather than feature count:

- Active users and retained users.
- Meetings and transcription hours processed.
- Capture, transcription, and integration reliability.
- Time from meeting completion to usable output.
- Frequency and success of dashboard-chat and MCP queries.
- Number of useful external actions produced by integrations or agents.
- Share-link use and revocation behavior.
- User trust signals, including retention choices and local/BYOM adoption.
- Paid conversion and reasons for churn.

## Portfolio and Product Value

Simplifying the visible feature set does not reduce Orion's technical ambition. The strongest engineering work moves into coherent infrastructure:

- Electron security and encrypted session ownership.
- Permission-aware Go services and PostgreSQL data access.
- Audio capture and transcription pipelines.
- Provider abstraction and local/BYOM routing.
- Secure MCP, API, webhook, and integration boundaries.
- Source-grounded AI retrieval and actions.
- Hosted and self-hosted deployment design.
- Observability, reliability, billing, and real-user operations.

The product should be evaluated by whether these systems form a focused, secure product used by real people—not by whether Orion reproduces every feature of a mature collaboration suite.

## Current Recommendation

Build Orion as an integration-first, privacy-focused meeting intelligence layer with a lightweight but polished first-party dashboard and AI chat.

Prioritize capture, structured data, permission-aware retrieval, MCP, webhooks, and a few deep integrations. Keep sharing secure and view-only initially. Add collaboration or enterprise workspace features only when actual usage proves that Orion itself needs to become a shared destination.
