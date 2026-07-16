import type {
  Lead,
  LeadInput,
  Location,
  OptOutInput,
  Project,
  ProjectDetail,
  ProjectPin,
  ProjectQuery,
  Review,
} from "@/lib/types";
import type { Repo } from "@/lib/repo/repo";

// Production repository backed by Postgres + PostGIS.
//
// This carries the REAL queries so switching DATA_SOURCE=postgres is a
// credentials-and-migrate step, not a rewrite. It is intentionally lazy about
// importing `pg` so the demo (DATA_SOURCE=fixtures) never needs a live DB.
//
// To activate: apply db/schema.sql, seed the tables from the CompanyCam sync
// (scripts/sync-companycam.ts), set DATABASE_URL, and set DATA_SOURCE=postgres.

type PgPool = import("pg").Pool;

let poolPromise: Promise<PgPool> | null = null;

async function getPool(): Promise<PgPool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { Pool } = await import("pg");
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL is required when DATA_SOURCE=postgres");
      return new Pool({ connectionString: url, max: 10 });
    })();
  }
  return poolPromise;
}

// Build the shared WHERE clause + params for pin/list queries.
// opted_out = false is ALWAYS applied — the opt-out enforcement point.
function buildFilter(query: ProjectQuery): { where: string; params: unknown[] } {
  const clauses = ["opted_out = false"];
  const params: unknown[] = [];

  if (query.bbox) {
    params.push(query.bbox[0], query.bbox[1], query.bbox[2], query.bbox[3]);
    const n = params.length;
    clauses.push(
      `geom && ST_MakeEnvelope($${n - 3}, $${n - 2}, $${n - 1}, $${n}, 4326)::geography`,
    );
  }
  if (query.locationIds?.length) {
    params.push(query.locationIds);
    clauses.push(`location_id = ANY($${params.length})`);
  }
  if (query.tags?.length) {
    params.push(query.tags);
    clauses.push(`tags && $${params.length}`); // array overlap
  }
  if (query.search?.trim()) {
    params.push(`%${query.search.trim()}%`);
    clauses.push(`address ILIKE $${params.length}`);
  }
  return { where: clauses.join(" AND "), params };
}

export class PostgresRepo implements Repo {
  async getLocations(): Promise<Location[]> {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT id, name, address, phone,
              ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng,
              google_place_id AS "googlePlaceId"
       FROM locations ORDER BY name`,
    );
    return rows as Location[];
  }

  async getPins(query: ProjectQuery): Promise<ProjectPin[]> {
    const pool = await getPool();
    const { where, params } = buildFilter(query);
    const { rows } = await pool.query(
      `SELECT id,
              ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng,
              (photo_count > 0) AS "hasPhotos", tags, location_id AS "locationId"
       FROM projects WHERE ${where}`,
      params,
    );
    return rows as ProjectPin[];
  }

  async listProjects(query: ProjectQuery, limit: number, offset: number) {
    const pool = await getPool();
    const { where, params } = buildFilter(query);
    const totalRes = await pool.query(
      `SELECT count(*)::int AS total FROM projects WHERE ${where}`,
      params,
    );
    const { rows } = await pool.query(
      `SELECT id, companycam_project_id AS "companycamProjectId", address,
              ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng,
              location_id AS "locationId", tags, photo_count AS "photoCount",
              created_at AS "createdAt", opted_out AS "optedOut"
       FROM projects WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return { items: rows as Project[], total: totalRes.rows[0].total as number };
  }

  async getProjectDetail(id: string): Promise<ProjectDetail | null> {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT p.id, p.companycam_project_id AS "companycamProjectId", p.address,
              ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng,
              p.location_id AS "locationId", p.tags, p.photo_count AS "photoCount",
              p.created_at AS "createdAt", p.opted_out AS "optedOut",
              l.name AS "locationName"
       FROM projects p JOIN locations l ON l.id = p.location_id
       WHERE p.id = $1 AND p.opted_out = false`,
      [id],
    );
    if (rows.length === 0) return null;
    const photos = await pool.query(
      `SELECT id, project_id AS "projectId", companycam_photo_url AS url,
              sort_order AS "sortOrder"
       FROM project_photos WHERE project_id = $1 ORDER BY sort_order`,
      [id],
    );
    const reviews = await pool.query(
      `SELECT id, location_id AS "locationId", google_review_id AS "googleReviewId",
              rating, author_name AS "authorName", author_photo_url AS "authorPhotoUrl",
              text, posted_at AS "postedAt", project_id AS "projectId"
       FROM reviews WHERE project_id = $1 ORDER BY posted_at DESC`,
      [id],
    );
    return { ...(rows[0] as ProjectDetail), photos: photos.rows, reviews: reviews.rows };
  }

  async getReviews(locationIds?: string[]): Promise<Review[]> {
    const pool = await getPool();
    const params: unknown[] = [];
    let where = "";
    if (locationIds?.length) {
      params.push(locationIds);
      where = `WHERE location_id = ANY($1)`;
    }
    const { rows } = await pool.query(
      `SELECT id, location_id AS "locationId", google_review_id AS "googleReviewId",
              rating, author_name AS "authorName", author_photo_url AS "authorPhotoUrl",
              text, posted_at AS "postedAt"
       FROM reviews ${where} ORDER BY posted_at DESC`,
      params,
    );
    return rows as Review[];
  }

  async createLead(input: LeadInput): Promise<Lead> {
    const pool = await getPool();
    const { rows } = await pool.query(
      `INSERT INTO leads (project_id, name, phone, email, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, project_id AS "projectId", name, phone, email, message,
                 submitted_at AS "submittedAt", crm_sync_status AS "crmSyncStatus"`,
      [input.projectId, input.name, input.phone, input.email, input.message],
    );
    // TODO(crm): enqueue HubSpot sync here once CRM is confirmed (Open Q #3).
    return rows[0] as Lead;
  }

  async createOptOut(input: OptOutInput): Promise<{ id: string; suppressedCount: number }> {
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO opt_outs (address_or_project_id, method, contact_email)
         VALUES ($1, $2, $3) RETURNING id`,
        [input.addressOrProjectId, input.method, input.contactEmail],
      );
      // Matching rule mirrors src/lib/opt-out-match.ts (kept in sync manually
      // since this is SQL, not shared JS): exact id match, OR exact match on
      // the full address, OR exact match on just the street line (text before
      // the first comma) — but only when the submitted value contains a digit,
      // since a real street address always has a house number and a bare
      // city/state name must never be allowed to match at all. Deliberately
      // NOT a "contains"/ILIKE-with-wildcards match — see the "Abilene"
      // incident in opt-out-match.ts for why that's unsafe (one vague entry
      // silently suppressed 72 unrelated projects).
      const needle = input.addressOrProjectId.trim().toLowerCase();
      const hasDigit = /\d/.test(needle);
      const upd = await client.query(
        `UPDATE projects SET opted_out = true, updated_at = now()
         WHERE opted_out = false
           AND (
             lower(companycam_project_id) = $1
             OR id::text = $1
             OR ($2 AND (
               lower(address) = $1
               OR lower(trim(split_part(address, ',', 1))) = $1
             ))
           )`,
        [needle, hasDigit],
      );
      await client.query("COMMIT");
      return { id: ins.rows[0].id as string, suppressedCount: upd.rowCount ?? 0 };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
