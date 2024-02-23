import bcrypt from 'bcryptjs';
import userFacade from '../../../src/model/user/user-facade';

describe('user-facade', () => {
  let r;
  it('validates signup and finds bad data', () => {
    r = userFacade.validateSignup({ email: 'bad', name: '', password: '' });
    expect(r).toBe('User Name is missing');
  });
  it('validates signup when good data', () => {
    r = userFacade.validateSignup({ email: 'good@testing.com', name: 'name', password: '12345678' });
    expect(r).toBe('');
  });
  it('handles error from bcrypt', async () => {
    bcrypt.compare = jest.fn(() => Promise.reject(new Error('bad')));
    await expect(userFacade.comparePassword('pw', 'p')).rejects.toThrow('bad');
  });
  it('successfully encrypts the password', async () => {
    r = await userFacade.encryptPswd('pw');
    expect(r).toBeDefined();
  });
  it('catches error on encrypts the password', async () => {
    bcrypt.hash = jest.fn(() => Promise.reject(new Error('bad')));
    await expect(userFacade.encryptPswd('pw')).rejects.toThrow('bad');
  });
  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line jest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: any) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
  it('comparePassword when is a match', async () => {
    bcrypt.compare = jest.fn(() => Promise.resolve(true));
    expect((await userFacade.comparePassword('pw', 'pw'))).toBe(true);
  });
});
