export function liveKitURLs(environment: NodeJS.ProcessEnv = process.env): { apiURL: string; publicURL: string } {
  const production = environment.NODE_ENV === 'production';
  const configured = environment.LIVEKIT_URL;
  if (production && environment.LIVEKIT_API_KEY && !configured) throw new Error('Set LIVEKIT_URL to the HTTPS URL of your LiveKit project.');
  const api = new URL(configured || 'http://127.0.0.1:7880');
  if (api.protocol === 'wss:') api.protocol = 'https:';
  if (api.protocol === 'ws:') api.protocol = 'http:';
  if (!['https:', 'http:'].includes(api.protocol) || api.username || api.password || api.search || api.hash || api.pathname !== '/') {
    throw new Error('LIVEKIT_URL must be an http(s) or ws(s) server origin, without credentials or paths.');
  }
  if (production && configured && api.protocol !== 'https:') throw new Error('Production LiveKit must use HTTPS/WSS.');
  const browser = new URL(api);
  browser.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
  const publicURL = environment.LIVEKIT_PUBLIC_URL || (configured ? browser.origin : '/voice');
  if (publicURL === '/voice' && !production) return { apiURL: api.origin, publicURL };
  const publicServer = new URL(publicURL);
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(publicServer.protocol) || publicServer.username || publicServer.password || publicServer.search || publicServer.hash || publicServer.pathname !== '/') {
    throw new Error('LIVEKIT_PUBLIC_URL must be the public LiveKit server origin.');
  }
  if (production && !['https:', 'wss:'].includes(publicServer.protocol)) throw new Error('Production LIVEKIT_PUBLIC_URL must use HTTPS/WSS.');
  return { apiURL: api.origin, publicURL: publicServer.origin };
}
