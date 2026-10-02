// Decides whether a failed sendMail means the mail account or connection is the
// problem (so a bulk dispatch must stop) or the one venue/message is (so the
// dispatch can skip that venue and carry on). Reads only the two fields
// Nodemailer puts on its errors: a string `code` and, when the server replied,
// a numeric `responseCode`.
const ACCOUNT_OR_CONNECTION_CODES = new Set([
  'EAUTH', 'ENOAUTH', 'EOAUTH2', 'ECONNECTION', 'EDNS', 'ETLS', 'ETIMEDOUT', 'ESOCKET', 'EPROTOCOL',
]);

// Returns true when the dispatch must stop. Fails closed: anything that cannot
// be classified (no string code and no numeric responseCode, or not an object)
// also stops the dispatch.
export function mustStopDispatch(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return true;
  const { code, responseCode } = err as { code?: unknown; responseCode?: unknown };
  const hasCode = typeof code === 'string';
  const hasResponseCode = typeof responseCode === 'number';
  if (!hasCode && !hasResponseCode) return true;
  if (hasCode && ACCOUNT_OR_CONNECTION_CODES.has(code)) return true;
  return hasResponseCode && responseCode >= 400 && responseCode <= 499;
}

export default { mustStopDispatch };
