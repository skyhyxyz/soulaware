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
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL` (optional but recommended for production rate limits)
- `UPSTASH_REDIS_REST_TOKEN` (optional but recommended for production rate limits)

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

Tables included:

- `guest_sessions`
- `chat_messages`
- `purpose_snapshots`
- `safety_events`
- `analytics_events`

## API Endpoints

- `POST /api/chat/message`
- `GET /api/chat/history`
- `POST /api/purpose-snapshot`
- `GET /api/purpose-snapshot/:id`
- `POST /api/data/delete`
- `POST /api/session/clear`
- `POST /api/analytics`

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

## Notes

- Guest mode is the only auth mode in this POC.
- Chat requires accepting a non-clinical disclaimer before sending the first message.
- Data can be cleared from `/settings` or deleted from `/legal`.
