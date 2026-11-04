import { promises as fs } from "node:fs";
import path from "node:path";

// Load .env.local so R2_* vars are picked up here too (tsx doesn't
// auto-load env files the way the Next.js app does).
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
    path.join(process.cwd(), ".env.local"),
  );
} catch {
  /* no .env.local yet — fine */
}

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// ===========================================================================
// Uploads every file in ./photo-archive/ (downloaded via
// `npm run pmi-archive-photos`) to a Cloudflare R2 bucket, then rewrites
// data/photos.json so the map serves photos from R2 instead of PMI's
// storage.googleapis.com URLs — the last step in no longer depending on the
// PMI contract for photos.
//
// R2 is S3-compatible, so this uses the standard AWS S3 SDK pointed at R2's
// endpoint (no AWS account needed). Requires in .env.local:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET_NAME, R2_PUBLIC_URL_BASE
//
// Usage: npm run pmi-upload-to-r2
// Resumable: skips objects that already exist in the bucket (HeadObject
// check) or fails, so re-running after an interruption only retries what's
// missing.
// ===========================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const ARCHIVE_DIR = path.join(process.cwd(), "photo-archive");
const CONCURRENCY = 8;
const PROGRESS_EVERY = 500;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

interface ProjectPhoto {
  id: string;
  projectId: string;
  url: string;
  sortOrder: number;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicBase = process.env.R2_PUBLIC_URL_BASE;

  const missing = [
    !accountId && "R2_ACCOUNT_ID",
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !bucket && "R2_BUCKET_NAME",
    !publicBase && "R2_PUBLIC_URL_BASE",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing from .env.local: ${missing.join(", ")}`);
    process.exit(1);
  }

  const archiveFiles = await fs.readdir(ARCHIVE_DIR);
  if (!archiveFiles.length) {
    console.error(`No files found in ./photo-archive/ — run \`npm run pmi-archive-photos\` first.`);
    process.exit(1);
  }
  console.log(`Uploading ${archiveFiles.length} files from ./photo-archive/ to R2 bucket "${bucket}"...`);

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
  });

  let done = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  await mapPool(archiveFiles, CONCURRENCY, async (filename) => {
    const key = filename;
    const ext = path.extname(filename).slice(1).toLowerCase();
    try {
      // Skip if it's already up there from a previous run.
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      skipped++;
    } catch {
      try {
        const body = await fs.readFile(path.join(ARCHIVE_DIR, filename));
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: CONTENT_TYPES[ext] || "application/octet-stream",
          }),
        );
        uploaded++;
      } catch (e) {
        failed++;
        console.warn(`  failed: ${filename}: ${(e as Error).message}`);
      }
    }
    done++;
    if (done % PROGRESS_EVERY === 0) {
      console.log(`  …${done}/${archiveFiles.length} (uploaded ${uploaded}, already-there ${skipped}, failed ${failed})`);
    }
  });

  console.log(`\nUpload done. ${uploaded} newly uploaded, ${skipped} already present, ${failed} failed.`);
  if (failed) {
    console.log(`Re-run \`npm run pmi-upload-to-r2\` to retry just the failures.`);
  }

  // Rewrite data/photos.json to point at R2 instead of PMI's storage.
  const photosFile = path.join(DATA_DIR, "photos.json");
  const photos = await readJson<ProjectPhoto[]>(photosFile);
  const archiveSet = new Set(archiveFiles);
  let rewritten = 0;
  let unmatched = 0;
  for (const photo of photos) {
    // Archive filenames are "<photo id>.<ext>" — find whichever extension we
    // actually downloaded for this photo.
    const match = archiveFiles.find((f) => f.startsWith(`${photo.id}.`));
    if (match && archiveSet.has(match)) {
      photo.url = `${publicBase!.replace(/\/$/, "")}/${match}`;
      rewritten++;
    } else {
      unmatched++;
      console.warn(`  no archived file found for photo ${photo.id} — leaving its URL untouched (still points at PMI).`);
    }
  }
  await fs.writeFile(photosFile, JSON.stringify(photos, null, 2));
  console.log(`\nRewrote ${rewritten} of ${photos.length} photo URLs in data/photos.json to point at R2.`);
  if (unmatched) {
    console.log(`${unmatched} photo(s) had no matching archived file and still point at PMI — investigate before canceling.`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
