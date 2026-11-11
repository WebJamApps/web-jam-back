import userFacade from '#src/model/user/user-facade.js';

describe('user-facade', () => {
  it('instantiates the user facade', () => {
    expect(userFacade).toBeDefined();
    expect(userFacade.Schema).toBeDefined();
  });
});
