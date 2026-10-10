import { classifyManifest, buildRunSummary } from '#src/model/backup/backup-runs.js';
import type { BackupManifest } from '#src/lib/backup-export.js';
import { BACKUP_ROOT } from '#src/lib/dropbox.js';

describe('backup-runs module', () => {
  describe('classifyManifest', () => {
    it('returns good when every configured database export succeeded with ok: true', () => {
      const manifest: BackupManifest = {
        generatedAt: '2026-10-07T21:40:51.044Z',
        databases: {
          webjamsalem: { ok: true, collections: { user: 10, songs: 5 } },
        },
      };
      expect(classifyManifest(manifest)).toBe('good');
    });

    it('returns good when multiple databases all succeeded with ok: true', () => {
      const manifest: BackupManifest = {
        generatedAt: '2026-10-07T21:40:51.044Z',
        databases: {
          webjamsalem: { ok: true, collections: { user: 10 } },
          secondDb: { ok: true, collections: { gigs: 4 } },
        },
      };
      expect(classifyManifest(manifest)).toBe('good');
    });

    it('returns failed when any database export failed with ok: false', () => {
      const manifest: BackupManifest = {
        generatedAt: '2026-10-07T21:40:51.044Z',
        databases: {
          webjamsalem: { ok: false, reason: 'disk full', collections: {} },
        },
      };
      expect(classifyManifest(manifest)).toBe('failed');
    });

    it('returns failed when one database succeeded but another failed', () => {
      const manifest: BackupManifest = {
        generatedAt: '2026-10-07T21:40:51.044Z',
        databases: {
          webjamsalem: { ok: true, collections: { user: 10 } },
          secondDb: { ok: false, reason: 'timeout', collections: {} },
        },
      };
      expect(classifyManifest(manifest)).toBe('failed');
    });

    it('returns incomplete when manifest is null or undefined', () => {
      expect(classifyManifest(null)).toBe('incomplete');
      expect(classifyManifest(undefined)).toBe('incomplete');
    });

    it('returns incomplete when databases field is missing or empty', () => {
      const manifestWithoutDbs = {
        generatedAt: '2026-10-07T21:40:51.044Z',
        databases: {},
      } as BackupManifest;
      expect(classifyManifest(manifestWithoutDbs)).toBe('incomplete');
    });
  });

  describe('buildRunSummary', () => {
    it('builds a complete run summary object from a good manifest', () => {
      const folderName = '2026-10-07T21-40-51-044Z';
      const manifest: BackupManifest = {
        startedAt: '2026-10-07T21:40:51.044Z',
        finishedAt: '2026-10-07T21:41:15.000Z',
        trigger: 'backup button',
        who: 'test-user',
        generatedAt: '2026-10-07T21:40:51.044Z',
        databases: {
          webjamsalem: { ok: true, collections: { user: 15, venues: 40 } },
        },
      };

      const summary = buildRunSummary(folderName, manifest, 10240);

      expect(summary).toEqual({
        name: folderName,
        startTime: '2026-10-07T21:40:51.044Z',
        startedAt: '2026-10-07T21:40:51.044Z',
        trigger: 'backup button',
        state: 'good',
        size: 10240,
        dropboxPath: `${BACKUP_ROOT}/${folderName}`,
        path: `${BACKUP_ROOT}/${folderName}`,
        collections: {
          webjamsalem: { user: 15, venues: 40 },
        },
        databases: manifest.databases,
      });
    });

    it('builds summary for an incomplete run with missing manifest', () => {
      const folderName = '2026-10-07T21-40-51-044Z';
      const summary = buildRunSummary(folderName, null, 0);

      expect(summary.name).toBe(folderName);
      expect(summary.state).toBe('incomplete');
      expect(summary.trigger).toBeNull();
      expect(summary.size).toBe(0);
      expect(summary.dropboxPath).toBe(`${BACKUP_ROOT}/${folderName}`);
      expect(summary.collections).toEqual({});
      expect(summary.startTime).toBe('2026-10-07T21:40:51.044Z');
    });
  });
});
