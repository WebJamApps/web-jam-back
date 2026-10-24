import { spawnSync } from 'node:child_process';
import templateSchema from '#src/model/template/template-schema.js';
import { buildPitchEmail } from '#src/model/outreach/outreach-controller.js';

type Template = {
  type: string; stage: string; subject: string; introHtml: string; bodyHtml: string;
  footerPhotoRef: string; active: boolean; lastModifiedBy: string;
};
type Model = ReturnType<typeof fixture>['model'];
type SeedOptions = { model: Model; apply?: boolean; confirm?: (prompt: string) => Promise<string>; log?: (line: string) => void };
const modulePath = '../../scripts/seed-second-pitch-templates.mjs';
const { SECOND_PITCH_TEMPLATES, seedSecondPitchTemplates, parseArgs } = await import(modulePath) as {
  SECOND_PITCH_TEMPLATES: Template[];
  seedSecondPitchTemplates: (options: SeedOptions) => Promise<number>;
  parseArgs: (args: string[]) => { apply: boolean; help: boolean };
};

function fixture(existing: Partial<Template>[] = []) {
  const log = vi.fn<(line: string) => void>();
  const confirm = vi.fn<(prompt: string) => Promise<string>>().mockResolvedValue('all');
  const model = {
    find: vi.fn((_query: Record<string, unknown>) => ({ lean: () => ({ exec: async () => existing }) })),
    updateOne: vi.fn(async (
      _filter: Record<string, string>, _update: { $setOnInsert: Template & { created_at: Date; updated_at: Date } }, _options: Record<string, unknown>,
    ) => ({ upsertedCount: 1 })),
  };
  return { model, confirm, log };
}

