import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  dropboxConfigured,
  foldersToPrune,
  uploadBackupAndPrune,
  downloadFile,
  readManifest,
  isGoodRun,
  parseRunDate,
  BACKUP_ROOT,
  type RunFolderEntry,
} from '#src/lib/dropbox.js';
import type { BackupManifest } from '#src/lib/backup-export.js';

const okJson = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });
const okText = (text: string) => {
  const encoded = new TextEncoder().encode(text);
  const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(ab),
  };
};

describe('dropbox.ts', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('dropboxConfigured', () => {
    it('is false when any of the three BACKUP_DROPBOX env vars is missing', () => {
      delete process.env.BACKUP_DROPBOX_APP_KEY;
      delete process.env.BACKUP_DROPBOX_APP_SECRET;
      delete process.env.BACKUP_DROPBOX_REFRESH_TOKEN;
      expect(dropboxConfigured()).toBe(false);

      process.env.BACKUP_DROPBOX_APP_KEY = 'k';
      process.env.BACKUP_DROPBOX_APP_SECRET = 's';
      expect(dropboxConfigured()).toBe(false); // refresh token still missing
    });

    it('ignores legacy DROPBOX_* settings and requires BACKUP_DROPBOX_*', () => {
      delete process.env.BACKUP_DROPBOX_APP_KEY;
      delete process.env.BACKUP_DROPBOX_APP_SECRET;
      delete process.env.BACKUP_DROPBOX_REFRESH_TOKEN;
      process.env.DROPBOX_APP_KEY = 'old-k';
      process.env.DROPBOX_APP_SECRET = 'old-s';
      process.env.DROPBOX_REFRESH_TOKEN = 'old-r';
      expect(dropboxConfigured()).toBe(false);
    });

    it('is true when all three BACKUP_DROPBOX settings are present', () => {
      process.env.BACKUP_DROPBOX_APP_KEY = 'k';
      process.env.BACKUP_DROPBOX_APP_SECRET = 's';
      process.env.BACKUP_DROPBOX_REFRESH_TOKEN = 'r';
      expect(dropboxConfigured()).toBe(true);
    });
  });

  describe('downloadFile & readManifest', () => {
    it('downloadFile returns buffer on 200', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okText('hello')));
      const res = await downloadFile('token', '/webjam-backups/test.txt');
      expect(res?.toString('utf8')).toBe('hello');
    });

    it('downloadFile returns null on 409 (not found)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 409, statusText: 'Conflict' }));
      const res = await downloadFile('token', '/webjam-backups/missing.txt');
      expect(res).toBeNull();
    });

    it('downloadFile throws on unexpected HTTP errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' }));
      await expect(downloadFile('token', '/webjam-backups/err.txt')).rejects.toThrow(/dropbox download failed/);
    });

    it('readManifest returns parsed manifest on success', async () => {
      const manifest: BackupManifest = {
        startedAt: '2026-10-07T00:00:00.000Z',
        finishedAt: '2026-10-07T00:01:00.000Z',
        trigger: 'backup button',
        generatedAt: '2026-10-07T00:00:00.000Z',
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okText(JSON.stringify(manifest))));
      const res = await readManifest('token', 'run-1');
      expect(res).toEqual(manifest);
    });

    it('readManifest returns null when file is not found (409)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 409, statusText: 'Conflict' }));
      const res = await readManifest('token', 'run-missing');
      expect(res).toBeNull();
    });

    it('readManifest throws when JSON is invalid', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okText('{ invalid-json')));
      await expect(readManifest('token', 'run-corrupt')).rejects.toThrow(/failed to parse manifest/);
    });
  });

  describe('isGoodRun', () => {
    it('returns true when every configured database has ok: true', () => {
      const manifest: BackupManifest = {
        generatedAt: '2026-10-07T00:00:00.000Z',
        databases: {
          webjamsalem: { ok: true, collections: { user: 1 } },
        },
      };
      expect(isGoodRun(manifest)).toBe(true);
    });

    it('returns false for null, undefined, or empty databases', () => {
      expect(isGoodRun(null)).toBe(false);
      expect(isGoodRun(undefined)).toBe(false);
      expect(isGoodRun({ generatedAt: '2026-10-07T00:00:00.000Z', databases: {} })).toBe(false);
    });

    it('returns false if any database ok is false', () => {
      const manifest: BackupManifest = {
        generatedAt: '2026-10-07T00:00:00.000Z',
        databases: {
          webjamsalem: { ok: false, reason: 'error', collections: {} },
        },
      };
      expect(isGoodRun(manifest)).toBe(false);
    });
  });

  describe('parseRunDate', () => {
    it('parses run labels formatted with hyphens into Date', () => {
      const d = parseRunDate('2026-10-07T21-40-51-044Z');
      expect(d).toBeInstanceOf(Date);
      expect(d?.toISOString()).toBe('2026-10-07T21:40:51.044Z');
    });

    it('parses standard ISO date strings', () => {
      const d = parseRunDate('2026-10-07T21:40:51.044Z');
      expect(d).toBeInstanceOf(Date);
      expect(d?.toISOString()).toBe('2026-10-07T21:40:51.044Z');
    });

    it('returns null for unparseable dates', () => {
      expect(parseRunDate('not-a-date')).toBeNull();
    });
  });

  describe('foldersToPrune (retention)', () => {
    it('keeps the newest N, prunes the rest, given string array', () => {
      const names = ['2026-01-01T00-00-00-000Z', '2026-01-08T00-00-00-000Z', '2026-01-15T00-00-00-000Z'];
      expect(foldersToPrune(names, 2)).toEqual(['2026-01-01T00-00-00-000Z']);
    });

    it('prunes nothing when at or under the retention count for string array', () => {
      const names = ['a', 'b'];
      expect(foldersToPrune(names, 8)).toEqual([]);
      expect(foldersToPrune([], 8)).toEqual([]);
    });

    it('defaults to keeping 8 for string array', () => {
      const names = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z`);
      const pruned = foldersToPrune(names);
      expect(pruned).toHaveLength(2);
      expect(pruned).toEqual(['2026-01-01T00-00-00-000Z', '2026-01-02T00-00-00-000Z']);
    });

    it('prunes good runs beyond 8 and incomplete folders over a day old given RunFolderEntry[]', () => {
      const now = new Date('2026-10-08T12:00:00.000Z');
      const runs: RunFolderEntry[] = [
        // 9 good runs: 1 should be pruned (the oldest)
        { name: 'good-01', isGood: true, date: new Date('2026-10-01T00:00:00.000Z') }, // oldest good
        { name: 'good-02', isGood: true, date: new Date('2026-10-02T00:00:00.000Z') },
        { name: 'good-03', isGood: true, date: new Date('2026-10-03T00:00:00.000Z') },
        { name: 'good-04', isGood: true, date: new Date('2026-10-04T00:00:00.000Z') },
        { name: 'good-05', isGood: true, date: new Date('2026-10-05T00:00:00.000Z') },
        { name: 'good-06', isGood: true, date: new Date('2026-10-06T00:00:00.000Z') },
        { name: 'good-07', isGood: true, date: new Date('2026-10-07T00:00:00.000Z') },
        { name: 'good-08', isGood: true, date: new Date('2026-10-08T00:00:00.000Z') },
        { name: 'good-09', isGood: true, date: new Date('2026-10-08T06:00:00.000Z') },
        // Incomplete folder 25 hours old (> 24h) -> prune
        { name: 'inc-old', isGood: false, date: new Date('2026-10-07T10:00:00.000Z') },
        // Incomplete folder 5 hours old (< 24h) -> keep
        { name: 'inc-recent', isGood: false, date: new Date('2026-10-08T07:00:00.000Z') },
      ];

      const pruned = foldersToPrune(runs, 8, now);
      expect(pruned).toContain('good-01');
      expect(pruned).toContain('inc-old');
      expect(pruned).not.toContain('inc-recent');
      expect(pruned).not.toContain('good-02');
      expect(pruned).toHaveLength(2);
    });
  });

  describe('uploadBackupAndPrune', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropbox-spec-'));
      fs.writeFileSync(path.join(tmpDir, 'venue.ndjson'), '{"name":"x"}\n');
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      fs.writeFileSync(path.join(tmpDir, 'sub', 'outreach.ndjson'), '{"status":"sent"}\n');
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify({
        databases: { webjamsalem: { ok: true, collections: {} } },
      }));
      process.env.BACKUP_DROPBOX_APP_KEY = 'k';
      process.env.BACKUP_DROPBOX_APP_SECRET = 's';
      process.env.BACKUP_DROPBOX_REFRESH_TOKEN = 'r';
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('exchanges token, uploads files with manifest last, reads back manifest, and prunes old runs', async () => {
      const goodManifestJson = JSON.stringify({
        databases: { webjamsalem: { ok: true, collections: {} } },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okJson({ access_token: 'at-123' })) // token exchange
        .mockResolvedValueOnce(okJson({})) // upload venue.ndjson
        .mockResolvedValueOnce(okJson({})) // upload sub/outreach.ndjson
        .mockResolvedValueOnce(okJson({})) // upload manifest.json (LAST)
        .mockResolvedValueOnce(okText(goodManifestJson)) // read back manifest of uploaded run
        .mockResolvedValueOnce(okJson({ // list_folder (9 folders)
          entries: [
            { '.tag': 'folder', name: '2019-01-01T00-00-00-000Z' }, // oldest good run
            { '.tag': 'folder', name: '2020-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2021-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2022-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2023-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2024-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2025-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2025-06-01T00-00-00-000Z' },
            { '.tag': 'folder', name: 'run-newest' },
          ],
        }))
        // 9 manifest reads for each folder:
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okText(goodManifestJson))
        .mockResolvedValueOnce(okJson({})); // delete pruned folder

      vi.stubGlobal('fetch', fetchMock);

      await uploadBackupAndPrune(tmpDir, 'run-newest');

      expect(fetchMock.mock.calls[0][0]).toContain('oauth2/token');
      // Manifest must be uploaded last among the upload calls (index 1 to 3)
      const uploadCalls = fetchMock.mock.calls.slice(1, 4).map(
        (c) => (c[1] as unknown as { headers: Record<string, string> }).headers['Dropbox-API-Arg'],
      );
      expect(uploadCalls[2]).toContain('manifest.json');

      const deleteCall = fetchMock.mock.calls[15];
      expect(deleteCall[0]).toContain('delete_v2');
      const body = JSON.parse((deleteCall[1] as unknown as { body: string }).body) as { path: string };
      expect(body.path).toBe(`${BACKUP_ROOT}/2019-01-01T00-00-00-000Z`);
    });

    it('skips deletion if manifest read-back returns not-good', async () => {
      const badManifestJson = JSON.stringify({
        databases: { webjamsalem: { ok: false, reason: 'failed' } },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okJson({ access_token: 'at-123' }))
        .mockResolvedValueOnce(okJson({}))
        .mockResolvedValueOnce(okJson({}))
        .mockResolvedValueOnce(okJson({})) // upload manifest
        .mockResolvedValueOnce(okText(badManifestJson)); // read-back says failed

      vi.stubGlobal('fetch', fetchMock);

      await uploadBackupAndPrune(tmpDir, 'run-newest');
      expect(fetchMock).toHaveBeenCalledTimes(5); // no list_folder or delete calls follow
    });

    it('throws when the token exchange fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' }));
      await expect(uploadBackupAndPrune(tmpDir, 'run-x')).rejects.toThrow(/token exchange failed/);
    });

    it('throws when an upload fails', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(okJson({ access_token: 'at-123' }))
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' }));
      await expect(uploadBackupAndPrune(tmpDir, 'run-x')).rejects.toThrow(/upload failed/);
    });
  });
});
