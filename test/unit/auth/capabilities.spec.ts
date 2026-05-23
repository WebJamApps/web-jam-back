import capabilities, { CAPABILITIES, isValidCapability, validatePrivileges } from '../../../src/auth/capabilities.js';

describe('capabilities registry', () => {
  it('exposes the canonical list', () => {
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    expect(CAPABILITIES).toContain('tour:create');
    expect(CAPABILITIES).toContain('song:read');
    expect(CAPABILITIES).toContain('book:delete');
  });

  it('does NOT include user:* capabilities (admin role only, not granted per user)', () => {
    for (const cap of CAPABILITIES) {
      expect(cap.startsWith('user:')).toBe(false);
    }
  });

  it('isValidCapability returns true for known capabilities', () => {
    expect(isValidCapability('tour:create')).toBe(true);
    expect(isValidCapability('book:read')).toBe(true);
  });

  it('isValidCapability returns false for unknown values', () => {
    expect(isValidCapability('tour:nuke')).toBe(false);
    expect(isValidCapability('')).toBe(false);
    expect(isValidCapability('admin:everything')).toBe(false);
  });

  it('validatePrivileges accepts a valid array', () => {
    const result = validatePrivileges(['tour:create', 'song:read']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.privileges).toEqual(['tour:create', 'song:read']);
  });

  it('validatePrivileges accepts an empty array', () => {
    const result = validatePrivileges([]);
    expect(result.ok).toBe(true);
  });

  it('validatePrivileges rejects non-array input', () => {
    const result = validatePrivileges('tour:create' as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('must be an array');
  });

  it('validatePrivileges rejects array with unknown capability', () => {
    const result = validatePrivileges(['tour:create', 'tour:nuke']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('tour:nuke');
  });

  it('validatePrivileges rejects array with non-string entry', () => {
    const result = validatePrivileges(['tour:create', 42]);
    expect(result.ok).toBe(false);
  });

  it('default export wires up all three exports', () => {
    expect(capabilities.CAPABILITIES).toBe(CAPABILITIES);
    expect(capabilities.isValidCapability).toBe(isValidCapability);
    expect(capabilities.validatePrivileges).toBe(validatePrivileges);
  });
});
