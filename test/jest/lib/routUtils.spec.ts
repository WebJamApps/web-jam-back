import routeUtils from '../../../src/lib/routeUtils.js';

describe('routeUtils', () => {
  it('makeAction catches error', async () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const action = routeUtils.makeAction(
      {} as any, 
      { status } as any, 
      '', 
      {},
      { ensureAuthenticated: vi.fn(() => Promise.reject(new Error('failed'))) } as any,
    );
    await action();
    expect(json).toHaveBeenCalledWith({ message: 'failed' });
  });
});
