// Authorization for ASSIGNING a role (userType) to a user via the admin UI.
//
// The route guard already restricts /admin/* to AUTH_ROLES.admin, so only
// admin-capable users reach the controller. This adds a finer rule: which
// acting-admin roles may GRANT a given target role.
//
// - `Developer` is superadmin and may grant any role.
// - Otherwise the granter's role must be listed for the target role below.
// - A target role with no entry is grantable only by `Developer` (deny by
//   default), so adding a new role can't accidentally let everyone hand it out.
//
// Uses a Map (not a plain object) so the dynamic target-role lookup can't be
// abused via prototype keys.
export const ROLE_GRANTERS = new Map<string, string[]>([
  ['clc-admin', ['Developer', 'clc-admin']],
  ['JaM-admin', ['Developer', 'JaM-admin']],
  ['web-jam-llm', ['Developer', 'JaM-admin']],
  ['Developer', ['Developer']],
]);

export function canGrantRole(granterRole: string | undefined | null, targetRole: string): boolean {
  if (!granterRole) return false;
  if (granterRole === 'Developer') return true;
  const allowed = ROLE_GRANTERS.get(targetRole);
  return Array.isArray(allowed) && allowed.includes(granterRole);
}

export default { ROLE_GRANTERS, canGrantRole };
