import roleGrants, { ROLE_GRANTERS, canGrantRole } from '#src/auth/roleGrants.js';

describe('roleGrants — who may grant which role', () => {
  it('Developer (superadmin) can grant any role, including unknown ones', () => {
    expect(canGrantRole('Developer', 'clc-admin')).toBe(true);
    expect(canGrantRole('Developer', 'JaM-admin')).toBe(true);
    expect(canGrantRole('Developer', 'web-jam-llm')).toBe(true);
    expect(canGrantRole('Developer', 'Developer')).toBe(true);
    expect(canGrantRole('Developer', 'something-new')).toBe(true);
  });

  it('clc-admin can grant clc-admin only', () => {
    expect(canGrantRole('clc-admin', 'clc-admin')).toBe(true);
    expect(canGrantRole('clc-admin', 'JaM-admin')).toBe(false);
    expect(canGrantRole('clc-admin', 'web-jam-llm')).toBe(false);
    expect(canGrantRole('clc-admin', 'Developer')).toBe(false);
  });

  it('JaM-admin can grant JaM-admin and web-jam-llm but never clc-admin or Developer', () => {
    expect(canGrantRole('JaM-admin', 'JaM-admin')).toBe(true);
    expect(canGrantRole('JaM-admin', 'web-jam-llm')).toBe(true);
    expect(canGrantRole('JaM-admin', 'clc-admin')).toBe(false);
    expect(canGrantRole('JaM-admin', 'Developer')).toBe(false);
  });

  it('a missing/empty granter role cannot grant anything', () => {
    expect(canGrantRole(undefined, 'clc-admin')).toBe(false);
    expect(canGrantRole(null, 'clc-admin')).toBe(false);
    expect(canGrantRole('', 'clc-admin')).toBe(false);
  });

  it('an unknown target role is grantable only by Developer (deny by default)', () => {
    expect(canGrantRole('JaM-admin', 'mystery-role')).toBe(false);
    expect(canGrantRole('Developer', 'mystery-role')).toBe(true);
  });

  it('default export wires up ROLE_GRANTERS and canGrantRole', () => {
    expect(roleGrants.ROLE_GRANTERS).toBe(ROLE_GRANTERS);
    expect(roleGrants.canGrantRole).toBe(canGrantRole);
  });
});
