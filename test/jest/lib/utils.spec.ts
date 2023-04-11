/* eslint-disable @typescript-eslint/no-explicit-any */
import utils from '../../../src/lib/utils';

describe('utils', () => {
  it('mongoConnect catches error', async () => {
    let eMessage = '';
    const mg:any = { connect: jest.fn(() => Promise.reject(new Error('failed'))) };
    try {
      await utils.mongoConnect(mg);
    } catch (err) { eMessage = (err as Error).message; }
    expect(eMessage.includes('failed')).toBe(true);
  });
  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line jest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: any) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});
