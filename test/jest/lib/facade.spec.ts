import Facade from '../../../src/lib/facade';

describe('lib facade', () => {
  let facade;
  const matcher:any = {};
  const schema:any = {
    find: () => ({
      lean: () => (
        { exec: () => Promise.reject(new Error('bad')) }
      ),
    }),
    findOne: () => ({
      lean: () => (
        { exec: () => Promise.reject(new Error('bad')) }
      ),
    }),
    findOneAndUpdate: () => ({
      lean: () => (
        { exec: () => Promise.reject(new Error('bad')) }
      ),
    }),
  };
  it('catches error on find', async () => {
    facade = new Facade(schema);
    await expect(facade.find(matcher)).rejects.toThrow('bad');
  });
  it('catches error on findOne', async () => {
    facade = new Facade(schema);
    await expect(facade.findOne(matcher)).rejects.toThrow('bad');
  });
  it('catches error on findOneAndUpdate', async () => {
    facade = new Facade(schema);
    await expect(facade.findOneAndUpdate({ conditions: '' }, { update: '' })).rejects.toThrow('bad');
  });
});
