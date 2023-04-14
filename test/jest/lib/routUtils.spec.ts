import routeUtils from '../../../src/lib/routeUtils';

describe('routeUtils', () => {
  it('makeAction catches error', async () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const action = routeUtils.makeAction(
      {} as any, 
      { status } as any, 
      '', 
      {},
      { ensureAuthenticated: jest.fn(() => Promise.reject(new Error('failed'))) } as any,
    );
    await action();
    expect(json).toHaveBeenCalledWith({ message: 'failed' });
  });
});
