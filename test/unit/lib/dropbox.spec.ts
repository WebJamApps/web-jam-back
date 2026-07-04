import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  dropboxConfigured, foldersToPrune, uploadBackupAndPrune, BACKUP_ROOT,
} from '#src/lib/dropbox.js';

// Exercises the real fetch path (token exchange -> upload -> list -> delete) by
// stubbing global fetch, the same way test/unit/lib/calendar.spec.ts does for
// its Google refresh-token flow — no real Dropbox network call is ever made.
const okJson = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });

describe('dropbox.ts', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('dropboxConfigured', () => {
    it('is false when any of the three env vars is missing', () => {
      delete process.env.DROPBOX_APP_KEY;
      delete process.env.DROPBOX_APP_SECRET;
      delete process.env.DROPBOX_REFRESH_TOKEN;
      expect(dropboxConfigured()).toBe(false);

      process.env.DROPBOX_APP_KEY = 'k';
      process.env.DROPBOX_APP_SECRET = 's';
      expect(dropboxConfigured()).toBe(false); // refresh token still missing
    });

    it('is true when all three are set', () => {
      process.env.DROPBOX_APP_KEY = 'k';
      process.env.DROPBOX_APP_SECRET = 's';
      process.env.DROPBOX_REFRESH_TOKEN = 'r';
      expect(dropboxConfigured()).toBe(true);
    });
  });

  describe('foldersToPrune (retention)', () => {
    it('keeps the newest N, prunes the rest, given more than the retention count', () => {
      const names = ['2026-01-01T00-00-00-000Z', '2026-01-08T00-00-00-000Z', '2026-01-15T00-00-00-000Z'];
      expect(foldersToPrune(names, 2)).toEqual(['2026-01-01T00-00-00-000Z']);
    });

    it('prunes nothing when at or under the retention count', () => {
      const names = ['a', 'b'];
      expect(foldersToPrune(names, 8)).toEqual([]);
      expect(foldersToPrune([], 8)).toEqual([]);
    });

    it('defaults to keeping 8', () => {
      const names = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z`);
      const pruned = foldersToPrune(names);
      expect(pruned).toHaveLength(2);
      expect(pruned).toEqual(['2026-01-01T00-00-00-000Z', '2026-01-02T00-00-00-000Z']);
    });

    it('does not mutate the input array', () => {
      const names = ['b', 'a', 'c'];
      foldersToPrune(names, 1);
      expect(names).toEqual(['b', 'a', 'c']);
    });
  });

  describe('uploadBackupAndPrune', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dropbox-spec-'));
      fs.writeFileSync(path.join(tmpDir, 'venue.ndjson'), '{"name":"x"}\n');
      fs.mkdirSync(path.join(tmpDir, 'sub'));
      fs.writeFileSync(path.join(tmpDir, 'sub', 'outreach.ndjson'), '{"status":"sent"}\n');
      process.env.DROPBOX_APP_KEY = 'k';
      process.env.DROPBOX_APP_SECRET = 's';
      process.env.DROPBOX_REFRESH_TOKEN = 'r';
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('exchanges the refresh token, uploads every file recursively, then prunes old runs', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okJson({ access_token: 'at-123' })) // token exchange
        .mockResolvedValueOnce(okJson({})) // upload venue.ndjson
        .mockResolvedValueOnce(okJson({})) // upload sub/outreach.ndjson
        .mockResolvedValueOnce(okJson({ // list_folder — 9 folders total (default retention keeps 8)
          entries: [
            { '.tag': 'folder', name: '2019-01-01T00-00-00-000Z' }, // oldest — the only one pruned
            { '.tag': 'folder', name: '2020-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2021-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2022-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2023-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2024-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2025-01-01T00-00-00-000Z' },
            { '.tag': 'folder', name: '2025-06-01T00-00-00-000Z' },
            { '.tag': 'folder', name: 'run-newest' },
            { '.tag': 'file', name: 'not-a-folder' },
          ],
        }))
        .mockResolvedValueOnce(okJson({})); // delete the pruned folder
      vi.stubGlobal('fetch', fetchMock);

      await uploadBackupAndPrune(tmpDir, 'run-newest');

      expect(fetchMock.mock.calls[0][0]).toContain('oauth2/token');
      const uploadCalls = fetchMock.mock.calls.slice(1, 3).map((c) => (c[1] as any).headers['Dropbox-API-Arg']);
      expect(uploadCalls.some((h: string) => h.includes(`${BACKUP_ROOT}/run-newest/venue.ndjson`))).toBe(true);
      expect(uploadCalls.some((h: string) => h.includes(`${BACKUP_ROOT}/run-newest/sub/outreach.ndjson`))).toBe(true);

      const listCall = fetchMock.mock.calls[3];
      expect(listCall[0]).toContain('list_folder');

      const deleteCall = fetchMock.mock.calls[4];
      expect(deleteCall[0]).toContain('delete_v2');
      expect(JSON.parse((deleteCall[1] as any).body).path).toBe(`${BACKUP_ROOT}/2019-01-01T00-00-00-000Z`);
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

    it('treats a 409 list_folder (folder does not exist yet) as an empty list — nothing to prune', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(okJson({ access_token: 'at-123' }))
        .mockResolvedValueOnce(okJson({}))
        .mockResolvedValueOnce(okJson({}))
        .mockResolvedValueOnce({ ok: false, status: 409, statusText: 'Conflict' });
      vi.stubGlobal('fetch', fetchMock);

      await uploadBackupAndPrune(tmpDir, 'run-first-ever');
      expect(fetchMock).toHaveBeenCalledTimes(4); // no delete call follows
    });
  });
});
