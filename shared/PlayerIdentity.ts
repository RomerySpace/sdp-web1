export const MAX_NAME_LENGTH = 20;
export function validateDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > MAX_NAME_LENGTH || !/^[\p{L}\p{N} _.-]+$/u.test(name)) return null;
  return name;
}
