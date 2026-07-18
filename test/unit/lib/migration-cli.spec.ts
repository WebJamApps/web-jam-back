// Unit tests for the shared one-time-migration CLI scaffolding (#980) —
// extracted out of migrate-drop-do-not-contact.ts / migrate-clean-city.ts
// (and duplicated no further into any pre-existing migrate-*.ts script) so
// jscpd's duplication check stays under threshold. See src/lib/migration-cli.ts
// header for the full story.
import {
  parseArgs, isSafeToRun, maskMongoUri, logSafetyBlock, isMainModule, guardOrExit,
} from '#src/lib/migration-cli.js';

describe('migration-cli (#980)', () => {
  describe('parseArgs', () => {
    it('reads --apply and --force flags', () => {
      expect(parseArgs([])).toEqual({ apply: false, force: false });
      expect(parseArgs(['--apply'])).toEqual({ apply: true, force: false });
      expect(parseArgs(['--force', '--apply'])).toEqual({ apply: true, force: true });
    });
  });

  describe('isSafeToRun', () => {
    it('allows a localhost URI', () => {
      expect(isSafeToRun('mongodb://localhost:27017/web-jam-dev', false)).toBe(true);
    });

    it('allows a 127.0.0.1 URI', () => {
      expect(isSafeToRun('mongodb://127.0.0.1:27017/anything', false)).toBe(true);
    });

    it('allows a DEV Atlas db name', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/web-jam-dev', false)).toBe(true);
    });

    it('allows a TEST db name', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/web-jam-test', false)).toBe(true);
    });

    it('blocks a prod-looking (release) db name without --force', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/release', false)).toBe(false);
    });

    it('allows a prod-looking db name when --force is passed', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/release', true)).toBe(true);
    });
  });

  describe('maskMongoUri', () => {
    it('masks embedded credentials', () => {
      expect(maskMongoUri('mongodb+srv://user:pass@cluster.mongodb.net/release')).toBe('mongodb+srv://<credentials>@cluster.mongodb.net/release');
    });

    it('leaves a credential-free URI untouched', () => {
      expect(maskMongoUri('mongodb://localhost:27017/web-jam-dev')).toBe('mongodb://localhost:27017/web-jam-dev');
    });
  });

  describe('logSafetyBlock', () => {
    it('logs the refusal message including the script name, npm script, and parsed db name', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logSafetyBlock('migrate-example', 'migrate:example', 'mongodb+srv://user:pass@cluster.mongodb.net/release', 'mongodb+srv://<credentials>@cluster.mongodb.net/release');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('migrate-example only runs against a local, DEV, or TEST database'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('release'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('migrate:example -- --force'));
      errorSpy.mockRestore();
    });
  });

  describe('isMainModule', () => {
    let originalArgv: string[];
    beforeEach(() => { originalArgv = process.argv; });
    afterEach(() => { process.argv = originalArgv; });

    it('true when argv[1] matches the given module URL', () => {
      process.argv = ['node', '/path/to/script.js'];
      expect(isMainModule('file:///path/to/script.js')).toBe(true);
    });

    it('false when argv[1] does not match (imported by a test runner)', () => {
      process.argv = ['node', '/path/to/vitest.js'];
      expect(isMainModule('file:///path/to/script.js')).toBe(false);
    });

    it('false when argv[1] is empty', () => {
      process.argv = ['node'];
      expect(isMainModule('file:///path/to/script.js')).toBe(false);
    });
  });

  describe('guardOrExit', () => {
    let originalArgv: string[];
    let originalUri: string | undefined;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      originalArgv = process.argv;
      originalUri = process.env.MONGO_DB_URI;
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      process.argv = originalArgv;
      if (originalUri === undefined) delete process.env.MONGO_DB_URI;
      else process.env.MONGO_DB_URI = originalUri;
      vi.restoreAllMocks();
    });

    it('returns the parsed args + masked URI for a safe (DEV) target', () => {
      process.argv = ['node', 'migrate-example.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/web-jam-dev';
      const ctx = guardOrExit('migrate-example', 'migrate:example');
      expect(ctx).toEqual({
        apply: true,
        force: false,
        uri: 'mongodb+srv://user:pass@cluster.mongodb.net/web-jam-dev',
        maskedUri: 'mongodb+srv://<credentials>@cluster.mongodb.net/web-jam-dev',
      });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits and logs the safety block for an unsafe target without --force', () => {
      process.argv = ['node', 'migrate-example.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      expect(() => guardOrExit('migrate-example', 'migrate:example')).toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('migrate-example only runs against a local, DEV, or TEST database'));
    });
  });
});
