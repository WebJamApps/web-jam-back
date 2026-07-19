// src/lib/migration-cli.ts — web-jam-back#980
//
// Shared one-time-migration CLI scaffolding: dry-run-by-default `--apply`
// flag parsing, the local/DEV/TEST-only safety guard (never write to prod
// without an explicit `--force`), and Mongo URI masking for log output.
//
// Every migrate-*.ts script under src/scripts/ hand-rolled an identical copy
// of this boilerplate (migrate-drop-contact-verified.ts, migrate-drop-in-
// scope.ts, migrate-gig-venue-id.ts, migrate-target-weekend.ts, all predating
// #980). #980 adds two MORE one-time migrations (migrate-drop-do-not-
// contact.ts, migrate-clean-city.ts); copy-pasting the pattern a 5th/6th time
// pushed jscpd's duplication check over its 5% threshold. Extracted here so
// #980's two new scripts share ONE implementation instead of adding two more
// near-identical copies. The pre-existing scripts are left as-is — refactoring
// them is out of #980's scope.
import { fileURLToPath } from 'url';

export interface MigrationArgs { apply: boolean; force: boolean }

// `--apply` opts into writing (default: dry run / read-only). `--force`
// opts into running against a database that doesn't look like local/DEV/TEST
// (see isSafeToRun below) — a deliberate, reviewed prod run.
export function parseArgs(argv: string[]): MigrationArgs {
  return { apply: argv.includes('--apply'), force: argv.includes('--force') };
}

// Only a db name/host that looks local/DEV/TEST is allowed to run without
// --force — refuses release/production by default.
export function isSafeToRun(uri: string, force: boolean): boolean {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
  return isLocal || isDevOrTest || force;
}

// eslint-disable-next-line sonarjs/slow-regex
const CREDENTIALS_RE = /\/\/[^@]+@/;
export function maskMongoUri(uri: string): string {
  return uri.replace(CREDENTIALS_RE, '//<credentials>@');
}

// Prints the refusal message when isSafeToRun fails and the caller should
// process.exit(1). `scriptName` names the script in the error text;
// `npmScript` is its `npm run migrate:...` name, for the --force example.
export function logSafetyBlock(scriptName: string, npmScript: string, uri: string, maskedUri: string): void {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  console.error(`ERROR: ${scriptName} only runs against a local, DEV, or TEST database by default — never release/production.`);
  console.error(`Target MONGO URI: ${maskedUri}`);
  console.error(`Parsed database name: ${dbName || '(none)'}`);
  console.error('Pass --force to run against a different database anyway (a deliberate, reviewed prod backfill), e.g.');
  console.error(`  heroku run "npm run ${npmScript} -- --force" -a webjamsalem   # dry run against prod`);
  console.error(`  heroku run "npm run ${npmScript} -- --force --apply" -a webjamsalem   # writes for real`);
}

// True only when this module is being executed directly (`node script.js`),
// never when imported by a unit test — gates the auto-run block at the
// bottom of every migrate-*.ts script. Pass `import.meta.url` from the caller.
export function isMainModule(importMetaUrl: string): boolean {
  return Boolean(process.argv[1]) && fileURLToPath(importMetaUrl) === process.argv[1];
}

export interface MigrationRunContext { apply: boolean; force: boolean; uri: string; maskedUri: string }

// The full "parse argv + env, refuse an unsafe target" preamble every
// migrate-*.ts script's run() starts with. Calls process.exit(1) (never
// returns) when isSafeToRun fails; otherwise returns the parsed args + URI
// info the caller needs to proceed (connect, log the mode, do the work).
export function guardOrExit(scriptName: string, npmScript: string): MigrationRunContext {
  const { apply, force } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_DB_URI || '';
  const maskedUri = maskMongoUri(uri);
  if (!isSafeToRun(uri, force)) {
    logSafetyBlock(scriptName, npmScript, uri, maskedUri);
    process.exit(1);
  }
  return {
    apply, force, uri, maskedUri,
  };
}
