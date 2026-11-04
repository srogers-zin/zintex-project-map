import { promises as fs } from "node:fs";
import path from "node:path";

// ===========================================================================
// Downloads the actual image bytes for every photo in data/photos.json to a
// local folder, so they're safe on disk independent of PMI's account/storage
// staying alive after that contract ends. data/photos.json only stores PMI's
// hosted URLs (storage.googleapis.com/pmi-photos/...) — if that bucket ever
// goes away, this is the only thing standing between you and broken images.
//
// This does NOT change what the live site serves — it's a backup, not a
// re-host. Rewiring the app to serve from wherever these end up long-term
// (S3/R2/etc.) is a separate follow-up if/when you want it.
//
// Resumable: already-downloaded files are skipped, so it's safe to re-run
// after a network hiccup or to retry just the failures.
//
// Usage: npm run pmi-archive-photos
// ===========================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const ARCHIVE_DIR = path.join(process.cwd(), "photo-archive");
const CONCURRENCY = 8;
const PROGRESS_EVERY = 500;

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

function extFromUrl(url: string): string {
  const m = url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i);
  return m ? m[1].toLowerCase() : "jpg";
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const photos = await readJson<ProjectPhoto[]>(path.join(DATA_DIR, "photos.json"));
  console.log(`Archiving ${photos.length} photos to ./photo-archive/ ...`);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  await mapPool(photos, CONCURRENCY, async (photo) => {
    const ext = extFromUrl(photo.url);
    const file = path.join(ARCHIVE_DIR, `${photo.id}.${ext}`);

    if (await fileExists(file)) {
      skipped++;
    } else {
      try {
        const res = await fetch(photo.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(file, buf);
      } catch (e) {
        failed++;
        console.warn(`  failed: ${photo.id} (${photo.url}): ${(e as Error).message}`);
      }
    }

    done++;
    if (done % PROGRESS_EVERY === 0) {
      console.log(`  …${done}/${photos.length} (skipped ${skipped} already-downloaded, ${failed} failed)`);
    }
  });

  console.log(`\nDone. ${photos.length - failed} of ${photos.length} photos present in ./photo-archive/.`);
  console.log(`  (${skipped} were already downloaded from a previous run, ${failed} failed this run.)`);
  if (failed) {
    console.log(`Re-run \`npm run pmi-archive-photos\` to retry just the failed ones — already-downloaded files are skipped automatically.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
