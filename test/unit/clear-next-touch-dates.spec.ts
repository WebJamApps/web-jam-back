import { spawnSync } from 'node:child_process';

type DatedRecord = { _id: string; nextTouchDue: Date };
type CleanupOptions = {
  collection: ReturnType<typeof fixture>['collection'];
  apply?: boolean;
  confirm?: (prompt: string) => Promise<string>;
  log?: (line: string) => void;
};
const modulePath = '../../scripts/clear-next-touch-dates.mjs';
const { clearNextTouchDates } = await import(modulePath) as {
  clearNextTouchDates: (options: CleanupOptions) => Promise<number>;
};

const past = new Date('2000-01-01T00:00:00Z');
const future = new Date('2100-01-01T00:00:00Z');
const sentRecords = [{ _id: 'past', nextTouchDue: past }, { _id: 'future', nextTouchDue: future }];

function fixture(records: DatedRecord[] = sentRecords) {
  const toArray = vi.fn().mockResolvedValue(records);
  const collection = {
    find: vi.fn().mockReturnValue({ toArray }),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: records.length }),
  };
  const log = vi.fn<(line: string) => void>();
  const confirm = vi.fn<(prompt: string) => Promise<string>>().mockResolvedValue(`clear ${records.length}`);
  return { collection, log, confirm, toArray };
}

describe('clear-next-touch-dates', () => {
  it('previews one count for sent records with dates, without prompting or writing', async () => {
    const { collection, log, confirm } = fixture();
    expect(await clearNextTouchDates({ collection, log, confirm })).toBe(0);
    expect(collection.find).toHaveBeenCalledExactlyOnceWith(
      { status: 'sent', nextTouchDue: { $exists: true, $ne: null } },
      { projection: { _id: 1, nextTouchDue: 1 } },
    );
    expect(log.mock.calls.flat()).toEqual([
      '| Status | Records | Change |',
      '| --- | ---: | --- |',
      '| sent | 2 | Set nextTouchDue to null |',
      expect.stringContaining('DRY RUN: no dates cleared'),
    ]);
    expect(confirm).not.toHaveBeenCalled();
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it.each(['', 'none', 'yes', 'clear 1'])('makes no writes for the answer %j', async (answer) => {
    const { collection, log, confirm } = fixture();
    confirm.mockResolvedValue(answer);
    expect(await clearNextTouchDates({ collection, log, confirm, apply: true })).toBe(0);
    expect(log).toHaveBeenCalledWith('Approval declined. No dates cleared.');
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('sets only the previewed dates to null after approval and reports the modified count', async () => {
    const { collection, log, confirm } = fixture();
    confirm.mockImplementation(async (prompt) => {
      expect(log).toHaveBeenCalledWith('| sent | 2 | Set nextTouchDue to null |');
      expect(prompt).toContain('clear 2');
      expect(collection.bulkWrite).not.toHaveBeenCalled();
      return 'clear 2';
    });
    collection.bulkWrite.mockResolvedValue({ modifiedCount: 1 });
    expect(await clearNextTouchDates({ collection, log, confirm, apply: true })).toBe(1);
    expect(collection.bulkWrite).toHaveBeenCalledExactlyOnceWith([
      { updateOne: { filter: { _id: 'past', status: 'sent', nextTouchDue: past }, update: { $set: { nextTouchDue: null } } } },
      { updateOne: { filter: { _id: 'future', status: 'sent', nextTouchDue: future }, update: { $set: { nextTouchDue: null } } } },
    ], { writeConcern: { w: 'majority' } });
    expect(log).toHaveBeenLastCalledWith('Cleared 1 of 2 approved next-touch date(s).');
  });

  it('does not prompt or write on a repeat run with no dates left', async () => {
    const { collection, log, confirm } = fixture([]);
    expect(await clearNextTouchDates({ collection, log, confirm, apply: true })).toBe(0);
    expect(log).toHaveBeenCalledWith('| sent | 0 | Set nextTouchDue to null |');
    expect(confirm).not.toHaveBeenCalled();
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('stops without prompting or writing when the preview query fails', async () => {
    const { collection, log, confirm, toArray } = fixture();
    toArray.mockRejectedValue(new Error('read failed'));
    await expect(clearNextTouchDates({ collection, log, confirm, apply: true })).rejects.toThrow('read failed');
    expect(confirm).not.toHaveBeenCalled();
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('refuses --apply without an interactive terminal before reading a connection string', () => {
    const result = spawnSync(process.execPath, ['scripts/clear-next-touch-dates.mjs', '--apply'], {
      encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--apply requires an interactive terminal');
  });
});
