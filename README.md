# Solar Land Scout

A production-ready v1 web app for **U.S. utility-scale solar land-opportunity discovery**.
It combines a full-screen dark USA map, a deterministic macro-ranking + strict site-filtering engine,
and a Gemini-powered explanation layer.

- **Deterministic engine** computes scores and filters candidate sites. No AI hallucinations.
- **Gemini** is used only to explain what the engine already decided.
- **NREL** provides a lightweight optional solar-resource enrichment layer.
- Pure **USA focus** — the map is locked to U.S. bounds.

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS (custom dark data-viz palette)
- MapLibre GL (MapTiler dark style via API key, with graceful fallback)
- `us-atlas` + `topojson-client` for US state geometry
- `@google/generative-ai` for Gemini (server-side only)

## Project structure

```
app/
  api/
    states/route.ts     # GET macro state rankings
    sites/route.ts      # GET candidate sites (filtered)
    explain/route.ts    # POST Gemini-backed explanations
  page.tsx              # main map experience
  layout.tsx
  globals.css
components/
  AppShell.tsx          # top-level client shell
  MapView.tsx           # MapLibre-powered dark USA map
  Sidebar.tsx           # filters + state list + site list
  StateDetail.tsx       # state drill-down panel
  SiteDetail.tsx        # site drill-down panel
  Legend.tsx
lib/
  scoring-config.ts     # single source of truth for weights + thresholds
  scoring.ts            # deterministic scoring engine
  filters.ts            # strict + user filters
  repository.ts         # DataRepository abstraction (JSON today, DB tomorrow)
  gemini.ts             # server-only Gemini integration with fallback
  nrel.ts               # optional NREL solar-resource enrichment layer
  color-ramp.ts         # shared choropleth colors
  fips.ts               # FIPS → USPS state code mapping
data/
  us_states_macro.json  # seed macro data for all 50 states + DC
  candidate_sites.json  # seed candidate sites (Arizona + NV + NM)
types/
  domain.ts             # shared TS types
```

## Getting started (local)

Requires **Node.js 20+**.

```bash
cp .env.example .env.local
# then fill in your keys — all are optional for the app to boot,
# but Gemini/NREL/MapTiler features degrade gracefully when missing.

npm install
npm run dev
# visit http://localhost:3000
```

### Environment variables

| Variable                   | Purpose                                     | Side   |
| -------------------------- | ------------------------------------------- | ------ |
| `GEMINI_API_KEY`           | Gemini explanations                         | server |
| `NREL_API_KEY`             | NREL solar-resource enrichment              | server |
| `NEXT_PUBLIC_MAPTILER_KEY` | MapTiler dark vector tiles (`dataviz-dark`) | client |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox satellite raster basemap toggle      | client |
| `GOOGLE_SOLAR_API_KEY`     | Google Solar API (Tier 2 enrichment)        | server |
| `DATABASE_URL`             | PostgreSQL connection string for persistent repository | server |

> **PostgreSQL note:** The `pg` npm package is required for DB connectivity; without it, the app silently falls back to JSON seeds.
> It is now declared as a regular `dependencies` entry so `npm install` on a clean clone resolves it automatically.

All new variables are optional — the app boots and serves a deterministic
response even when every optional key is missing. `NEXT_PUBLIC_MAPBOX_TOKEN`
is required only to show the satellite basemap toggle; `GOOGLE_SOLAR_API_KEY`
is required only to enable the per-site Google Solar Insights block.

### Runtime diagnostics — `GET /api/health`

A lightweight, unauthenticated endpoint that reports:

- Which keys are configured (as masked previews only — never the raw values).
- Whether PostgreSQL is reachable (`SELECT 1` latency + schema row counts).
- Reachability of every Tier 1 enricher (USGS Elevation, OSM Overpass, PAD-US,
  FEMA NFHL, NASA POWER, and Google Solar when a key is present). Each probe
  has a 1.5 s timeout and the whole endpoint is capped at ~3 s.

The Sidebar exposes a collapsible **System Status** panel that consumes this
endpoint, refreshes every 60 s, and surfaces a single green/amber/red dot.

### Tier 1 enrichment pipeline

Modular, fault-tolerant enrichers live under `lib/enrichment/`. Each uses a
2.5 s per-call timeout, a deterministic fallback, and an in-memory LRU cache
keyed by rounded `lat,lng`. Results are also persisted to a DB cache table
`site_enrichment_cache(site_id TEXT, source TEXT, payload JSONB, computed_at
TIMESTAMPTZ, PRIMARY KEY (site_id, source))` for 30 days.

| Enricher            | Patches                                       |
| ------------------- | --------------------------------------------- |
| `nasa_power`        | `solar_resource_value` (fallback for NREL)   |
| `usgs_elevation`    | `slope_estimate` (true slope via 4 neighbours) |
| `osm_infra`         | `distance_to_infra_estimate`, `distance_to_infra_km` |
| `usgs_padus`        | `in_protected_area`, `protected_area_name`    |
| `fema_flood`        | `flood_zone`, `in_flood_zone`                 |
| `google_solar` (T2) | `google_solar.{max_array_m2, sunshine_hours_yr, carbon_offset_kg_per_mwh}` |

