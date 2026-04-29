# Pricing Model & AI Stack

## AI Stack Migration: OpenAI → Deepgram + Claude + Voyage AI

### Current Stack (OpenAI)

| Feature | Model | Replace with |
|---|---|---|
| Chat responses | GPT-5 Nano | Claude Haiku 4.5 (simple) / Sonnet 4.5 (complex) |
| Note enhancement | GPT-4o Mini | Claude Sonnet 4.5 |
| Live summaries | GPT-4o Mini | Claude Haiku 4.5 |
| Web search tool | Built-in | Claude built-in tool use |
| Embeddings | text-embedding-3 | Voyage AI (voyage-3-large) |
| Transcription | Not implemented | AssemblyAI Universal-Streaming |
| Agent workflows | Not implemented | Claude Agent SDK (Sonnet/Opus) |

### New Stack

| Service | Purpose | SDK |
|---|---|---|
| **AssemblyAI** | Real-time transcription for mic and system audio streams | WebSocket API via backend proxy |
| **Claude (Anthropic)** | Chat, note enhancement, summaries, agent workflows | Claude Agent SDK (TypeScript) |
| **Voyage AI** | Text embeddings for Pinecone semantic search | Voyage AI API (REST) |
| **Pinecone** | Vector storage for memories and chunks | Pinecone SDK (Go) |

### Why not OpenAI?

- Claude Agent SDK enables multi-step agentic workflows (meeting prep, cross-note research, auto-organization) that simple request-response LLM calls can't do
- AssemblyAI Universal-Streaming is lower cost for realtime transcription while preserving separate mic/system streams through two sessions.
- Voyage AI embeddings are higher quality for retrieval tasks (recommended by Anthropic)
- Single vendor for all LLM reasoning (simpler billing, consistent behavior)

### What's removed

- `OPENAI_API_KEY` environment variable
- `openai` Go SDK dependency
- All OpenAI client initialization in `main.go`
- GPT model references in chat and notes handlers

### What's added

- `ANTHROPIC_API_KEY` environment variable
- `DEEPGRAM_API_KEY` environment variable
- `VOYAGE_API_KEY` environment variable
- Claude Agent SDK (TypeScript sidecar service or direct API from Go)
- Deepgram WebSocket connection from desktop app

---

## Cost Per User (Estimated)

| Cost component | Unit cost | Avg user/month | Monthly cost |
|---|---|---|---|
| Deepgram (Nova-2 streaming) | $0.0048/min | 300 min (10 meetings × 30 min) | **$1.44** |
| Claude Haiku 4.5 (chat, quick tasks) | ~$0.004/turn | 50 chat turns | **$0.20** |
| Claude Sonnet 4.5 (enhancement, agents) | ~$0.02/call | 15 agent workflows | **$0.30** |
| Claude Opus 4 (deep analysis, rare) | ~$0.15/call | 2 complex tasks | **$0.30** |
| Voyage AI embeddings | ~$0.00013/1K tokens | ~50K tokens | **$0.01** |
| Pinecone (vector storage) | ~$0.10/user | — | **$0.10** |
| Infra (B2, Postgres, Redis) | — | — | **~$0.50** |
| | | **Total cost/user** | **~$2.50–5.00** |

---

## Pricing Tiers

### Free — $0/mo

- 120 min transcription/month (~4 meetings)
- Basic note enhancement (Haiku)
- 10 chat messages/day
- No agent workflows
- **Cost to serve: ~$0.60–1.00**

### Pro — $14/mo

- 600 min transcription/month (~20 meetings)
- Full AI chat (Sonnet)
- Agent workflows: meeting prep, auto-organization, research across notes
- Unlimited note enhancement
- **Cost to serve: ~$3–5 → ~65% margin**

### Business — $28/mo per seat

- Unlimited transcription
- Priority AI (Opus for complex analysis)
- Advanced agents: auto action items, follow-up email drafts, cross-meeting synthesis
- API access
- **Cost to serve: ~$8–12 → ~60% margin**

---

## Model Routing Strategy

Route requests to the cheapest model that can handle the task:

| Task | Model | Rationale |
|---|---|---|
| Simple chat responses | Haiku 4.5 | Fast, cheap, good enough for basic Q&A |
| Note enhancement | Sonnet 4.5 | Needs structured output quality |
| Live conversation summaries | Haiku 4.5 | Speed matters, summaries are short |
| Meeting post-processing agent | Sonnet 4.5 | Multi-step, needs good reasoning |
| Cross-note research agent | Sonnet 4.5 | Iterative retrieval, synthesis |
| Complex analysis (Business tier) | Opus 4 | Deep reasoning, long documents |
| Meeting prep agent | Sonnet 4.5 | Tool use, context gathering |
| Auto-organization (folder/tag) | Haiku 4.5 | Simple classification task |

---

## Overage Pricing

For users exceeding tier limits:

- Transcription: $0.01/min beyond limit
- Agent workflows: $0.05/workflow beyond limit
- Chat messages: soft throttle (rate limit to 5/hr on Free tier)

---

## Comparable Products

| Product | Free tier | Pro price | Notes |
|---|---|---|---|
| Otter.ai | 300 min/mo | $8.33/mo | Transcription focused |
| Fireflies.ai | Limited | $10/mo | Meeting assistant |
| Fathom | Unlimited recording | $19/mo | AI features gated |
| tl;dv | Basic | $18/mo | Recording + summaries |
| Read.ai | Basic | $19.75/mo | Meeting analytics |
| **Orionly** | 120 min/mo | **$14/mo** | Agentic AI differentiator |

### Competitive advantage

Competitors do transcription + basic summarization. Orionly differentiates with **agentic AI workflows**: multi-step agents that research across your entire note history, auto-generate follow-ups, prepare meeting briefs, and organize notes autonomously. This justifies premium pricing and creates switching costs.
