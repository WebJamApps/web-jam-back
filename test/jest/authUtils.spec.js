const EventEmitter = require('events');
const AuthUtils = require('../../auth/authUtils');

EventEmitter.defaultMaxListeners = Infinity;
describe('the authUtils', () => {
  it('validates email syntax', async () => {
    try {
      const cb = await AuthUtils.checkEmailSyntax({ body: { changeemail: 'j@jb.com' } });
      expect(cb).toBe(true);
    } catch (e) { throw e; }
  });
  it('validates email syntax and returns error', async () => {
    try {
      await AuthUtils.checkEmailSyntax({ body: { changeemail: 'bogas' } });
    } catch (e) {
      expect(e.message).toBe('email address is not a valid format');
    }
  });
});
