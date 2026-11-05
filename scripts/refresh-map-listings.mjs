import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import {
  buildOvertureDuckDbQuery,
  fetchLatestOvertureRelease,
  refreshMapListings,
} from '#src/model/venue/map-listing-refresh.js';

const execFileAsync = promisify(execFile);
const DUCKDB_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

function readArg(flag) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const prefix = `${flag}=`;
  const eq = args.find((a) => a.startsWith(prefix));
  return eq ? eq.slice(prefix.length) : '';
}

async function queryOvertureWithDuckDb(release, duckDbBin) {
  const sql = buildOvertureDuckDbQuery(release);
  const { stdout } = await execFileAsync(duckDbBin, ['-json', '-c', sql], {
    maxBuffer: DUCKDB_MAX_BUFFER_BYTES,
  });
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error('DuckDB JSON output is not an array.');
  }
  return parsed;
}

const uri = readArg('--uri') || process.env.MAP_LISTINGS_MONGO_URI || '';
const releaseOverride = readArg('--release') || process.env.OVERTURE_RELEASE || '';
const duckDbBin = readArg('--duckdb-bin') || process.env.DUCKDB_BIN || 'duckdb';

if (!uri) {
  process.stderr.write(
    'Usage: MAP_LISTINGS_MONGO_URI=<mongodb-uri> node scripts/refresh-map-listings.mjs [--release <YYYY-MM-DD.N>]\n',
  );
  process.exit(1);
}

await mongoose.connect(uri);
try {
  const result = await refreshMapListings({
    fetchAnswer: async () => {
      const release = releaseOverride || (await fetchLatestOvertureRelease());
      const rows = await queryOvertureWithDuckDb(release, duckDbBin);
      return { release, rows };
    },
  });
  process.stdout.write(
    `Refreshed mapListing collection from Overture release ${result.release}: `
      + `${result.written} written, ${result.removed} removed (was ${result.previousCount}) at ${result.downloadedAt.toISOString()}\n`,
  );
} finally {
  await mongoose.disconnect();
}
