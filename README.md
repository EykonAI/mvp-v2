# eYKON.ai — Geopolitical Intelligence Platform

Real-time situational awareness for a complex world. Live aircraft, vessel, conflict, energy infrastructure, and weather data on an interactive 3D globe, powered by a multi-agent Claude AI system.

## Quick Start

### 1. Prerequisites
- Node.js >= 18
- A Supabase project (free tier works)
- An Anthropic API key

### 2. Install & Configure

```bash
# Clone and install
git clone https://github.com/your-org/eykon-platform.git
cd eykon-platform
npm run install:all

# Configure environment
cp .env.example apps/web/.env.local
# Edit apps/web/.env.local with your API keys
```

### 3. Set Up Database

Run the SQL migration against your Supabase project:
1. Go to your Supabase Dashboard → SQL Editor
2. Paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Click "Run"

### 4. Run Locally

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Railway

### Option A: One-Click (GitHub)
1. Push this repo to GitHub
2. Create a new Railway project
3. Connect your GitHub repo
4. Add environment variables from `.env.example`
5. Railway auto-deploys on push

### Option B: Railway CLI
```bash
railway login
railway init
railway up
```

### Supervisor Agent (separate service)
The Supervisor Agent runs as its own Railway service:
1. In your Railway project, click "New Service"
2. Point to the same repo, set root directory to `services/supervisor`
3. Set start command: `npm install && npm start`
4. Add the same environment variables

## Architecture

```
Layer 0  — Railway Cloud (deployment, CI/CD, service mesh)
Layer 1a — Next.js Cron Routes (data polling, normalisation)
Layer 1b — Claude Supervisor Agent (anomaly detection, sub-agent dispatch)
Layer 1c — Domain Sub-Agents x5 (Air, Maritime, Conflict, Energy, Satellite)
Layer 2a — Supabase + PostGIS (geospatial database)
Layer 2b — Railway Postgres (user profiles, watchlists, agent state)
Layer 3  — Claude Sonnet Conversational (Q&A, briefings, tool use)
Layer 4  — Next.js + Deck.gl (3D globe, dashboard, SSR)
```

## Data Sources

| Source | Domain | Type | API |
|--------|--------|------|-----|
| adsb.lol | Air Traffic | DYNAMIC | Free |
| OpenSky Network | Air Traffic | DYNAMIC | Free |
| AISStream.io | Maritime | DYNAMIC | Free (registered) |
| AIS Hub | Maritime | DYNAMIC | Free (feeder, optional) |
| ACLED | Conflict & Security | DYNAMIC | Free (registered) |
| ENTSO-E | Energy & Utilities | DYNAMIC | Free (registered) |
| Open-Meteo | Weather | DYNAMIC | Free |
| Global Energy Monitor | Infrastructure | STATIC | Free (download) |

## API Keys Required

| Key | Where to Get It | Required? |
|-----|----------------|-----------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | Yes |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project settings | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase project settings | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase project settings | Yes |
| `AISSTREAM_API_KEY` | https://aisstream.io/apikeys | Yes (for vessels) |
| `AISHUB_API_KEY` | https://www.aishub.net/ | Optional (legacy provider) |
| `ACLED_EMAIL` + `ACLED_API_KEY` | https://developer.acleddata.com/ | Optional (paid; GDELT is the default) |
| `ENTSOE_API_KEY` | https://transparency.entsoe.eu/ | Optional |

## License

Proprietary — CONFIDENTIAL