Wiring:

- `GET /api/sites?enrich=1` runs enrichment against any site whose
  `enrichment_provenance` is empty or older than 30 days (concurrency capped
  at 4 to respect Overpass rate limits).
- `POST /api/enrich/run` iterates all sites in a single batch. Useful as a
  scheduled refresh entry point.

Strict-filter gates were extended: sites with `in_protected_area === true`
or `in_flood_zone === true` are rejected. `computeSiteScore` hard-zeros those
sites and applies a soft penalty once `distance_to_infra_km > 10`.


If `NEXT_PUBLIC_MAPTILER_KEY` is missing, the app falls back to a tile-less dark canvas
with the state polygons as the visual layer. It still works end-to-end.

If `GEMINI_API_KEY` is missing or Gemini times out, the `/api/explain` endpoint returns a
deterministic fallback summary built from the seed data and scoring factors.

## Scripts

```bash
npm run dev        # start Next.js dev server
npm run build      # production build
npm run start      # start the built app (honors $PORT)
npm run lint       # next lint
npm run typecheck  # tsc --noEmit
```

## How the scoring works

### Macro state ranking (`lib/scoring-config.ts`)

Weighted blend of five 0–100 sub-scores:

- Solar potential — **35%**
- Land cost — **25%**
- Electricity price — **15%**
- Open-land availability — **15%**
- Development friendliness — **10%**

`macro_total_score` is always recomputed from the seed factors on load — the JSON cannot
drift away from the engine.

### Site-level scoring (`lib/scoring.ts`)

`overall_site_score` is computed from `solar_resource_value` (GHI), slope, open-land score,
land-cost band, and infra proximity. All constants are centralized in `scoring-config.ts`.

### Strict v1 filters (`lib/filters.ts`)

A candidate site must clear every hard threshold before it is eligible for the map:

- `solar_resource_value >= 5.0`
- `slope_estimate <= 5%`
- `open_land_score >= 60`
- `estimated_land_cost_band ∈ {low, moderate}`
- `distance_to_infra_estimate ∈ {near, moderate}`
- `overall_site_score >= 65`

The sidebar's **Strict only** toggle (ON by default) enforces this at the UI layer so no "maybe"
points ever appear on the map.

## Gemini usage boundaries

- **Server-side only.** The Gemini API key never touches the browser.
- Explanations use strict JSON mode, a tight prompt, a timeout, and a try/catch fallback.
- The model **never** produces coordinates, filter truth, geometry, raw land prices, or pass/fail —
  all of those come from the deterministic engine. Gemini only narrates them.

## Data extensibility

`lib/repository.ts` defines a `DataRepository` interface. V1 ships a `JsonRepository` reading
`data/*.json`. To swap in a real DB later, implement the same interface (e.g. `PrismaRepository`)
and return it from `getRepository()` — no route or UI code needs to change.


## PostgreSQL foundation (Layer 1)

- `lib/repository.ts` now attempts a PostgreSQL-backed repository first and falls back to JSON seeds if DB is unavailable.
- `DATABASE_URL` is used for DB connectivity.
- Schema initialization is automatic on first repository access (`lib/db-schema.ts`).
- If `states_macro` is empty, the existing `data/us_states_macro.json` seed is imported into PostgreSQL.
- Candidate JSON remains available as a fallback/demo source, but DB rows are preferred when present.

## Deploying to Railway

1. Push this repository to GitHub.
2. In Railway, **New Project → Deploy from GitHub repo** and pick this repo.
3. Railway auto-detects a Node.js app. The default build/start commands in `package.json`
   (`npm run build` + `npm run start`) are Railway-compatible. The included `railway.toml` pins them.
4. Set environment variables in **Project → Variables**:
   - `GEMINI_API_KEY`
   - `NREL_API_KEY`
   - `NEXT_PUBLIC_MAPTILER_KEY`
5. Deploy. Railway will build, expose a public URL on its managed `$PORT`, and the app
   will boot with `next start -p $PORT`.

That's it — no Dockerfile required.


### Railway build-context hardening

To prevent Nixpacks/Node deploy failures like `EBUSY ... /app/node_modules/.cache`:

- `.dockerignore` now excludes `node_modules`, `.cache`, `.next`, `dist`, `build`, and other local artifacts.
- `.gitignore` excludes the same local caches/build outputs so they never leak into CI/deploy workflows.
- No Dockerfile is required; Railway + Nixpacks remains the default path.
- `nixpacks.toml` pins npm cache to `~/.npm` (`/root/.npm` in Railway) and avoids caching under `node_modules` during `npm ci`.
- Secrets (`GEMINI_API_KEY`, `NREL_API_KEY`, `DATABASE_URL`) must be set in Railway Variables (not image layers).

## Roadmap (post-v1)

- Swap JSON seeds for live data sources: NREL NSRDB for solar, EIA for electricity prices,
  USGS DEM for true slope, parcel datasets for land cost.
- Candidate-site generator: grid U.S. BLM/state-trust land → apply strict filters server-side.
- Persist explanations in a cache (Redis) keyed by `(kind, id, data_hash)`.
- Add authenticated saved-searches, projects, and export to KML/GeoJSON.
