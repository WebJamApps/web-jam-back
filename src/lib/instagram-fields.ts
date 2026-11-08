export function isInstagramUsername(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 30 && !/[^A-Za-z0-9._]/.test(value);
}

export function isFacebookPageId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 20 && !/\D/.test(value);
}