describe('second-pitch template seed', () => {
  it('validates each proposed template with the real schema and renders the earlier follow-up wording', async () => {
    expect(SECOND_PITCH_TEMPLATES.map((t) => t.type)).toEqual(['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar']);
    for (const template of SECOND_PITCH_TEMPLATES) {
      await expect(new templateSchema(template).validate()).resolves.toBeUndefined();
      expect(template.stage).toBe('second-pitch');
      const rendered = buildPitchEmail({ name: 'Test Venue', contactName: 'Pat Smith' }, template, {
        firstPitchDate: 'October 1', targetDates: 'October 16-18', customBody: 'A custom note.',
      });
      expect(rendered.subject).toBe('Following up - Josh & Maria at Test Venue');
      expect(rendered.subject).not.toContain('—');
      expect(rendered.html).toContain('Hi Pat,');
      expect(rendered.html).toContain('Just following up on my note from October 1 about Josh &amp; Maria');
      expect(rendered.html).toContain("We'd still love to be considered for a slot at Test Venue around October 16-18.");
      expect(rendered.html).toContain("Completely understand if the calendar's full; even a later window would be great.");
      expect(rendered.html).toContain('Happy to send more live samples or work around your schedule.');
      expect(rendered.html).toContain('A custom note.');
      expect(rendered.html).toContain('cid:footerphoto');
    }
    await expect(new templateSchema({ type: 'Originals', stage: 'bogus' }).validate()).rejects.toThrow();
  });

  it('defaults to a dry run that prints every proposed field in one untruncated table', async () => {
    const f = fixture();
    expect(await seedSecondPitchTemplates(f)).toBe(0);
    expect(f.model.find).toHaveBeenCalledWith({ stage: 'second-pitch' });
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.model.updateOne).not.toHaveBeenCalled();
    const output = f.log.mock.calls.map(([line]) => line).join('\n');
    for (const template of SECOND_PITCH_TEMPLATES) {
      expect(output).toContain(`| ${template.type} | Insert second-pitch |`);
      expect(output).toContain(template.subject);
      expect(output).toContain(template.introHtml.replaceAll('\n', '<br>'));
      expect(output).toContain(template.bodyHtml.replaceAll('\n', '<br>'));
      expect(output).toContain(template.footerPhotoRef);
    }
    expect(output).toContain('DRY RUN: no templates written');
  });

  it('waits for table approval before writing and inserts only selected rows', async () => {
    const f = fixture();
    f.confirm.mockImplementation(async () => {
      expect(f.log).toHaveBeenCalledWith(expect.stringContaining('MidRangeCafeBar | Insert second-pitch'));
      expect(f.model.updateOne).not.toHaveBeenCalled();
      return '1, 3';
    });
    expect(await seedSecondPitchTemplates({ ...f, apply: true })).toBe(2);
    expect(f.model.updateOne.mock.calls.map(([filter]) => filter)).toEqual([
      { type: 'Originals', stage: 'second-pitch' }, { type: 'MidRangeCafeBar', stage: 'second-pitch' },
    ]);
    for (const [, update, options] of f.model.updateOne.mock.calls) {
      expect(Object.keys(update)).toEqual(['$setOnInsert']);
      expect(update.$setOnInsert.active).toBe(true);
      expect(options).toEqual({ upsert: true, runValidators: true, timestamps: false });
    }
  });

  it.each(['', 'none'])('writes nothing when approval is declined as %j', async (answer) => {
    const f = fixture();
    f.confirm.mockResolvedValue(answer);
    expect(await seedSecondPitchTemplates({ ...f, apply: true })).toBe(0);
    expect(f.model.updateOne).not.toHaveBeenCalled();
  });

  it.each(['yes', '0', '4', '1,4', '1;3', '1,'])('refuses invalid approval %j before any write', async (answer) => {
    const f = fixture();
    f.confirm.mockResolvedValue(answer);
    await expect(seedSecondPitchTemplates({ ...f, apply: true })).rejects.toThrow('Approval');
    expect(f.model.updateOne).not.toHaveBeenCalled();
  });

  it('preserves existing active and inactive templates on reruns without asking for approval', async () => {
    const f = fixture(SECOND_PITCH_TEMPLATES.map((template) => ({ ...template, subject: 'Human edited copy', active: false })));
    expect(await seedSecondPitchTemplates({ ...f, apply: true })).toBe(0);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.model.updateOne).not.toHaveBeenCalled();
    expect(f.log.mock.calls.filter(([line]) => line.includes('Keep existing'))).toHaveLength(3);
    expect(f.log.mock.calls.map(([line]) => line).join('\n')).toContain('Human edited copy');
  });

  it('offers only missing types when the table is partly seeded', async () => {
    const f = fixture([SECOND_PITCH_TEMPLATES[0]]);
    expect(await seedSecondPitchTemplates({ ...f, apply: true })).toBe(2);
    expect(f.model.updateOne).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'Originals' }), expect.anything(), expect.anything());
  });

  it('does not count a template that another operator inserted while the table awaited approval', async () => {
    const f = fixture();
    f.model.updateOne.mockResolvedValue({ upsertedCount: 0 });
    expect(await seedSecondPitchTemplates({ ...f, apply: true })).toBe(0);
    expect(f.log).toHaveBeenCalledWith('Originals/second-pitch: kept existing');
  });

  it('does not write on a failed approval read', async () => {
    const f = fixture();
    f.confirm.mockRejectedValue(new Error('input closed'));
    await expect(seedSecondPitchTemplates({ ...f, apply: true })).rejects.toThrow('input closed');
    expect(f.model.updateOne).not.toHaveBeenCalled();
  });

  it('does not ask or write when the database cannot be read', async () => {
    const f = fixture();
    f.model.find.mockImplementation(() => { throw new Error('database unavailable'); });
    await expect(seedSecondPitchTemplates({ ...f, apply: true })).rejects.toThrow('database unavailable');
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.model.updateOne).not.toHaveBeenCalled();
  });

  it('stops at a failed write, leaving later types untouched', async () => {
    const f = fixture();
    f.model.updateOne.mockRejectedValueOnce(new Error('write unavailable'));
    await expect(seedSecondPitchTemplates({ ...f, apply: true })).rejects.toThrow('write unavailable');
    expect(f.model.updateOne).toHaveBeenCalledTimes(1);
  });

  it('requires explicit apply mode and rejects conflicting or unknown options', () => {
    expect(parseArgs([])).toEqual({ apply: false, help: false });
    expect(parseArgs(['--dry-run']).apply).toBe(false);
    expect(parseArgs(['--apply']).apply).toBe(true);
    expect(() => parseArgs(['--yes'])).toThrow('Unknown option');
    expect(() => parseArgs(['--apply', '--dry-run'])).toThrow('Choose');
  });

  it('refuses a noninteractive apply before connecting or exposing credentials', () => {
    const result = spawnSync(process.execPath, ['scripts/seed-second-pitch-templates.mjs', '--apply'], {
      cwd: process.cwd(), encoding: 'utf8', env: { PATH: process.env.PATH, MONGO_DB_URI: 'mongodb://sensitive-test-value@invalid' },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Second-pitch seed refused: --apply requires an interactive terminal');
    expect(result.stderr).not.toContain('sensitive-test-value');
  });
});
