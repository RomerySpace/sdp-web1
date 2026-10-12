export const MAX_NAME_LENGTH = 20;
export function validateDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > MAX_NAME_LENGTH || !/^[\p{L}\p{N} _.-]+$/u.test(name)) return null;
  return name;
}
export function roomDisplayName(raw: unknown, existing: Iterable<string>, fallback: string): string {
  const desired = validateDisplayName(raw) ?? fallback;
  const used = new Set(Array.from(existing, name => name.toLocaleLowerCase('en')));
  let name = desired, suffix = 2;
  while (used.has(name.toLocaleLowerCase('en'))) name = `${desired.slice(0, MAX_NAME_LENGTH - 4)} #${suffix++}`;
  return name;
}
