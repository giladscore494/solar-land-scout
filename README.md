# Solar Land Scout

Solar Land Scout is a premium analytics-style app for **U.S. utility-scale solar opportunity discovery**.
It keeps deterministic scoring and strict filters as the source of truth, then uses Gemini only as an explanation/enrichment layer.

## What changed in v2

- PostgreSQL-backed state + candidate-site storage
- Per-state **Run Analysis** workflow
- Deterministic candidate generation for any U.S. state
- JSON seed fallback when the database is unavailable
- Deeper map zoom, visible state labels, and stronger candidate markers
- English + Hebrew UI support with RTL rendering for Hebrew

## Stack

- Next.js 15 + TypeScript + Tailwind CSS
- MapLibre GL + MapTiler dark style fallback handling
- PostgreSQL via `pg`
- Gemini server-side only (`@google/generative-ai`)
- Optional NREL solar-resource enrichment

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you have:

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Recommended | PostgreSQL connection string. Railway sets this automatically once Postgres is attached. |
| `GEMINI_API_KEY` | Optional | Gemini explanations and stored candidate summaries. Falls back deterministically when missing. |
| `NREL_API_KEY` | Optional | Point-level solar-resource enrichment during analysis runs. |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional | Dark basemap tiles for the map. The app still works without it. |

## Local setup

Requires **Node.js 20+**.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Database initialization

No migration framework is required for v2. On first database-backed request the app will:

1. connect using `DATABASE_URL`
2. create `states_macro`, `analysis_runs`, and `candidate_sites` if they do not exist
3. seed `states_macro` from `data/us_states_macro.json` when the table is empty

If the database is unavailable, the macro ranking and demo seed sites still load from JSON so the app does not break.

## How state analysis works

1. Select a state in the sidebar or on the map
2. Click **Run Analysis / הרץ ניתוח**
3. The server creates an `analysis_runs` record
4. Deterministic code generates candidate points inside the selected state geometry
5. Optional NREL enrichment updates solar-resource values where available
6. Strict filters decide which candidates survive
7. Passing candidates are stored in PostgreSQL under that run
8. Gemini summary text is generated only after structured candidate data exists
9. The latest run results appear in the map and sidebar

Important: this is still a current-stage analytics product, **not** parcel-truth GIS. Coordinates, slope, land-cost band, and infrastructure proximity remain screening signals that still need project-level verification.

## Bilingual UI

- Use the language toggle in the top-left header
- English and Hebrew UI labels are localized from `locales/en.json` and `locales/he.json`
- Hebrew renders RTL in the app shell and panels
- State names in panels and custom map labels support both languages

## API surface

- `GET /api/states` — macro state rankings + DB availability
- `GET /api/sites?state=XX` — latest candidate sites for a state, with JSON fallback when needed
- `GET /api/analysis-runs?state=XX` — latest and recent runs for a state
- `POST /api/analyze-state` — create and persist a fresh state analysis run
- `POST /api/explain` — safe Gemini explanation endpoint with deterministic fallback

## Deterministic boundaries

The code remains the source of truth for:

- macro scoring
- site scoring
- strict filter pass/fail
- generated coordinates
- candidate persistence

Gemini is limited to:

- macro explanations
- candidate explanations
- risk framing / “still to verify” copy
- stored narrative summaries after structured data exists

## Railway deployment

1. Deploy the repo to Railway as a normal Node.js app
2. Attach PostgreSQL in Railway
3. Ensure `DATABASE_URL` is available in Railway variables
4. Add optional `GEMINI_API_KEY`, `NREL_API_KEY`, and `NEXT_PUBLIC_MAPTILER_KEY`
5. Railway can keep the default build/start flow from `package.json`

No Dockerfile is required.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run start
```
