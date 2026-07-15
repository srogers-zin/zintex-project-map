# Project Map It — Zintex in-house rebuild

An owned replacement for the third-party Project Map It (PMI) platform: a public
map of completed Zintex projects (pulled from CompanyCam), with photos, service
filtering, Google reviews, lead capture, and a homeowner opt-out flow.

This repo is the **MVP foundation**. It runs today with **zero external
credentials** — the data layer is backed by seeded fixtures, and the map uses
MapLibre + OpenStreetMap tiles (no token). Every place that needs a real
credential is isolated behind a clear seam (see [Swap-in points](#swap-in-points)).

## Quick start

```bash
npm install
npm run seed      # generates demo fixtures in /data (600 projects, 192 reviews)
npm run dev       # http://localhost:3000
```

> If the map ever renders blank during rapid HMR reloads, hard-reload the tab —
> MapLibre's web worker can get into a stale state across Next.js hot updates.
> A fresh page load always renders correctly.

## What's built (MVP parity with PMI)

| Feature | Status | Notes |
|---|---|---|
| Clustered map pins | ✅ | MapLibre GL + Supercluster, numbered clusters |
| Sidebar project list | ✅ | Synced to filters, total badge, pagination |
| Project detail modal | ✅ | Photo gallery w/ pager, service tags, branch |
| Filter by service + branch | ✅ | `View Services` panel |
| Location / address search | ✅ | Text search + "use my location" geolocate |
| Reviews panel | ✅ | Aggregate rating + per-branch review feed |
| Lead capture → CRM | ✅ (seam) | Validated form; CRM sync is a stub (Open Q #3) |
| Opt-out flow | ✅ | Public page + enforced suppression on every query |
| Shareable per-project link | ✅ | `?project=<id>` opens the modal directly |
| Embed on zintex.com | ⏳ | The `/` route is iframe-ready; script embed TBD |

## Architecture

- **Frontend / API**: Next.js (App Router) + TypeScript + Tailwind v4
- **Map**: MapLibre GL JS + Supercluster (client-side clustering)
- **Data layer**: one `Repo` interface, two implementations —
  - `FixtureRepo` (default, no DB) — reads seeded JSON from `/data`
  - `PostgresRepo` (production) — real PostGIS queries in `src/lib/repo/postgres.ts`
  - selected at runtime by `DATA_SOURCE` (`fixtures` | `postgres`)
- **DB (production target)**: Postgres + PostGIS — schema in [`db/schema.sql`](db/schema.sql)
- **Ingest**: CompanyCam sync — pure transform in `src/lib/companycam.ts`,
  job skeleton in `scripts/sync-companycam.ts`

```
CompanyCam API ──▶ transform ──▶ (geocode) ──▶ opt-out filter ──▶ Postgres
                                                                     │
Google Business Profile ──▶ reviews sync ──────────────────────────▶│
                                                                     ▼
                                          Next.js API ──▶ Map / Sidebar / Reviews / Leads
```

## Data model

`locations`, `projects`, `project_photos`, `reviews`, `opt_outs`, `leads` —
see [`db/schema.sql`](db/schema.sql). Fixture JSON shapes match the tables 1:1,
so moving to Postgres is a data-layer swap, not a rewrite.

## Swap-in points

Each real integration is one isolated change. Copy `.env.example` → `.env.local`.

1. **Postgres** — apply `db/schema.sql`, set `DATABASE_URL`, set
   `DATA_SOURCE=postgres`. Queries already written in `postgres.ts`.
2. **CompanyCam** (Open Q #1) — get an API token (CompanyCam → Account →
   Developers/API), set `COMPANYCAM_API_TOKEN` in `.env.local`, then run the sync:

   ```bash
   # 1. Smoke-test the field mapping against ~50 real projects first
   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam -- --limit 50
   # 2. Full 23k backfill (writes to data/*.json in fixtures mode)
   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam -- --full
   # 3. Thereafter, incremental (only projects changed since last run)
   COMPANYCAM_API_TOKEN=xxx npm run sync:companycam
   ```

   The sync handles pagination, 429/5xx backoff, photo fetching (concurrency),
   opt-out enforcement, and incremental state (`data/sync-state.json`). For the
   full 23k it writes to Postgres if `DATA_SOURCE=postgres` (recommended at that
   scale) or to JSON fixtures otherwise. Confirm CompanyCam's field/endpoint
   names on the smoke-test run — they're isolated in `src/lib/companycam.ts`.
   Wire the geocode step only if projects come back without coordinates
   (CompanyCam usually includes them).
3. **Reviews** (Open Q #2) — replace the fixture reviews with a Google Business
   Profile sync per branch. ⚠️ Full historical reviews require the **gated GBP
   API + per-location OAuth**, not the Places API (which caps at ~5/location).
   Request access early — it has approval lead time.
4. **CRM leads** (Open Q #3) — implement the HubSpot enqueue in
   `PostgresRepo.createLead` / the `/api/leads` route once the CRM is confirmed.
5. **Basemap** — optional. Set `NEXT_PUBLIC_MAPBOX_TOKEN` and switch the style in
   `src/lib/map-style.ts`. For production traffic prefer a commercial/self-hosted
   tile provider over the public OSM servers (their policy discourages embedding).

## Compliance note (opt-out)

Real home addresses are published, so the opt-out is a **first-class, enforced**
feature, not cosmetic. `opted_out = false` is applied on every public query
(`getPins`, `listProjects`, `getProjectDetail`). The suppression list also
persists so future CompanyCam syncs never re-publish a removed address. Legal
review of this flow is Open Question #4 before launch.

## Scripts

| Command | Purpose |
|---|---|
| `npm run seed` | Regenerate demo fixtures |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run sync:companycam` | Run the sync job (fixture mode until token set) |
