-- ===========================================================================
-- Project Map It — Postgres / PostGIS schema (production target)
--
-- This is the real DDL for the production database (Supabase or RDS). The demo
-- runs on JSON fixtures instead (DATA_SOURCE=fixtures), but the fixture shapes
-- match these tables 1:1, so switching to Postgres is a data-layer swap only.
--
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --- Branch locations ------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL,
  phone           TEXT NOT NULL,
  geom            GEOGRAPHY(POINT, 4326) NOT NULL,
  google_place_id TEXT
);

-- --- Projects (one per CompanyCam project) ---------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  companycam_project_id TEXT UNIQUE NOT NULL,
  address               TEXT NOT NULL,
  geom                  GEOGRAPHY(POINT, 4326) NOT NULL,
  location_id           TEXT NOT NULL REFERENCES locations(id),
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  photo_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- opted_out is the enforcement point for the homeowner suppression list.
  -- The public API MUST filter opted_out = false. This is the main legal
  -- exposure of the product — real home addresses are published.
  opted_out             BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index powers bounding-box map loads and radius search.
CREATE INDEX IF NOT EXISTS projects_geom_gix ON projects USING GIST (geom);
CREATE INDEX IF NOT EXISTS projects_location_idx ON projects (location_id);
CREATE INDEX IF NOT EXISTS projects_tags_gin ON projects USING GIN (tags);
CREATE INDEX IF NOT EXISTS projects_opted_out_idx ON projects (opted_out);

-- --- Project photos --------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_photos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  companycam_photo_url  TEXT NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS project_photos_project_idx ON project_photos (project_id);

-- --- Google reviews (synced per location) ----------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id      TEXT NOT NULL REFERENCES locations(id),
  google_review_id TEXT UNIQUE NOT NULL,
  rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  author_name      TEXT NOT NULL,
  author_photo_url TEXT,
  text             TEXT NOT NULL DEFAULT '',
  posted_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_location_idx ON reviews (location_id);

-- --- Opt-out suppression list ----------------------------------------------
CREATE TABLE IF NOT EXISTS opt_outs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  address_or_project_id TEXT NOT NULL,
  method                TEXT NOT NULL CHECK (method IN ('form', 'phone', 'email')),
  contact_email         TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Captured leads --------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID REFERENCES projects(id),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT NOT NULL,
  message         TEXT NOT NULL DEFAULT '',
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  crm_sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (crm_sync_status IN ('pending', 'synced', 'failed'))
);

-- --- Example spatial query (bounding-box load, opt-out enforced) ------------
-- SELECT id, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, tags
-- FROM projects
-- WHERE opted_out = false
--   AND geom && ST_MakeEnvelope(:west, :south, :east, :north, 4326)::geography;
