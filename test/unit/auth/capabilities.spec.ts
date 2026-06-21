import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import capabilities, { CAPABILITIES, isValidCapability, validatePrivileges } from '../../../src/auth/capabilities.js';

// Recursively collect every *-controller.ts under src/.
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllerFiles(full));
    else if (entry.name.endsWith('-controller.ts') || entry.name.endsWith('Controller.ts')) out.push(full);
  }
  return out;
}

// Quoted capability literals a controller gates on, e.g. 'outreach:create'.
const CAP_LITERAL = /['"]([a-z][\w-]*:(?:create|edit|delete|email))['"]/g;

describe('capabilities registry', () => {
  it('exposes the canonical list', () => {
    expect(CAPABILITIES.length).toBeGreaterThan(0);
    expect(CAPABILITIES).toContain('gig:create');
    expect(CAPABILITIES).toContain('song:create');
    expect(CAPABILITIES).toContain('book:delete');
  });

  it('includes the outreach:* caps (web-jam-back#823/#836)', () => {
    for (const cap of ['outreach:create', 'outreach:edit', 'outreach:delete']) {
      expect(isValidCapability(cap)).toBe(true);
    }
  });

  // Guard against the #823 miss: a controller gating on a capability that was
  // never registered grants nothing and silently vanishes from the Admin UI.
  // Every capability literal referenced by a controller must be in the registry.
  it('registers every capability a controller gates on', () => {
    const registered = new Set<string>(CAPABILITIES);
    const unregistered: { file: string; cap: string }[] = [];
    for (const file of controllerFiles(path.resolve(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(CAP_LITERAL)) {
        if (!registered.has(match[1])) unregistered.push({ file: path.basename(file), cap: match[1] });
      }
    }
    expect(unregistered).toEqual([]);
  });

  it('includes the new gig:* caps and keeps legacy tour:* valid during migration', () => {
    for (const cap of ['gig:create', 'gig:edit', 'gig:delete', 'tour:create', 'tour:edit', 'tour:delete']) {
      expect(isValidCapability(cap)).toBe(true);
    }
  });

  it('does NOT include user:* capabilities (admin role only, not granted per user)', () => {
    for (const cap of CAPABILITIES) {
      expect(cap.startsWith('user:')).toBe(false);
    }
  });

  // tour/song/book reads are public & unauthenticated, so a read privilege
  // gates nothing — the registry omits all :read caps.
  it('does NOT include any :read capabilities', () => {
    for (const cap of CAPABILITIES) {
      expect(cap.endsWith(':read')).toBe(false);
    }
  });

  it('isValidCapability returns true for known capabilities', () => {
    expect(isValidCapability('tour:create')).toBe(true);
    expect(isValidCapability('book:create')).toBe(true);
  });

  it('isValidCapability returns false for unknown values', () => {
    expect(isValidCapability('tour:nuke')).toBe(false);
    expect(isValidCapability('')).toBe(false);
    expect(isValidCapability('admin:everything')).toBe(false);
  });

  it('validatePrivileges accepts a valid array', () => {
    const result = validatePrivileges(['tour:create', 'song:create']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.privileges).toEqual(['tour:create', 'song:create']);
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
