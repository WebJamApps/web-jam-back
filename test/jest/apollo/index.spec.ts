import apollo, { resolvers } from '#src/apollo/index.js';

describe('apollo', () => {
  it('resolvers', () => {
    expect(resolvers.Query.gqldocs().length).toBe(2);
  });
  it('context return an object', async () => {
    const obj = { request: {}, response: { text: 'test' } };
    const result:any = await apollo.context(obj);
    expect(result.response.text).toBe('test');
  });
});
