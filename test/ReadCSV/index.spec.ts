import ReadCSV from '../../src/ReadCSV';

describe('ReadCSV', () => {
  it('runs', async () => {
    const readc = new ReadCSV();
    const result = await readc.run();
    expect(result).toBe('Man United won 18 games');
  });
  it('runs with error', async () => {
    const readc: any = new ReadCSV();
    readc.csvtojson = jest.fn(() => ({ fromFile: () => Promise.reject(new Error('bad')) }));
    const result = await readc.run();
    expect(result).toBe('bad');
  });
});
