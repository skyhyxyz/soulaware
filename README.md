# Soulaware POC

Soulaware is a web-first AI life guidance coach (non-clinical) for purpose mapping, reflection, and practical next actions.

## Stack

- Next.js 16 + TypeScript + Tailwind CSS
- OpenAI API (`gpt-4.1-mini` by default)
- Supabase Postgres (with in-memory fallback when env vars are missing)
- Vercel-ready deployment

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

3. Fill values in `.env.local`:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)
- `OPENAI_CHAT_MODEL_PRIMARY` (recommended: `gpt-4.1`)
- `OPENAI_CHAT_MODEL_FAST` (recommended: `gpt-4.1-mini`)
- `OPENAI_SUMMARY_MODEL` (recommended: `gpt-4.1-mini`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL` (optional but recommended for production rate limits)
- `UPSTASH_REDIS_REST_TOKEN` (optional but recommended for production rate limits)
- `SOULAWARE_CHAT_ENGINE` (`v1` or `v2`)
- `SOULAWARE_CHAT_V2_PERCENT` (`0-100`, used when engine is `v2`)
- `SOULAWARE_COST_ALERT_DAILY_USD` (optional soft alert threshold)
- `SOULAWARE_COST_ALERT_WEBHOOK_URL` (optional webhook target for cost alerts)
- `CRON_SECRET` (required to call ops cost endpoint)

4. Run the app:

```bash
npm run dev
```

App routes:

- `/` landing
- `/chat` main Soulaware chat
- `/snapshot/:id` purpose snapshot view
- `/legal` legal/safety page
- `/settings` guest data controls

## Supabase Setup

Apply migration:

- `supabase/migrations/0001_soulaware_poc.sql`
- `supabase/migrations/0002_chat_intelligence_v2.sql`

Tables included:

- `guest_sessions`
- `chat_messages`
- `purpose_snapshots`
- `safety_events`
- `analytics_events`
- `chat_session_state`

## API Endpoints

- `POST /api/chat/message`
- `GET /api/chat/history`
- `POST /api/purpose-snapshot`
- `GET /api/purpose-snapshot/:id`
- `POST /api/data/delete`
- `POST /api/session/clear`
- `POST /api/analytics`
- `GET /api/ops/cost-alert` (cron-protected)

## Safety Behavior

- Rule-based high-risk phrase detection
- OpenAI moderation check (`omni-moderation-latest`)
- If high risk is triggered, Soulaware returns safety-only guidance with US resources:
  - Call/text `988`
  - Call `911` for immediate danger

## Abuse Protection

- Chat endpoint enforces request limits by guest and IP.
- Upstash Redis is used when configured.
- If Upstash env vars are missing, a local in-memory limiter is used as fallback.
- Over-limit requests return `429 Too Many Requests`.

## Chat Intelligence v2

- Feature-flagged orchestration is available via:
  - `SOULAWARE_CHAT_ENGINE=v2`
  - `SOULAWARE_CHAT_V2_PERCENT=10` (progressive rollout)
- v2 adds:
  - hybrid model routing (`primary` vs `fast`)
  - low-information clarifier turns
  - rolling memory summaries and open loops
  - anti-duplication retry and low-quality fallback handling
  - per-turn telemetry (`chat_model_selected`, retry/clarifier/summary/fallback events)

## Notes

- Guest mode is the only auth mode in this POC.
- Chat requires accepting a non-clinical disclaimer before sending the first message.
- Data can be cleared from `/settings` or deleted from `/legal`.
