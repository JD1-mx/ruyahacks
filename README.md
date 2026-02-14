# Ruya Logistics — Self-Improving AI Agent

An AI voice agent for freight forwarding that **improves itself after every failed call**. It analyzes what went wrong, fixes its own prompt and configuration, creates missing tools and n8n workflows, then calls the customer back — better than before.

Built for the Ruya Hackathon 2026.

## The Problem

Freight forwarders juggle phone calls, WhatsApp, and email to coordinate container movements. When an AI agent doesn't understand something (container sizes, booking references, number formats), the call fails and a human has to step in.

## The Solution

An AI agent that **never fails the same way twice**:

1. **Call 1** — Customer calls. Agent has a bare-bones prompt, no tools, bad config. It fumbles.
2. **Self-improvement** — Engine analyzes the transcript, identifies every failure, correlates each to a fix (prompt update, config change, missing tool, missing workflow).
3. **Tool creation** — Creates Vapi tools and n8n workflows it didn't have. Looks at existing workflows in the account for patterns (e.g., finds how WhatsApp was done via Whapi and replicates it).
4. **Callback** — Automatically calls the customer back: *"I apologize for the issues. I've checked with the team and now have the right tools to help you."*
5. **Call 2** — Same scenario. Works.

## Architecture

```
Phone Call (Vapi) ──→ Express Backend ──→ Brain (Claude)
                           │
                    End-of-call webhook
                           │
                  Self-Improvement Engine
                     /        |        \
              Fix prompt   Create tools   Create n8n workflows
              Fix config   (Vapi + local)  (WhatsApp, email, etc.)
                     \        |        /
                   Updated assistant on Vapi
                           │
                    Auto-callback to customer
```

## What the Self-Improvement Engine Can Tune

| Parameter | Fixes |
|-----------|-------|
| `systemMessage` | Bad answers, missing domain knowledge, no number confirmation |
| `maxTokens` | Responses cut off mid-sentence |
| `voiceSpeed` | Numbers spoken too fast, caller says "what?" |
| `firstMessage` | Caller confused about who answered |
| `silenceTimeoutSeconds` | Hangs up while caller looks up container number |
| `messagePlan` | Awkward silence, no idle prompts |
| **New Vapi tools** | Missing capabilities (shipment lookup, WhatsApp send, etc.) |
| **New n8n workflows** | Multi-step automations (WhatsApp via Whapi, email, etc.) |

## Tech Stack

- **Backend**: Express + TypeScript (tsx)
- **Frontend**: Next.js + Tailwind
- **Voice**: Vapi (AI voice orchestration)
- **WhatsApp**: Whapi
- **Workflows**: n8n (programmatic workflow creation via API)
- **Brain**: Claude Sonnet (analysis + tool generation)
- **Hosting**: Railway (backend), Vercel (frontend)

## Project Structure

```
backend/
  server.ts          Express server — webhooks, API endpoints
  self-improve.ts    Core engine — transcript analysis, tool/workflow creation, callback
  brain.ts           Claude-powered decision engine
  vapi.ts            Vapi API client — assistant CRUD, calls, tools
  n8n.ts             n8n API client — workflow creation, activation
  tools.ts           In-memory tool registry + dynamic tool creation
  integrations.ts    Whapi (WhatsApp) + n8n webhook wrappers
  baseline.ts        Baseline config + reset logic
  types.ts           Shared TypeScript interfaces

app/                 Next.js frontend (demo UI)
  page.tsx           Demo page with call trigger, reset, state viewer
  api/demo/          API routes proxying to backend
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in:

```
ANTHROPIC_API_KEY=         # Claude API key
VAPI_API_KEY=              # Vapi API key
VAPI_ASSISTANT_ID=         # Target assistant ID
WHAPI_TOKEN=               # Whapi token (Settings > API Token)
N8N_API_URL=               # e.g. https://your-n8n.app/api/v1
N8N_API_KEY=               # n8n Settings > API > Create API Key
OPERATOR_PHONE=            # Your WhatsApp number (no +)
SERVER_URL=                # Your public URL (Railway/ngrok)
```

### 3. Configure webhooks

**Vapi** (assistant settings):
- Server URL: `{SERVER_URL}/vapi/server-message`

**Whapi** (channel settings):
- Incoming webhook: `{SERVER_URL}/whapi/incoming`

### 4. Run

```bash
# Backend
npx tsx backend/server.ts

# Frontend
npm run dev
```

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/vapi/tool-calls` | Vapi tool call webhook |
| POST | `/vapi/server-message` | End-of-call report → self-improvement |
| POST | `/whapi/incoming` | WhatsApp incoming messages |
| POST | `/improve` | Manual self-improvement (`{callId}` or `{transcript}`) |
| POST | `/calls/create` | Trigger outbound call (`{customerNumber}`) |
| POST | `/reset` | Reset assistant to weak baseline |
| GET | `/calls/:id` | Get call transcript |
| GET | `/health` | Tools + improvement history |
| GET | `/state` | Full before/after comparison |
| GET | `/prompt` | Current assistant prompt |
| GET | `/baseline` | View baseline config |

## Demo Flow

1. `POST /reset` — Reset to weak baseline
2. Call the Vapi number — agent fumbles
3. Watch the terminal — self-improvement pipeline fires
4. `GET /state` — See what changed (prompt, config, new tools, new workflows)
5. Agent auto-calls customer back with improvements
6. `POST /reset` — Ready to demo again

## Team

Built at Ruya Hackathon 2026.
