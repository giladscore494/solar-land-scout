# Parcel Engine — Architecture & Data Flow

## Overview

The parcel engine is an alternative scan backend that replaces the default 25 km² grid-cell approach with a PostGIS-powered parcel-level search. It queries actual cadastral land records enriched with spatial overlays (transmission lines, substations, protected areas, flood zones) to find the best candidate parcels for utility-scale solar development.

```
POST /api/analyze-state  (engine: "parcel")
         │
         ▼
  runParcelScan()          ← lib/agent/parcel-scanner.ts
         │
    ┌────┴─────┐
    │          │
    ▼          ▼
findHotZones()   (25 km grid × NASA POWER GHI)
         │
         ▼
  PostGIS query: parcels
  within each hot zone bbox
         │
         ▼
  Spatial joins (per parcel):
  • ST_Distance → nearest transmission line
  • ST_Distance → nearest substation
  • ST_Intersects → protected area
  • ST_Intersects → flood zone
         │
         ▼
  scoreParcel()            ← lib/agent/parcel-scorer.ts
  • Strict filters first (hard pass/fail)
  • 0–100 weighted score
         │
    passed?
   YES ──► emit parcel_passed event
   NO  ──► emit parcel_rejected event
         │
         ▼
  scan_completed SSE event
```

## Spatial Database Schema

Managed by `db/migrations/001_create_parcel_scan_tables.sql`. Core parcel-scan tables:

| Table | Contents |
|---|---|
| `parcels` | Cadastral land records with geometry + apn + acres |
| `transmission_lines` | HIFLD electric transmission ≥ 69 kV |
| `substations` | HIFLD electric substations |
| `protected_areas` | PAD-US 4.0 protected lands |
| `flood_zones` | FEMA NFHL flood risk zones |
| `wetlands` | NWI wetlands |
| `roads` | OSM / Tiger road network |
| `parcel_scores` | Scored parcel results (cached) |

All geometry columns use `SRID 4326` (WGS-84). Spatial indexes are GiST.

## Scoring Logic (`lib/agent/parcel-scorer.ts`)

### Strict Filters (hard exclusions)
Any one of these immediately rejects a parcel:
- Contiguous acres < 50
- Slope > 5%
- Inside a protected area
- Inside a FEMA flood zone
- Nearest transmission line > 20 km
- Annual GHI < 5.0 kWh/m²/day

### Weighted Score (0–100, only if filters pass)

| Signal | Weight | Notes |
|---|---|---|
| GHI (solar irradiance) | 30 | Max at 6.5 kWh/m²/day |
| Transmission proximity | 25 | Max at ≤ 1 km |
| Substation proximity | 20 | Max at ≤ 5 km |
| Parcel size | 15 | Max at 500+ acres |
| Land cost band | 10 | low=100, moderate=70, elevated=40, high=10 |

## Environment Variables

```env
SUPABASE_DATABASE_URL=postgresql://postgres.[project]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
SUPABASE_PUBLISHABLE_KEY=eyJ...
SUPABASE_SECRET_KEY=eyJ...
ADMIN_IMPORT_TOKEN=your-secret-admin-token
```

## Data Import

Run via the admin API endpoint. Requires `x-admin-token` header matching `ADMIN_IMPORT_TOKEN` env var.

```bash
# Import all datasets
curl -X POST https://your-app.up.railway.app/api/admin/import-data \
  -H "x-admin-token: your-secret-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"datasets": ["all"]}' \
  --no-buffer

# Import a single dataset
curl -X POST https://your-app.up.railway.app/api/admin/import-data \
  -H "x-admin-token: your-secret-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"datasets": ["hifld_transmission"]}' \
  --no-buffer

# Check import status
curl https://your-app.up.railway.app/api/admin/import-status \
  -H "x-admin-token: your-secret-admin-token"
```

Available datasets:
- `blm_sma_az` — BLM Surface Management Agency (Arizona)
- `hifld_transmission` — HIFLD electric transmission lines
- `hifld_substations` — HIFLD electric substations
- `county_parcels_az` — Maricopa, Pinal, Yuma county parcels
- `padus_az` — PAD-US 4.0 protected areas (Arizona)
- `fema_flood_az` — FEMA NFHL flood zones (Arizona)
- `all` — All of the above

## Engine Selection

The `POST /api/analyze-state` endpoint auto-selects the engine:

```json
// Force parcel engine
{ "state_code": "AZ", "engine": "parcel" }

// Force grid engine (default when Supabase not configured)
{ "state_code": "AZ", "engine": "grid" }

// Auto-detect: prefers parcel engine only when DB health checks pass
{ "state_code": "AZ" }
```

Before relying on parcel scans, check:

```bash
npm run db:health
curl http://localhost:3000/api/db-health?state_code=AZ
```

## Adding a County Importer

1. Create `lib/importers/my-county.ts` following the pattern in `county-parcels.ts`
2. Export an `async function importMyCounty(onProgress: ProgressCallback): Promise<ImportResult>`
3. Add the dataset key to `DatasetKey` in `lib/importers/run-all.ts`
4. Add a `case` branch in `runAllImporters()`
5. Update the admin import route validator to accept the new key

## LLM Routing

The `/api/explain` endpoint supports an optional `prefer` field:

```json
{ "kind": "state", "id": "AZ", "prefer": "claude" }
{ "kind": "site", "id": "site-123", "prefer": "gemini" }
{ "kind": "state", "id": "TX" }  // auto: Gemini first, Claude fallback
```

Routing logic (`lib/llm-router.ts`):
- `"auto"` (default): uses Gemini if `GEMINI_API_KEY` is set, falls back to Claude
- `"gemini"`: forces Gemini; throws if Gemini fails and Claude is not configured
- `"claude"`: forces Claude (no Gemini fallback)
