export type ServerRegionId = 'eu' | 'us';
export interface ServerRegion {
  readonly id: ServerRegionId;
  readonly label: string;
  readonly endpoint?: string;
  readonly available: boolean;
  readonly verifyIdentity: boolean;
  readonly legacySession: boolean;
}
type Environment = Readonly<Record<string, string | boolean | undefined>>;

export function normalizeServerEndpoint(value: string, origin: string): string {
  const url = new URL(value, origin);
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Server URLs must use HTTP(S)/WS(S) without credentials, queries or fragments.');
  if (new URL(origin).protocol === 'https:' && ['http:', 'ws:'].includes(url.protocol))
    throw new Error('An HTTPS exhibition requires secure server URLs.');
  url.protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
  return url.toString().replace(/\/+$/, '');
}

export function createServerRegions(env: Environment, origin: string): readonly ServerRegion[] {
  const legacy = typeof env.VITE_SDP_SERVER_URL === 'string' ? env.VITE_SDP_SERVER_URL : '/multiplayer';
  const explicitEU = typeof env.VITE_SDP_EU_SERVER_URL === 'string' && env.VITE_SDP_EU_SERVER_URL.trim();
  let previous = normalizeServerEndpoint('/multiplayer', origin);
  try { previous = normalizeServerEndpoint(legacy || '/multiplayer', origin); }
  catch { console.warn('[SDP] Invalid legacy endpoint; using the same-origin secure proxy.'); }
  let eu = previous;
  try { eu = normalizeServerEndpoint(explicitEU || previous, origin); }
  catch {
    console.warn('[SDP] Invalid EU endpoint; keeping the previous endpoint.');
    eu = previous;
  }
  let us: string | undefined;
  if (env.VITE_SDP_US_ENABLED === 'true' && typeof env.VITE_SDP_US_SERVER_URL === 'string' && env.VITE_SDP_US_SERVER_URL.trim()) {
    try {
      const candidate = normalizeServerEndpoint(env.VITE_SDP_US_SERVER_URL, origin);
      if (candidate !== eu) us = candidate;
    } catch { console.warn('[SDP] USA disabled: invalid or insecure server URL.'); }
  }
  return [
    { id: 'eu', label: 'EU / FRANKFURT', endpoint: eu, available: true, verifyIdentity: !!explicitEU, legacySession: eu === previous },
    { id: 'us', label: 'USA / VIRGINIA', endpoint: us, available: !!us, verifyIdentity: true, legacySession: false },
  ];
}

export function selectServerRegion(regions: readonly ServerRegion[], saved: unknown): ServerRegion {
  return regions.find(region => region.id === saved && region.available) ?? regions.find(region => region.available)!;
}

export function serverSessionKeys(endpoint: string): { admission: string; reconnect: string } {
  const scope = `sdp:server:${encodeURIComponent(endpoint)}`;
  return { admission: `${scope}:admission`, reconnect: `${scope}:reconnect` };
}

export function migrateLegacySession(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, region: ServerRegion): void {
  if (region.id !== 'eu' || !region.legacySession || !region.endpoint || storage.getItem('sdp:legacy-session-migrated')) return;
  const keys = serverSessionKeys(region.endpoint);
  for (const kind of ['admission', 'reconnect'] as const) {
    const value = storage.getItem(`sdp:${kind}`);
    if (value && !storage.getItem(keys[kind])) storage.setItem(keys[kind], value);
    storage.removeItem(`sdp:${kind}`);
  }
  storage.setItem('sdp:legacy-session-migrated', region.endpoint);
}

export class ServerRegionError extends Error {}
export async function verifyServerRegion(region: ServerRegion): Promise<void> {
  if (!region.verifyIdentity) return;
  try {
    const response = await fetch(`${region.endpoint}/health`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!response.ok) throw new Error('Unavailable');
    const health = await response.json() as { status?: string; region?: string };
    if (health.status !== 'ok' || health.region !== region.id)
      throw new ServerRegionError('This endpoint does not match the selected region. Choose another server.');
  } catch (error) {
    if (error instanceof ServerRegionError) throw error;
    throw new ServerRegionError('The selected server is unavailable. Choose another server or try again.');
  }
}
