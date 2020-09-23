/* eslint-disable @typescript-eslint/no-explicit-any */
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
  it('skips converstion to date if not a string', () => {
    const readc: any = new ReadCSV();
    readc.soccerMatches = [{ date: new Date() }];
    readc.convertData();
    expect(readc.soccerMatches.length).toBe(1);
  });
});
