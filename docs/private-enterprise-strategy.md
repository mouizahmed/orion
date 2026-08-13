# Orion Private Enterprise Strategy

Orion has a stronger opportunity as a privacy-focused meeting intelligence platform than as a direct feature-for-feature Granola competitor.

The key is not to become a generic transcription infrastructure company. Orion should keep its polished meeting experience while positioning itself as:

> Orion is the private meeting-intelligence platform for organizations that need control over where their audio, data, and AI inference run.

## Why This Positioning Has Room

Granola already has a $35/user Enterprise tier with SSO, retention policies, admin controls, and organization-wide privacy settings. Competing on “Granola plus enterprise features” would put Orion directly against an established product. See [Granola’s current pricing](https://www.granola.ai/pricing).

However, Granola currently says all customer data is stored in US-based AWS infrastructure, offers no regional residency, and is not HIPAA or FERPA compliant. That leaves a meaningful opening around sovereignty, regulated workloads, customer-controlled infrastructure, and air-gapped environments. See [Granola’s security and data FAQ](https://docs.granola.ai/help-center/consent-security-privacy/security-privacy-data-faqs).

Self-hosting alone is not enough: products such as [Notely](https://notely.ai/) and open-source [Meetily](https://github.com/Zackriya-Solutions/meetily) already advertise local or self-hosted processing. Orion’s differentiation should be enterprise governance plus a genuinely good desktop experience.

## Product Model

Deployment and inference should be treated as two independent choices.

| Data location | AI processing | Offering |
|---|---|---|
| Orion cloud | Orion models | Easiest managed SaaS |
| Orion cloud | Customer API/model | BYOM/BYOK |
| Customer VPC/on-prem | Customer or Orion-approved models | Private deployment |
| Local device/customer network | Local models only | Offline/air-gapped |

This produces a compelling promise: one application across multiple trust zones.

An organization could establish policies such as:

- Sales calls may use managed transcription.
- Confidential internal meetings must use the company’s model endpoint.
- Legal meetings must remain inside the customer’s infrastructure.
- Raw audio is never retained.
- Transcripts automatically expire after 30 days.
- Public links and external integrations are disabled for sensitive workspaces.

That policy-routing layer is much more defensible than simply adding an Ollama setting.

## Orion’s Current Technical Position

Orion is already undergoing a refactor and redesign. Nothing in the current implementation should be treated as a permanent product or architectural constraint. The existing code is most useful as a prototype that identifies working UX, audio-capture behavior, and product concepts worth preserving.

The current integrations illustrate which capabilities the new architecture must make replaceable:

- Transcription is hardwired to AssemblyAI in `backend/internal/handlers/transcription.go`.
- LLM requests are hardwired to OpenRouter in `backend/internal/ai/client.go`.
- Embeddings use OpenAI directly in `backend/internal/memory/embedder.go`.
- Retrieval is tied to Pinecone in `backend/internal/retrieval/pinecone.go`.
- WebSocket authentication requires a backend-validated managed Supabase session.
- Transcripts are uploaded to the backend every ten seconds by `desktop/src/hooks/useTranscription.ts`.
- The current data model only understands individual Free and Pro users, not organizations or tenants.
- Existing application encryption protects integration tokens, not transcript content.

The goal should not be to retrofit self-hosting around these choices. The redesign should begin from the desired deployment matrix and trust boundaries, then reuse existing code only where it fits that target cleanly.

## Recommended Implementation Order

1. Write a short target-architecture specification covering the supported deployment modes, trust boundaries, data flows, retention behavior, and which services are permitted to communicate externally in each mode.

2. Define stable internal contracts for transcription, chat/completions, embeddings, vector storage, object storage, identity, secrets, audit events, and telemetry. Provider-specific types should stop at the adapter boundary.

3. Build a modular default data plane using PostgreSQL plus pgvector and S3-compatible object storage. This should run identically in Orion Cloud and in a customer-controlled deployment, with managed services remaining optional adapters.

4. Ship BYOM as the first inference option. Support configurable OpenAI-compatible URLs and credentials. That immediately covers Ollama, vLLM, and many enterprise inference gateways. [vLLM exposes an OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).

5. Support one managed transcription provider and one private transcription path behind the same contract. A configurable Deepgram-compatible endpoint is pragmatic because Deepgram officially supports self-hosted deployments, though licensing would need consideration. See [Deepgram’s self-hosted deployment documentation](https://developers.deepgram.com/docs/deploy-stt-services).

6. Make organizations, roles, OIDC identity, retention policies, audit logs, model-routing policies, and admin-controlled sharing part of the foundational domain model rather than later enterprise add-ons.

7. Produce one supported private deployment artifact: initially Docker Compose for evaluation, then Helm for production. Avoid supporting arbitrary installations immediately.

8. Add fully on-device transcription later. Packaging models, GPU acceleration, updates, crash recovery, and hardware compatibility make this a separate project—not merely another provider adapter.

## Commercial Packaging

Potential packaging:

- **Orion Cloud:** approximately $15–25/user/month.
- **Orion Business:** approximately $30–50/user/month with governance and BYOM.
- **Orion Private:** annual platform contract, perhaps starting around $15k–30k.
- **Air-gapped/regulated:** custom annual contract with support and deployment certification.

Self-hosting should not be the cheap plan. It creates the greatest support burden and delivers the greatest enterprise value.

The initial customer profile should probably be 20–200-person consultancies, security-conscious software companies, research teams, and professional-services firms. They understand private infrastructure but can purchase faster than hospitals, governments, or major banks. Pursuing HIPAA, defense, or banking immediately would drag Orion into long certification and procurement cycles.

## Recommendation

Pivot from “Granola competitor” to “private meeting intelligence with customer-controlled deployment and inference,” while keeping the desktop product as the wedge.

Build BYOM plus a single-server private deployment first, validate it with three paid design partners, and only then invest in true air-gapped or on-device support.
