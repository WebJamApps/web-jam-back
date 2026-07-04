import mongoose from 'mongoose';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  serializeDoc, deserializeDoc, exportConnection, runFullBackup, type DbLike, type OpenDb,
} from '#src/lib/backup-export.js';

const { ObjectId } = mongoose.mongo.BSON;

// A trivial in-memory DbLike: a Map of collectionName -> array of docs, exposing
// exactly the two Mongo Db methods exportConnection needs (mirrors the
// ImapClientLike injectable pattern in src/lib/imap-replies.ts) — no real Mongo
// connection is ever opened by these tests.
function fakeDb(data: Record<string, Record<string, unknown>[]>): DbLike {
  return {
    listCollections: () => ({
      toArray: () => Promise.resolve(Object.keys(data).map((name) => ({ name }))),
    }),
    collection: (name: string) => ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      find: (_query: Record<string, unknown>) => ({
        // eslint-disable-next-line @typescript-eslint/require-await
        [Symbol.asyncIterator]: async function* asyncIterator() {
          for (const doc of data[name] || []) yield doc;
        },
      }),
    }),
  };
}

describe('backup-export.ts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-export-spec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('serializeDoc / deserializeDoc (EJSON round trip)', () => {
    it('preserves ObjectId and Date through a round trip', () => {
      const id = new ObjectId();
      const date = new Date('2026-01-15T12:00:00.000Z');
      const doc = { _id: id, name: 'The Bridge', bookedAt: date, count: 3, active: true };

      const line = serializeDoc(doc);
      expect(typeof line).toBe('string');
      const back = deserializeDoc(line);

      expect((back._id as InstanceType<typeof ObjectId>).toString()).toBe(id.toString());
      expect(back._id).toBeInstanceOf(ObjectId);
      expect(back.bookedAt).toBeInstanceOf(Date);
      expect((back.bookedAt as Date).toISOString()).toBe(date.toISOString());
      expect(back.name).toBe('The Bridge');
      expect(back.count).toBe(3);
      expect(back.active).toBe(true);
    });

    it('round-trips a doc with no ObjectId/Date fields too', () => {
      const doc = { key: 'outreach', autoApprove: false };
      expect(deserializeDoc(serializeDoc(doc))).toEqual(doc);
    });
  });

  describe('exportConnection', () => {
    it('writes one ndjson file per collection and returns per-collection counts', async () => {
      const venueId = new ObjectId();
      const db = fakeDb({
        venue: [{ _id: venueId, name: 'The Spot' }],
        outreach: [{ venueId, status: 'sent' }, { venueId, status: 'replied' }],
        emptyCollection: [],
      });

      const counts = await exportConnection(db, tmpDir);

      expect(counts).toEqual({ venue: 1, outreach: 2, emptyCollection: 0 });
      const venueLines = fs.readFileSync(path.join(tmpDir, 'venue.ndjson'), 'utf8').trim().split('\n');
      expect(venueLines).toHaveLength(1);
      expect(deserializeDoc(venueLines[0]).name).toBe('The Spot');

      const outreachLines = fs.readFileSync(path.join(tmpDir, 'outreach.ndjson'), 'utf8').trim().split('\n');
      expect(outreachLines).toHaveLength(2);

      // An empty collection still gets its (empty) file, not skipped entirely.
      expect(fs.existsSync(path.join(tmpDir, 'emptyCollection.ndjson'))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, 'emptyCollection.ndjson'), 'utf8')).toBe('');
    });
  });

  describe('runFullBackup', () => {
    const fakeConnect = (dbs: Record<string, DbLike>) => (uri: string): Promise<OpenDb> => {
      const db = dbs[uri];
      if (!db) return Promise.reject(new Error(`no fake db registered for ${uri}`));
      return Promise.resolve({ db, close: () => Promise.resolve() });
    };

    it('exports both databases when both URIs are configured, and writes a manifest', async () => {
      const primaryDb = fakeDb({ user: [{ name: 'josh' }] });
      const secondaryDb = fakeDb({ gigs: [{ venue: 'The Bridge' }, { venue: 'Pub Fest' }] });
      const outDir = path.join(tmpDir, 'run-1');

      const manifest = await runFullBackup(outDir, {
        primaryUri: 'mongodb://primary',
        secondaryUri: 'mongodb://secondary',
        connect: fakeConnect({ 'mongodb://primary': primaryDb, 'mongodb://secondary': secondaryDb }),
      });

      expect(manifest.databases.webjamsalem).toEqual({ ok: true, collections: { user: 1 } });
      expect(manifest.databases.webjamsocket).toEqual({ ok: true, collections: { gigs: 2 } });
      expect(fs.existsSync(path.join(outDir, 'webjamsalem', 'user.ndjson'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'webjamsocket', 'gigs.ndjson'))).toBe(true);

      const manifestOnDisk = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
      expect(manifestOnDisk.databases.webjamsalem.ok).toBe(true);
      expect(typeof manifestOnDisk.generatedAt).toBe('string');
    });

    it('skips a database with no URI configured (logged, not thrown) — the local GIGS_MONGO_DB_URI-unset case', async () => {
      const primaryDb = fakeDb({ user: [] });
      const outDir = path.join(tmpDir, 'run-2');

      const manifest = await runFullBackup(outDir, {
        primaryUri: 'mongodb://primary',
        secondaryUri: undefined,
        connect: fakeConnect({ 'mongodb://primary': primaryDb }),
      });

      expect(manifest.databases.webjamsalem.ok).toBe(true);
      expect(manifest.databases.webjamsocket).toEqual({
        ok: false,
        reason: 'webjamsocket skipped — no URI configured for this database',
        collections: {},
      });
      expect(fs.existsSync(path.join(outDir, 'webjamsocket'))).toBe(false);
    });

    it('records a failed connection as ok:false with the error message, without throwing', async () => {
      const outDir = path.join(tmpDir, 'run-3');
      const failingConnect = () => Promise.reject(new Error('bad auth'));

      const manifest = await runFullBackup(outDir, {
        primaryUri: 'mongodb://primary',
        secondaryUri: 'mongodb://secondary',
        connect: failingConnect,
      });

      expect(manifest.databases.webjamsalem).toEqual({ ok: false, reason: 'bad auth', collections: {} });
      expect(manifest.databases.webjamsocket).toEqual({ ok: false, reason: 'bad auth', collections: {} });
    });
  });
});
