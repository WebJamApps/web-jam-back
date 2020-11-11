import bcrypt from 'bcryptjs';
import userFacade from '../../../src/model/user/user-facade';

describe('user-facade', () => {
  let r;
  it('validates signup and finds bad data', () => {
    r = userFacade.validateSignup({ email: 'bad' });
    expect(r).toBe('User Name is missing');
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
    const delay = (ms: any) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(4000);
  });
});
